import { createHash } from "node:crypto";
import path from "node:path";
import { HASH_PREFIX, type LocatorManifestEntry } from "../shared/contracts.js";

export function normalizeRelativeFile(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

export function createElementHash(entry: LocatorManifestEntry): string {
  const identity = [
    "v1",
    normalizeRelativeFile(entry.file),
    String(entry.line),
    String(entry.column),
    entry.domTag.toLowerCase()
  ].join("\0");

  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  return `${HASH_PREFIX}${digest.slice(0, 24)}`;
}

export function toProjectRelativeFile(
  root: string,
  absoluteFile: string
): string {
  return normalizeRelativeFile(path.relative(root, absoluteFile));
}
