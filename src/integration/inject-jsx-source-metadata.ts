import path from "node:path";
import { parse } from "@babel/parser";
import MagicString, { type SourceMap } from "magic-string";
import { normalizeRelativeFile } from "../manifest/hash.js";
import {
  SOURCE_FILE_ATTRIBUTE,
  SOURCE_LOCATION_ATTRIBUTE,
  SOURCE_TAG_ATTRIBUTE
} from "../shared/contracts.js";

interface InjectionResult {
  code: string;
  map: SourceMap;
}

export interface SourcePosition {
  line: number;
  column: number;
}

export type SourcePositionMapper = (
  position: SourcePosition
) => SourcePosition | null;

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

function pointsToSourceTag(
  sourceLines: string[],
  position: SourcePosition,
  sourceTag: string
): boolean {
  const selectedLine = sourceLines[position.line - 1];
  if (selectedLine === undefined) {
    return false;
  }
  const sourceAtLocation = selectedLine.slice(position.column - 1);
  const tagPrefix = `<${sourceTag}`;
  const tagBoundary = sourceAtLocation[tagPrefix.length];
  return (
    sourceAtLocation.startsWith(tagPrefix) &&
    (tagBoundary === undefined || /[\s/>]/u.test(tagBoundary))
  );
}

function originalPositionsByTag(
  source: string,
  extension: ".jsx" | ".tsx"
): Map<string, SourcePosition[]> {
  let ast: unknown;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      plugins: extension === ".tsx" ? ["jsx", "typescript"] : ["jsx"]
    });
  } catch {
    return new Map();
  }

  const openings: OpeningElement[] = [];
  collectOpeningElements(ast, openings);
  openings.sort((left, right) => left.start - right.start);
  const lineStarts = createLineStarts(source);
  const positions = new Map<string, SourcePosition[]>();
  for (const opening of openings) {
    const sourceTag = sourceTagName(opening.name);
    if (!sourceTag) {
      continue;
    }
    const tagPositions = positions.get(sourceTag) ?? [];
    tagPositions.push(toLineColumn(lineStarts, opening.start));
    positions.set(sourceTag, tagPositions);
  }
  return positions;
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

export function injectJsxSourceMetadata(
  source: string,
  file: string,
  root: string,
  mapPosition?: SourcePositionMapper,
  originalSource?: string
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
  const originalPositions =
    originalSource === undefined
      ? new Map<string, SourcePosition[]>()
      : originalPositionsByTag(originalSource, extension);
  const originalLines = originalSource?.split(/\r?\n/u);
  const occurrenceByTag = new Map<string, number>();

  for (const opening of openings) {
    const sourceTag = sourceTagName(opening.name);
    if (!sourceTag) {
      continue;
    }
    const occurrence = occurrenceByTag.get(sourceTag) ?? 0;
    occurrenceByTag.set(sourceTag, occurrence + 1);
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
    const generatedPosition = toLineColumn(lineStarts, opening.start);
    const mappedPosition = mapPosition
      ? mapPosition(generatedPosition)
      : generatedPosition;
    // Babel-based plugins sometimes return a map for their intermediate code
    // instead of composing it with the original file. Never persist that
    // coordinate unless the expected tag is actually present there.
    const originalPosition =
      originalLines === undefined ||
      (mappedPosition !== null &&
        pointsToSourceTag(originalLines, mappedPosition, sourceTag))
        ? mappedPosition
        : (originalPositions.get(sourceTag)?.[occurrence] ?? null);
    if (!originalPosition) {
      continue;
    }
    const { line, column } = originalPosition;
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
