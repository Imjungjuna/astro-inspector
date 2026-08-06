import type { IncomingMessage, ServerResponse } from "node:http";
import type { LocatorSessionState } from "../shared/contracts.js";
import type { LocatorSessionStateStore } from "./session-state.js";

type Next = (error?: unknown) => void;

interface SessionHandlerOptions {
  mcpCommand: string;
  mcpArgs: string[];
  sessionToken: string;
  state: LocatorSessionStateStore;
}

export function createSessionHandler(options: SessionHandlerOptions) {
  const state = (): LocatorSessionState => ({
    disabled: options.state.isDisabled(),
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
      options.state.disable();
      request.resume();
    }

    response.statusCode = 200;
    response.end(JSON.stringify(state()));
  };
}
