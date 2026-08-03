import type { IncomingMessage, ServerResponse } from "node:http";
import type { LocatorSessionState } from "../shared/contracts.js";

type Next = (error?: unknown) => void;

interface SessionHandlerOptions {
  mcpCommand: string;
  mcpArgs: string[];
  sessionToken: string;
}

/**
 * Holds the per-process disable flag. It lives in memory on purpose: writing it
 * to disk would survive a dev server restart, and restarting is the only way
 * the user gets the locator back.
 */
export function createSessionHandler(options: SessionHandlerOptions) {
  let disabled = false;

  const state = (): LocatorSessionState => ({
    disabled,
    mcpCommand: options.mcpCommand,
    mcpArgs: [...options.mcpArgs]
  });

  return async function sessionHandler(
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

    if (request.method !== "GET" && request.method !== "POST") {
      response.statusCode = 405;
      response.setHeader("allow", "GET, POST");
      response.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    if (request.method === "POST") {
      disabled = true;
      request.resume();
    }

    response.statusCode = 200;
    response.end(JSON.stringify(state()));
  };
}
