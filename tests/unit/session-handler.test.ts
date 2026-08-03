import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createSessionHandler } from "../../src/integration/session-handler.js";

const TOKEN = "session-token";

function createHandler() {
  return createSessionHandler({
    mcpCommand: "/project/node_modules/.bin/astro-inspector-mcp",
    mcpArgs: ["--project-root", "/project"],
    sessionToken: TOKEN
  });
}

function createExchange(method: string, token: string | undefined) {
  const request = {
    method,
    headers: token ? { "x-astro-ai-locator-token": token } : {},
    resume() {}
  } as unknown as IncomingMessage;
  const headers: Record<string, string> = {};
  let body = "";
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(chunk?: string) {
      body = chunk ?? "";
    }
  } as unknown as ServerResponse;
  return {
    request,
    response,
    headers,
    read: () => JSON.parse(body) as Record<string, unknown>,
    status: () => response.statusCode
  };
}

describe("createSessionHandler", () => {
  it("rejects a request without the session token", async () => {
    const handler = createHandler();
    const exchange = createExchange("GET", "wrong");

    await handler(exchange.request, exchange.response, () => {});

    expect(exchange.status()).toBe(403);
    expect(exchange.read().error).toBe("Invalid session token");
  });

  it("rejects methods other than GET and POST", async () => {
    const handler = createHandler();
    const exchange = createExchange("DELETE", TOKEN);

    await handler(exchange.request, exchange.response, () => {});

    expect(exchange.status()).toBe(405);
    expect(exchange.headers.allow).toBe("GET, POST");
  });

  it("starts enabled and reports the MCP command", async () => {
    const handler = createHandler();
    const exchange = createExchange("GET", TOKEN);

    await handler(exchange.request, exchange.response, () => {});

    expect(exchange.status()).toBe(200);
    expect(exchange.read()).toEqual({
      disabled: false,
      mcpCommand: "/project/node_modules/.bin/astro-inspector-mcp",
      mcpArgs: ["--project-root", "/project"]
    });
  });

  it("stays disabled for later reads once quit is posted", async () => {
    const handler = createHandler();
    const quit = createExchange("POST", TOKEN);

    await handler(quit.request, quit.response, () => {});
    expect(quit.read().disabled).toBe(true);

    const reload = createExchange("GET", TOKEN);
    await handler(reload.request, reload.response, () => {});

    expect(reload.read().disabled).toBe(true);
  });
});
