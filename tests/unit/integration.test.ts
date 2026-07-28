import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { astroAiLocator } from "../../src/integration/index.js";

describe("astroAiLocator", () => {
  it("installs the Vite plugin and browser client only for dev", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const integration = astroAiLocator({ showAllBoundaries: false });
    const setup = integration.hooks["astro:config:setup"];
    const updateConfig = vi.fn();
    const injectScript = vi.fn();

    expect(typeof setup).toBe("function");
    if (typeof setup !== "function") {
      throw new Error("Expected astro:config:setup hook");
    }

    await setup({
      command: "dev",
      config: { root: pathToFileURL(`${root}${path.sep}`) },
      updateConfig,
      injectScript
    } as never);

    expect(updateConfig).toHaveBeenCalledOnce();
    expect(updateConfig.mock.calls[0]?.[0]).toMatchObject({
      vite: {
        plugins: [{ name: "astro-ai-locator:dev", apply: "serve" }]
      }
    });
    expect(injectScript).toHaveBeenCalledWith(
      "page",
      expect.stringContaining('import { installLocator } from "astro-ai-locator/client";')
    );
    expect(injectScript.mock.calls[0]?.[1]).toContain(
      '"showAllBoundaries":false'
    );
    expect(injectScript.mock.calls[0]?.[1]).toContain(
      '"/_astro-ai-locator/settings"'
    );
    expect(injectScript.mock.calls[0]?.[1]).not.toContain(
      "serverInstanceId"
    );
  });
});
