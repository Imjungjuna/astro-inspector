import { mkdtemp, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSettingsHandler } from "../../src/integration/settings-handler.js";
import { LocatorSettingsStore } from "../../src/settings/store.js";

function requestFor(
  method: "GET" | "PUT",
  body?: unknown,
  token = "session-token"
): IncomingMessage {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  const request = Readable.from(chunks) as Readable & {
    method?: string;
    headers: Record<string, string>;
  };
  request.method = method;
  request.headers = {
    "content-type": "application/json",
    "x-astro-ai-locator-token": token
  };
  return request as unknown as IncomingMessage;
}

function responseRecorder() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk = "") {
      chunks.push(String(chunk));
    }
  } as unknown as ServerResponse;
  return {
    response,
    body: () => chunks.join(""),
    headers
  };
}

async function fixture() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "astro-locator-settings-handler-")
  );
  const settingsPath = path.join(directory, "settings.json");
  const store = new LocatorSettingsStore(settingsPath);
  const handler = createSettingsHandler({
    sessionToken: "session-token",
    store
  });
  return { handler, settingsPath };
}

describe("createSettingsHandler", () => {
  it("returns uncached default settings for an authenticated GET", async () => {
    const { handler } = await fixture();
    const recorder = responseRecorder();

    await handler(requestFor("GET"), recorder.response, vi.fn());

    expect(recorder.response.statusCode).toBe(200);
    expect(recorder.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(recorder.body())).toEqual({
      schemaVersion: 1,
      triggerKey: "alt"
    });
  });

  it("validates and persists an authenticated PUT", async () => {
    const { handler, settingsPath } = await fixture();
    const recorder = responseRecorder();

    await handler(
      requestFor("PUT", { schemaVersion: 1, triggerKey: "control" }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(200);
    expect(JSON.parse(recorder.body())).toEqual({
      schemaVersion: 1,
      triggerKey: "control"
    });
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
      schemaVersion: 1,
      triggerKey: "control"
    });
  });

  it("rejects an unsupported trigger key without writing it", async () => {
    const { handler } = await fixture();
    const recorder = responseRecorder();

    await handler(
      requestFor("PUT", { schemaVersion: 1, triggerKey: "shift" }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(400);
    expect(JSON.parse(recorder.body())).toMatchObject({
      error: expect.stringContaining("trigger key")
    });
  });

  it("rejects requests from a different development session", async () => {
    const { handler } = await fixture();
    const recorder = responseRecorder();

    await handler(
      requestFor("GET", undefined, "wrong-token"),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(403);
  });

  it("returns method not allowed for unsupported methods", async () => {
    const { handler } = await fixture();
    const recorder = responseRecorder();
    const request = requestFor("GET");
    request.method = "POST";

    await handler(request, recorder.response, vi.fn());

    expect(recorder.response.statusCode).toBe(405);
    expect(recorder.headers.allow).toBe("GET, PUT");
  });
});
