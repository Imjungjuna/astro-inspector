import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCATOR_SETTINGS,
  LocatorSettingsStore,
  defaultLocatorSettingsPath
} from "../../src/settings/store.js";

describe("LocatorSettingsStore", () => {
  it("uses one settings file below the user home directory", () => {
    expect(defaultLocatorSettingsPath("/Users/example")).toBe(
      path.join("/Users/example", ".astro-ai-locator", "settings.json")
    );
  });

  it("returns Alt defaults without creating a missing settings file", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "astro-locator-settings-")
    );
    const settingsPath = path.join(directory, "settings.json");
    const store = new LocatorSettingsStore(settingsPath);

    await expect(store.read()).resolves.toEqual(DEFAULT_LOCATOR_SETTINGS);
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("reads a valid global trigger key", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "astro-locator-settings-")
    );
    const settingsPath = path.join(directory, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify({ schemaVersion: 1, triggerKey: "control" }),
      "utf8"
    );
    const store = new LocatorSettingsStore(settingsPath);

    await expect(store.read()).resolves.toEqual({
      schemaVersion: 1,
      triggerKey: "control"
    });
  });

  it("falls back to Alt when persisted settings are malformed", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "astro-locator-settings-")
    );
    const settingsPath = path.join(directory, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify({ schemaVersion: 1, triggerKey: "shift" }),
      "utf8"
    );
    const store = new LocatorSettingsStore(settingsPath);

    await expect(store.read()).resolves.toEqual(DEFAULT_LOCATOR_SETTINGS);
  });

  it("atomically creates and replaces validated settings", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "astro-locator-settings-")
    );
    const settingsPath = path.join(directory, "nested", "settings.json");
    const store = new LocatorSettingsStore(settingsPath);

    await expect(
      store.write({ schemaVersion: 1, triggerKey: "meta" })
    ).resolves.toEqual({ schemaVersion: 1, triggerKey: "meta" });
    await expect(
      JSON.parse(await readFile(settingsPath, "utf8"))
    ).toEqual({
      schemaVersion: 1,
      triggerKey: "meta"
    });
    await expect(readdir(path.dirname(settingsPath))).resolves.toEqual([
      "settings.json"
    ]);

    await store.write({ schemaVersion: 1, triggerKey: "alt" });
    await expect(
      JSON.parse(await readFile(settingsPath, "utf8"))
    ).toEqual({
      schemaVersion: 1,
      triggerKey: "alt"
    });
  });

  it("rejects an unsupported trigger key without touching the file", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "astro-locator-settings-")
    );
    const settingsPath = path.join(directory, "settings.json");
    const store = new LocatorSettingsStore(settingsPath);

    await expect(
      store.write({ schemaVersion: 1, triggerKey: "shift" } as never)
    ).rejects.toThrow("trigger key");
    await expect(readdir(directory)).resolves.toEqual([]);
  });
});
