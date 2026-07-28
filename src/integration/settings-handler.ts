import type { IncomingMessage, ServerResponse } from "node:http";
import type { LocatorSettingsStore } from "../settings/store.js";

const MAX_SETTINGS_REQUEST_BYTES = 1024;

type Next = (error?: unknown) => void;

interface SettingsHandlerOptions {
  sessionToken: string;
  store: LocatorSettingsStore;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_SETTINGS_REQUEST_BYTES) {
      throw new Error("Settings request exceeds 1 KiB");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createSettingsHandler(options: SettingsHandlerOptions) {
  return async function settingsHandler(
    request: IncomingMessage,
    response: ServerResponse,
    _next: Next
  ): Promise<void> {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");

    if (request.headers["x-astro-ai-locator-token"] !== options.sessionToken) {
      response.statusCode = 403;
      response.end(JSON.stringify({ error: "Invalid session token" }));
      return;
    }

    if (request.method !== "GET" && request.method !== "PUT") {
      response.statusCode = 405;
      response.setHeader("allow", "GET, PUT");
      response.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    try {
      const settings =
        request.method === "GET"
          ? await options.store.read()
          : await options.store.write(await readJsonBody(request));
      response.statusCode = 200;
      response.end(JSON.stringify(settings));
    } catch (error) {
      response.statusCode = 400;
      response.end(
        JSON.stringify({
          error:
            error instanceof Error ? error.message : "Invalid locator settings"
        })
      );
    }
  };
}
