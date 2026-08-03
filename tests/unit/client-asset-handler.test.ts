import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createClientAssetHandler } from "../../src/integration/client-asset-handler.js";

async function createDist() {
  const dist = await mkdtemp(path.join(os.tmpdir(), "astro-inspector-dist-"));
  await mkdir(path.join(dist, "client"), { recursive: true });
  await mkdir(path.join(dist, "shared"), { recursive: true });
  await mkdir(path.join(dist, "mcp"), { recursive: true });
  await writeFile(path.join(dist, "client", "index.js"), "export const a = 1;\n");
  await writeFile(path.join(dist, "shared", "contracts.js"), "export const b = 2;\n");
  await writeFile(path.join(dist, "mcp", "cli.js"), "export const secret = 3;\n");
  return dist;
}

function createExchange(url: string) {
  const request = { method: "GET", url } as unknown as IncomingMessage;
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
  let nextCalled = false;
  return {
    request,
    response,
    headers,
    next: () => {
      nextCalled = true;
    },
    body: () => body,
    status: () => response.statusCode,
    nextCalled: () => nextCalled
  };
}

describe("createClientAssetHandler", () => {
  it("serves a client module as JavaScript", async () => {
    const handler = createClientAssetHandler({ distDirectory: await createDist() });
    const exchange = createExchange("/client/index.js");

    await handler(exchange.request, exchange.response, exchange.next);

    expect(exchange.status()).toBe(200);
    expect(exchange.headers["content-type"]).toBe(
      "text/javascript; charset=utf-8"
    );
    expect(exchange.body()).toContain("export const a = 1;");
  });

  it("serves the shared modules the client imports", async () => {
    // 브라우저가 `../shared/contracts.js` 를 정규화해 보내는 바로 그 경로다.
    const handler = createClientAssetHandler({ distDirectory: await createDist() });
    const exchange = createExchange("/shared/contracts.js");

    await handler(exchange.request, exchange.response, exchange.next);

    expect(exchange.status()).toBe(200);
    expect(exchange.body()).toContain("export const b = 2;");
  });

  it("refuses directories outside the client and shared trees", async () => {
    const handler = createClientAssetHandler({ distDirectory: await createDist() });
    const exchange = createExchange("/mcp/cli.js");

    await handler(exchange.request, exchange.response, exchange.next);

    expect(exchange.status()).toBe(404);
    expect(exchange.body()).not.toContain("secret");
  });

  it("refuses traversal outside the package", async () => {
    const handler = createClientAssetHandler({ distDirectory: await createDist() });
    const exchange = createExchange("/client/../../../../etc/passwd");

    await handler(exchange.request, exchange.response, exchange.next);

    expect(exchange.status()).toBe(404);
  });

  it("passes non-GET requests to the next middleware", async () => {
    const handler = createClientAssetHandler({ distDirectory: await createDist() });
    const exchange = createExchange("/client/index.js");
    (exchange.request as { method: string }).method = "POST";

    await handler(exchange.request, exchange.response, exchange.next);

    expect(exchange.nextCalled()).toBe(true);
  });
});
