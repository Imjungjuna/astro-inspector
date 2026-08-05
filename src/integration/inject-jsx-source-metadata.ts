import path from "node:path";
import { parse } from "@babel/parser";
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
  name: Record<string, unknown> & { end: number };
  attributes: unknown[];
}

function sourceTagName(name: Record<string, unknown>): string | undefined {
  return name.type === "JSXIdentifier" && typeof name.name === "string"
    ? name.name
    : undefined;
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

/**
 * Runs in `load`, so `source` is always the file on disk. Baking the coordinates
 * this early keeps the SSR and client pipelines byte-identical: whatever a later
 * transform does to the code, the attribute values are already fixed.
 */
export function injectJsxSourceMetadata(
  source: string,
  file: string,
  root: string
): InjectionResult | null {
  const absoluteRoot = path.resolve(root);
  const absoluteFile = path.resolve(file);
  const extension = path.extname(absoluteFile).toLowerCase();
  if (
    (extension !== ".tsx" && extension !== ".jsx") ||
    !isInside(absoluteRoot, absoluteFile)
  ) {
    return null;
  }

  let ast: unknown;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      plugins: extension === ".tsx" ? ["jsx", "typescript"] : ["jsx"]
    });
  } catch {
    return null;
  }

  const relativeFile = escapeAttribute(
    normalizeRelativeFile(path.relative(absoluteRoot, absoluteFile))
  );
  const openings: OpeningElement[] = [];
  collectOpeningElements(ast, openings);
  openings.sort((left, right) => left.start - right.start);
  const lineStarts = createLineStarts(source);
  const output = new MagicString(source);

  for (const opening of openings) {
    const sourceTag = sourceTagName(opening.name);
    if (!sourceTag) {
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
    const { line, column } = toLineColumn(lineStarts, opening.start);
    const attributes = [
      hasSourceLocation
        ? ""
        : ` ${SOURCE_FILE_ATTRIBUTE}="${relativeFile}" ${SOURCE_LOCATION_ATTRIBUTE}="${line}:${column}"`,
      hasSourceTag
        ? ""
        : ` ${SOURCE_TAG_ATTRIBUTE}="${escapeAttribute(sourceTag)}"`
    ].join("");
    output.appendLeft(
      opening.name.end,
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
