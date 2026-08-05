import path from "node:path";
import { parse } from "@astrojs/compiler-rs";
import MagicString, { type SourceMap } from "magic-string";
import { normalizeRelativeFile } from "../manifest/paths.js";
import {
  SOURCE_FILE_ATTRIBUTE,
  SOURCE_LOCATION_ATTRIBUTE,
  SOURCE_TAG_ATTRIBUTE
} from "../shared/contracts.js";

interface InjectionResult {
  code: string;
  map: SourceMap;
}

interface OpeningElement {
  type: "JSXOpeningElement";
  start: number;
  name: {
    type: "JSXIdentifier";
    name: string;
    end: number;
  };
  attributes: unknown[];
}

/**
 * 주입 위치는 태그 종류에 따라 갈린다. 두 경로의 **덮어쓰기 방향이 반대**이기
 * 때문이다.
 *
 * - intrinsic 태그(`<button>`)는 문자열 템플릿으로 렌더된다. spread 로 받은 속성과
 *   여기서 주입한 속성이 HTML 에 둘 다 나가고, 중복 속성은 **먼저 나온 값**이 이긴다.
 *   그래서 래퍼 자신의 좌표를 마지막 속성 **뒤**에 놓아야 호출부 좌표가 살아남는다.
 * - 컴포넌트 태그(`<Wrapper>`)는 props **객체**로 병합된다. `{...props}` 가
 *   **나중 키로 덮으므로** 주입은 태그명 바로 뒤, 즉 spread **앞**이어야 바깥 호출부가
 *   이긴다.
 *
 * 두 규칙을 합치면 중첩 래퍼에서도 가장 바깥 호출부가 DOM 까지 살아 나온다
 * (README Scope 의 "injected at the call site").
 * 속성 끝 오프셋이라 `selfClosing` 의 `/>` 는 건드리지 않는다.
 */
function attributeInsertionOffset(
  opening: OpeningElement,
  isComponent: boolean
): number {
  let offset = opening.name.end;
  if (isComponent) {
    return offset;
  }
  for (const attribute of opening.attributes) {
    if (isRecord(attribute) && typeof attribute.end === "number") {
      offset = Math.max(offset, attribute.end);
    }
  }
  return offset;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOpeningElement(value: unknown): value is OpeningElement {
  if (!isRecord(value) || value.type !== "JSXOpeningElement") {
    return false;
  }
  const name = value.name;
  return (
    typeof value.start === "number" &&
    Array.isArray(value.attributes) &&
    isRecord(name) &&
    name.type === "JSXIdentifier" &&
    typeof name.name === "string" &&
    typeof name.end === "number"
  );
}

function collectOpeningElements(value: unknown, result: OpeningElement[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectOpeningElements(item, result);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (isOpeningElement(value)) {
    result.push(value);
  }
  for (const child of Object.values(value)) {
    collectOpeningElements(child, result);
  }
}

function attributeName(attribute: unknown): string | undefined {
  if (!isRecord(attribute) || attribute.type !== "JSXAttribute") {
    return undefined;
  }
  const name = attribute.name;
  return isRecord(name) &&
    name.type === "JSXIdentifier" &&
    typeof name.name === "string"
    ? name.name
    : undefined;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * `@astrojs/compiler-rs` 는 Rust 구현이라 노드 위치를 **UTF-8 바이트 오프셋**으로 준다.
 * 반면 MagicString/JS 문자열은 **UTF-16 code unit** 인덱스라, 한글·이모지가 있으면
 * 둘이 어긋나 엉뚱한 위치(식별자 한복판)에 속성이 박힌다.
 * 바이트 오프셋 -> UTF-16 인덱스 매핑을 만들어 보정한다.
 * ASCII 전용 파일이면 매핑이 항등이라 null 을 돌려 오버헤드를 없앤다.
 */
function createByteToUtf16Map(source: string): Uint32Array | null {
  let isAscii = true;
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) > 0x7f) {
      isAscii = false;
      break;
    }
  }
  if (isAscii) {
    return null;
  }

  const map: number[] = [];
  for (let index = 0; index < source.length; ) {
    const codePoint = source.codePointAt(index) ?? 0;
    const utf16Units = codePoint > 0xffff ? 2 : 1;
    const utf8Bytes =
      codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
    for (let byte = 0; byte < utf8Bytes; byte += 1) {
      map.push(index);
    }
    index += utf16Units;
  }
  map.push(source.length);
  return Uint32Array.from(map);
}

function createLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function toLineColumn(lineStarts: number[], offset: number) {
  let low = 0;
  let high = lineStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const lineIndex = Math.max(0, low - 1);
  return {
    line: lineIndex + 1,
    column: offset - (lineStarts[lineIndex] ?? 0) + 1
  };
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export function injectAstroSourceMetadata(
  source: string,
  file: string,
  root: string
): InjectionResult | null {
  const absoluteRoot = path.resolve(root);
  const absoluteFile = path.resolve(file);
  if (
    path.extname(absoluteFile).toLowerCase() !== ".astro" ||
    !isInside(absoluteRoot, absoluteFile)
  ) {
    return null;
  }

  const parsed = parse(source);
  if (parsed.diagnostics.length > 0) {
    return null;
  }

  const relativeFile = escapeAttribute(
    normalizeRelativeFile(path.relative(absoluteRoot, absoluteFile))
  );
  const openings: OpeningElement[] = [];
  collectOpeningElements(parsed.ast, openings);
  const lineStarts = createLineStarts(source);
  const byteToUtf16 = createByteToUtf16Map(source);
  const toUtf16 = (byteOffset: number) =>
    byteToUtf16 ? (byteToUtf16[byteOffset] ?? source.length) : byteOffset;
  const output = new MagicString(source);

  for (const opening of openings) {
    const tag = opening.name.name;
    if (
      !/^(?:[a-z][a-z0-9-]*|[A-Z_$][A-Za-z0-9_$]*)$/u.test(tag) ||
      tag === "Fragment" ||
      tag === "script" ||
      tag === "style"
    ) {
      continue;
    }
    const existingAttributes = new Set(
      opening.attributes.map(attributeName).filter(Boolean)
    );
    const hasSourceLocation =
      existingAttributes.has(SOURCE_FILE_ATTRIBUTE) &&
      existingAttributes.has(SOURCE_LOCATION_ATTRIBUTE);
    const hasSourceTag = existingAttributes.has(SOURCE_TAG_ATTRIBUTE);
    if (hasSourceLocation && hasSourceTag) {
      continue;
    }
    const { line, column } = toLineColumn(lineStarts, toUtf16(opening.start));
    const attributes = [
      hasSourceLocation
        ? ""
        : ` ${SOURCE_FILE_ATTRIBUTE}="${relativeFile}" ${SOURCE_LOCATION_ATTRIBUTE}="${line}:${column}"`,
      hasSourceTag ? "" : ` ${SOURCE_TAG_ATTRIBUTE}="${escapeAttribute(tag)}"`
    ].join("");
    output.appendLeft(
      toUtf16(attributeInsertionOffset(opening, /^[A-Z_$]/u.test(tag))),
      attributes
    );
  }

  return {
    code: output.toString(),
    map: output.generateMap({
      source: absoluteFile,
      includeContent: true,
      hires: true
    })
  };
}
