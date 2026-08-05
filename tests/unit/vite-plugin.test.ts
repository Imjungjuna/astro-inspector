import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HmrContext } from "vite";
import { describe, expect, it } from "vitest";
import { createLocatorVitePlugin } from "../../src/integration/vite-plugin.js";
import { ManifestStore } from "../../src/manifest/store.js";
import { createSessionState } from "../../src/integration/session-state.js";
import { LocatorSettingsStore } from "../../src/settings/store.js";
import {
  LOCATOR_ENDPOINT,
  LOCATOR_SESSION_ENDPOINT,
  LOCATOR_SETTINGS_ENDPOINT
} from "../../src/shared/contracts.js";

describe("createLocatorVitePlugin", () => {
  it("runs before Astro and injects source metadata into raw Astro code", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const file = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "<article>Card</article>", "utf8");
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token"
    });
    const load = plugin.load;

    expect(plugin.enforce).toBe("pre");
    expect(typeof load).toBe("function");
    if (typeof load !== "function") {
      throw new Error("Expected a callable load hook");
    }

    const result = await load.call(
      { addWatchFile() {} } as never,
      file
    );

    expect(result).toMatchObject({
      code: expect.stringContaining(
        'data-astro-ai-locator-file="src/Card.astro"'
      )
    });
  });

  it("injects source metadata into TSX from the file on disk", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const file = path.join(root, "src", "Button.tsx");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      "export const Button = () => <button>Save</button>;",
      "utf8"
    );
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token"
    });
    const load = plugin.load;

    expect(typeof load).toBe("function");
    if (typeof load !== "function") {
      throw new Error("Expected a callable load hook");
    }

    const result = await load.call({ addWatchFile() {} } as never, file);

    expect(result).toMatchObject({
      code: expect.stringContaining(
        'data-astro-ai-locator-file="src/Button.tsx"'
      )
    });
  });

  it("ignores source files requested with a query so ?raw stays verbatim", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const file = path.join(root, "src", "Button.tsx");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      "export const Button = () => <button>Save</button>;",
      "utf8"
    );
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token"
    });
    const load = plugin.load;
    if (typeof load !== "function") {
      throw new Error("Expected a callable load hook");
    }

    expect(
      await load.call({ addWatchFile() {} } as never, `${file}?raw`)
    ).toBeNull();
  });

  it("ignores generated manifest files without ignoring source files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token"
    });
    const config = plugin.config;

    expect(typeof config).toBe("function");
    if (typeof config !== "function") {
      throw new Error("Expected a callable config hook");
    }
    const result = await config.call({} as never, {}, {
      command: "serve",
      mode: "development",
      isPreview: false,
      isSsrBuild: false
    });
    if (!result || typeof result !== "object") {
      throw new Error("Expected the config hook to return Vite config");
    }
    const ignored = result.server?.watch?.ignored;
    const matchers = Array.isArray(ignored) ? ignored : [ignored];
    const isIgnored = (file: string) =>
      matchers.some(
        (matcher) => typeof matcher === "function" && matcher(file)
      );

    expect(
      isIgnored(
        path.join(root, ".astro-ai-locator", "manifest.json")
      )
    ).toBe(true);
    expect(isIgnored(path.join(root, "src", "Card.tsx"))).toBe(false);
  });

  it("mounts registration and global-settings middleware separately", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const settingsStore = new LocatorSettingsStore(
      path.join(root, "test-settings.json")
    );
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token",
      settingsStore
    });
    const configureServer = plugin.configureServer;
    if (typeof configureServer !== "function") {
      throw new Error("Expected a callable configureServer hook");
    }
    const mountedPaths: string[] = [];

    configureServer.call({} as never, {
      middlewares: {
        use(route: string) {
          mountedPaths.push(route);
        }
      },
      watcher: {
        on() {},
        off() {}
      },
      httpServer: null,
      config: {
        logger: {
          error() {}
        }
      }
    } as never);

    expect(mountedPaths).toEqual([
      "/@astro-inspector/register",
      "/@astro-inspector/settings",
      "/@astro-inspector/session",
      "/@astro-inspector"
    ]);
  });

  it("invalidates only entries for the changed Astro file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token",
      store
    });
    await store.reset();
    await store.issue({
      file: "src/Card.astro",
      line: 1,
      column: 1,
      sourceTag: "article",
      domTag: "article"
    });
    const kept = await store.issue({
      file: "src/Header.astro",
      line: 1,
      column: 1,
      sourceTag: "header",
      domTag: "header"
    });

    const hook = plugin.handleHotUpdate;
    if (typeof hook !== "function") {
      throw new Error("Expected a callable handleHotUpdate hook");
    }
    await hook.call(
      {} as never,
      { file: path.join(root, "src", "Card.astro") } as HmrContext
    );

    expect(Object.keys((await store.readSnapshot()).entries)).toEqual([kept]);
  });

  it("invalidates entries for a changed TSX source file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token",
      store
    });
    await store.reset();
    await store.issue({
      file: "src/Button.tsx",
      line: 1,
      column: 29,
      sourceTag: "button",
      domTag: "button"
    });

    const hook = plugin.handleHotUpdate;
    if (typeof hook !== "function") {
      throw new Error("Expected a callable handleHotUpdate hook");
    }
    await hook.call(
      {} as never,
      { file: path.join(root, "src", "Button.tsx") } as HmrContext
    );

    expect((await store.readSnapshot()).entries).toEqual({});
  });

  it("stops injecting once the session is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const file = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "<article>Card</article>", "utf8");
    const session = createSessionState();
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token",
      session
    });
    const load = plugin.load;
    if (typeof load !== "function") {
      throw new Error("Expected a callable load hook");
    }

    session.disable();

    expect(await load.call({ addWatchFile() {} } as never, file)).toBeNull();
  });

  it("answers registration with 410 once the session is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const session = createSessionState();
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token",
      session
    });
    const configureServer = plugin.configureServer;
    if (typeof configureServer !== "function") {
      throw new Error("Expected a callable configureServer hook");
    }
    const routes = new Map<string, (request: unknown, response: unknown, next: () => void) => void>();

    configureServer.call({} as never, {
      middlewares: {
        use(route: string, handler: (request: unknown, response: unknown, next: () => void) => void) {
          routes.set(route, handler);
        }
      },
      watcher: { on() {}, off() {} },
      httpServer: null,
      config: { logger: { error() {} } }
    } as never);

    session.disable();

    const register = routes.get(LOCATOR_ENDPOINT);
    if (!register) {
      throw new Error("Registration middleware was not mounted");
    }
    let statusCode = 0;
    let body = "";
    register(
      { method: "POST", headers: {} },
      {
        setHeader() {},
        set statusCode(value: number) {
          statusCode = value;
        },
        get statusCode() {
          return statusCode;
        },
        end(chunk?: string) {
          body = chunk ?? "";
        }
      },
      () => {
        throw new Error("Disabled registration must not fall through");
      }
    );

    expect(statusCode).toBe(410);
    expect(JSON.parse(body).error).toBe("Locator is closed for this dev server");
  });

  it("detaches the unlink watcher once the session is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const session = createSessionState();
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token",
      session
    });
    const configureServer = plugin.configureServer;
    if (typeof configureServer !== "function") {
      throw new Error("Expected a callable configureServer hook");
    }
    const detached: string[] = [];

    configureServer.call({} as never, {
      middlewares: { use() {} },
      watcher: {
        on() {},
        off(event: string) {
          detached.push(event);
        }
      },
      httpServer: null,
      config: { logger: { error() {} } },
      environments: {}
    } as never);

    session.disable();

    expect(detached).toContain("unlink");
  });
});
