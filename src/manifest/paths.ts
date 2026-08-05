import path from "node:path";

export function normalizeRelativeFile(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

export function toProjectRelativeFile(
  root: string,
  absoluteFile: string
): string {
  return normalizeRelativeFile(path.relative(root, absoluteFile));
}
