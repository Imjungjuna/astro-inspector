import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { LocatorManifestSchema } from "../manifest/schema.js";
import {
  MANIFEST_DIRECTORY,
  MANIFEST_FILENAME
} from "../shared/contracts.js";

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 512 * 1024;
const SOURCE_EXTENSIONS = new Set([".astro", ".jsx", ".tsx"]);

export interface ResolvedAstroElement {
  hash: string;
  relativeFile: string;
  absoluteFile: string;
  line: number;
  column: number;
  sourceTag: string;
  domTag: string;
  excerpt: string;
}

interface ResolveElementOptions {
  projectRoot: string;
  hash: string;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function readLimitedFile(
  file: string,
  maximumBytes: number
): Promise<string> {
  const info = await stat(file);
  if (!info.isFile() || info.size > maximumBytes) {
    throw new Error("Locator file is missing or exceeds its size limit");
  }
  const text = await readFile(file, "utf8");
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new Error("Locator file is missing or exceeds its size limit");
  }
  return text;
}

function createExcerpt(source: string, selectedLine: number): string {
  const lines = source.split(/\r?\n/u);
  const start = Math.max(0, selectedLine - 4);
  const end = Math.min(lines.length, selectedLine + 3);
  return lines
    .slice(start, end)
    .map((line, index) => `${start + index + 1} | ${line}`)
    .join("\n");
}

export async function resolveElementByHash(
  options: ResolveElementOptions
): Promise<ResolvedAstroElement> {
  if (!/^astro_hash_[a-f0-9]{24}$/u.test(options.hash)) {
    throw new Error("Invalid Astro element hash");
  }

  const projectRoot = await realpath(path.resolve(options.projectRoot));
  const manifestPath = path.join(
    projectRoot,
    MANIFEST_DIRECTORY,
    MANIFEST_FILENAME
  );
  const canonicalManifest = await realpath(manifestPath);
  if (!isInside(projectRoot, canonicalManifest)) {
    throw new Error("Locator manifest escapes the Astro project");
  }
  const manifest = LocatorManifestSchema.parse(
    JSON.parse(await readLimitedFile(canonicalManifest, MAX_MANIFEST_BYTES))
  );
  const entry = manifest.entries[options.hash];
  if (!entry) {
    throw new Error(`Unknown Astro element hash: ${options.hash}`);
  }

  const sourcePath = path.resolve(projectRoot, entry.file);
  const canonicalSource = await realpath(sourcePath);
  if (
    !isInside(projectRoot, canonicalSource) ||
    !SOURCE_EXTENSIONS.has(path.extname(canonicalSource).toLowerCase())
  ) {
    throw new Error("Manifest entry escapes the Astro project");
  }
  const source = await readLimitedFile(canonicalSource, MAX_SOURCE_BYTES);
  const selectedLine = source.split(/\r?\n/u)[entry.line - 1];
  if (selectedLine === undefined || entry.column > selectedLine.length + 1) {
    throw new Error("Manifest location is outside the UI source");
  }

  return {
    hash: options.hash,
    relativeFile: entry.file,
    absoluteFile: canonicalSource,
    line: entry.line,
    column: entry.column,
    sourceTag: entry.sourceTag,
    domTag: entry.domTag,
    excerpt: createExcerpt(source, entry.line)
  };
}
