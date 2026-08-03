import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

type Next = (error?: unknown) => void;

interface ClientAssetHandlerOptions {
  distDirectory: string;
}

/**
 * Only the browser-facing trees are reachable. `client/` imports `shared/` with
 * relative specifiers, so both have to be served, and nothing else does.
 */
const SERVABLE_DIRECTORIES = ["client", "shared"];

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export function createClientAssetHandler(
  options: ClientAssetHandlerOptions
) {
  return async function clientAssetHandler(
    request: IncomingMessage,
    response: ServerResponse,
    next: Next
  ): Promise<void> {
    if (request.method !== "GET") {
      next();
      return;
    }

    try {
      const distRoot = await realpath(path.resolve(options.distDirectory));
      const requested = (request.url ?? "/").split("?", 1)[0] ?? "/";
      const candidate = path.resolve(
        path.join(distRoot, decodeURIComponent(requested))
      );
      const canonical = await realpath(candidate);
      const relative = path.relative(distRoot, canonical);
      const topLevel = relative.split(path.sep)[0] ?? "";
      if (
        !isInside(distRoot, canonical) ||
        !SERVABLE_DIRECTORIES.includes(topLevel) ||
        path.extname(canonical) !== ".js" ||
        !(await stat(canonical)).isFile()
      ) {
        throw new Error("Not a servable locator asset");
      }
      response.statusCode = 200;
      response.setHeader("content-type", "text/javascript; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.end(await readFile(canonical, "utf8"));
    } catch {
      response.statusCode = 404;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end("Not found");
    }
  };
}
