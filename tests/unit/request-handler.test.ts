import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ManifestStore } from "../../src/manifest/store.js";
import { createRegistrationHandler } from "../../src/integration/request-handler.js";

function requestFor(body: unknown, token = "session-token") {
  const request = Readable.from([JSON.stringify(body)]) as Readable & {
    method?: string;
    headers: Record<string, string>;
  };
  request.method = "POST";
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
      headers[name] = value;
    },
    end(chunk = "") {
      chunks.push(String(chunk));
    }
  } as unknown as ServerResponse;
  return {
    response,
    body: () => chunks.join("")
  };
}

describe("createRegistrationHandler", () => {
  it("returns a workspace-relative file without persisting browser-only data", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "astro-locator-workspace-")
    );
    const root = path.join(workspaceRoot, "apps", "astro");
    await mkdir(root, { recursive: true });
    const source = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "<article>Card</article>\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      workspaceRoot,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor({
        sourceFile: source,
        line: 1,
        column: 1,
        sourceTag: "article",
        domTag: "article"
      }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(200);
    const responseBody = JSON.parse(recorder.body());
    expect(responseBody.token).toMatch(/^#a[0-9a-z]{3}$/);
    expect(responseBody.workspaceFile).toBe("/apps/astro/src/Card.astro");
    expect(responseBody).not.toHaveProperty("absoluteFile");
    const manifest = JSON.parse(
      await readFile(store.manifestPath, "utf8")
    );
    expect(manifest).toEqual({
      schemaVersion: 2,
      entries: {
        [responseBody.token]: {
          file: "src/Card.astro",
          line: 1,
          column: 1,
          sourceTag: "article",
          domTag: "article"
        }
      }
    });
    expect(JSON.stringify(manifest)).not.toContain("workspaceFile");
  });

  it("registers a validated TSX source element", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const source = path.join(root, "src", "Button.tsx");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "export const Button = () => <Link />;\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      workspaceRoot: root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor({
        sourceFile: source,
        line: 1,
        column: 29,
        sourceTag: "Link",
        domTag: "a"
      }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(200);
    expect(JSON.parse(recorder.body())).toMatchObject({
      workspaceFile: "/src/Button.tsx",
      entry: {
        file: "src/Button.tsx",
        line: 1,
        column: 29,
        sourceTag: "Link",
        domTag: "a"
      }
    });
  });

  it("rejects an in-bounds location that does not point to the source tag", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const source = path.join(root, "src", "Breadcrumb.tsx");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "export const Breadcrumb = () => (",
        "  // transformed coordinate landed on this comment",
        "  <BreadcrumbPage>Current</BreadcrumbPage>",
        ");"
      ].join("\n"),
      "utf8"
    );
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      workspaceRoot: root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor({
        sourceFile: source,
        line: 2,
        column: 3,
        sourceTag: "BreadcrumbPage",
        domTag: "span"
      }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(400);
    expect(JSON.parse(recorder.body())).toMatchObject({
      error: expect.stringContaining("source tag")
    });
  });

  it("rejects a source outside the project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "outside-"));
    const source = path.join(outside, "Escape.astro");
    await writeFile(source, "<div>Escape</div>\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      workspaceRoot: root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor({
        sourceFile: source,
        line: 1,
        column: 1,
        sourceTag: "div",
        domTag: "div"
      }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(400);
  });

  it("rejects a request with the wrong development-session token", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const source = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "<article>Card</article>\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      workspaceRoot: root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor(
        {
          sourceFile: source,
          line: 1,
          column: 1,
          sourceTag: "article",
          domTag: "article"
        },
        "wrong-token"
      ),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(403);
  });

  it("rejects an oversized Astro source before reading it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const source = path.join(root, "src", "Large.astro");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "x".repeat(512 * 1024 + 1), "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      workspaceRoot: root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor({
        sourceFile: source,
        line: 1,
        column: 1,
        sourceTag: "div",
        domTag: "div"
      }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(400);
  });

  it("rejects a request body larger than 8 KiB", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      workspaceRoot: root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor({
        sourceFile: "x".repeat(9 * 1024),
        line: 1,
        column: 1,
        sourceTag: "div",
        domTag: "div"
      }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(400);
  });

  it("rejects a source location outside the file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const source = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "<article>Card</article>\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      workspaceRoot: root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor({
        sourceFile: source,
        line: 99,
        column: 1,
        sourceTag: "article",
        domTag: "article"
      }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(400);
  });
});
