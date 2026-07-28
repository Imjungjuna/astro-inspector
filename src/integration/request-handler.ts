import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { createElementHash, toProjectRelativeFile } from "../manifest/hash.js";
import { RegisterElementRequestSchema } from "../manifest/schema.js";
import type { ManifestStore } from "../manifest/store.js";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_SOURCE_BYTES = 512 * 1024;
const SOURCE_EXTENSIONS = new Set([".astro", ".jsx", ".tsx"]);

type Next = (error?: unknown) => void;

interface RegistrationHandlerOptions {
  root: string;
  sessionToken: string;
  store: ManifestStore;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("Request body exceeds 8 KiB");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

async function validateSource(
  root: string,
  sourceFile: string,
  line: number,
  column: number,
  sourceTag: string
): Promise<{ canonicalFile: string; canonicalRoot: string }> {
  const candidate = path.isAbsolute(sourceFile)
    ? sourceFile
    : path.resolve(root, sourceFile);
  const canonicalRoot = await realpath(root);
  const canonicalFile = await realpath(candidate);
  if (!isInside(canonicalRoot, canonicalFile)) {
    throw new Error("Source is outside the project root");
  }
  if (!SOURCE_EXTENSIONS.has(path.extname(canonicalFile).toLowerCase())) {
    throw new Error("Source is not a supported Astro UI file");
  }
  const info = await stat(canonicalFile);
  if (!info.isFile() || info.size > MAX_SOURCE_BYTES) {
    throw new Error("Source is not a regular file or exceeds 512 KiB");
  }
  const source = await readFile(canonicalFile, "utf8");
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    throw new Error("Source exceeds 512 KiB");
  }
  const lines = source.split(/\r?\n/u);
  const selectedLine = lines[line - 1];
  if (selectedLine === undefined || column > selectedLine.length + 1) {
    throw new Error("Source location is outside the file");
  }
  const sourceAtLocation = selectedLine.slice(column - 1);
  const tagPrefix = `<${sourceTag}`;
  const tagBoundary = sourceAtLocation[tagPrefix.length];
  if (
    !sourceAtLocation.startsWith(tagPrefix) ||
    (tagBoundary !== undefined && !/[\s/>]/u.test(tagBoundary))
  ) {
    throw new Error("Source location does not point to the source tag");
  }
  return { canonicalFile, canonicalRoot };
}

export function createRegistrationHandler(
  options: RegistrationHandlerOptions
) {
  return async function registrationHandler(
    request: IncomingMessage,
    response: ServerResponse,
    next: Next
  ): Promise<void> {
    if (request.method !== "POST") {
      next();
      return;
    }

    response.setHeader("content-type", "application/json; charset=utf-8");

    try {
      if (
        request.headers["x-astro-ai-locator-token"] !== options.sessionToken
      ) {
        response.statusCode = 403;
        response.end(JSON.stringify({ error: "Invalid session token" }));
        return;
      }

      const input = RegisterElementRequestSchema.parse(
        await readJsonBody(request)
      );
      const { canonicalFile, canonicalRoot } = await validateSource(
        options.root,
        input.sourceFile,
        input.line,
        input.column,
        input.sourceTag
      );
      const entry = {
        file: toProjectRelativeFile(canonicalRoot, canonicalFile),
        line: input.line,
        column: input.column,
        sourceTag: input.sourceTag,
        domTag: input.domTag.toLowerCase()
      };
      const hash = createElementHash(entry);
      await options.store.upsert(hash, entry);
      response.statusCode = 200;
      response.end(JSON.stringify({ hash, entry }));
    } catch (error) {
      response.statusCode = 400;
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Invalid request"
        })
      );
    }
  };
}
