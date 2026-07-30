import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCATOR_SETTINGS,
  LocatorSettingsStore,
  defaultLocatorSettingsPath,
  parseLocatorSettings
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

  it("migrates schema v1 to schema v5 with Copy As defaults", async () => {
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
      schemaVersion: 5,
      triggerKey: "control",
      colorPreset: "violet",
      parentLevels: 1,
      copyMode: "hash",
      contextFields: ["location", "line"],
      locationFormat: "path"
    });
  });

  it("migrates schema v2 to schema v5 while preserving known values", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "astro-locator-settings-")
    );
    const settingsPath = path.join(directory, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify({
        schemaVersion: 2,
        triggerKey: "meta",
        colorPreset: "sky"
      }),
      "utf8"
    );
    const store = new LocatorSettingsStore(settingsPath);

    await expect(store.read()).resolves.toEqual({
      schemaVersion: 5,
      triggerKey: "meta",
      colorPreset: "sky",
      parentLevels: 1,
      copyMode: "hash",
      contextFields: ["location", "line"],
      locationFormat: "path"
    });
  });

  it("migrates schema v3 to schema v5 while preserving known values", async () => {
    expect(
      parseLocatorSettings({
        schemaVersion: 3,
        triggerKey: "meta",
        colorPreset: "sky",
        parentLevels: 2
      })
    ).toEqual({
      schemaVersion: 5,
      triggerKey: "meta",
      colorPreset: "sky",
      parentLevels: 2,
      copyMode: "hash",
      contextFields: ["location", "line"],
      locationFormat: "path"
    });
  });

  it.each(["relative", "absolute"] as const)(
    "migrates schema v4 %s Module settings to workspace Path",
    (modulePath) => {
      expect(
        parseLocatorSettings({
          schemaVersion: 4,
          triggerKey: "meta",
          colorPreset: "sky",
          parentLevels: 2,
          copyMode: "context",
          contextFields: ["tag", "module", "line"],
          modulePath
        })
      ).toEqual({
        schemaVersion: 5,
        triggerKey: "meta",
        colorPreset: "sky",
        parentLevels: 2,
        copyMode: "context",
        contextFields: ["tag", "location", "line"],
        locationFormat: "path"
      });
    }
  );

  it("migrates empty schema v4 Hash fields without inventing context", () => {
    expect(
      parseLocatorSettings({
        schemaVersion: 4,
        triggerKey: "alt",
        colorPreset: "violet",
        parentLevels: 1,
        copyMode: "hash",
        contextFields: [],
        modulePath: "absolute"
      })
    ).toEqual({
      schemaVersion: 5,
      triggerKey: "alt",
      colorPreset: "violet",
      parentLevels: 1,
      copyMode: "hash",
      contextFields: [],
      locationFormat: "path"
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
      store.write({
        schemaVersion: 5,
        triggerKey: "meta",
        colorPreset: "orange",
        parentLevels: 3,
        copyMode: "context",
        contextFields: ["tag", "location", "line"],
        locationFormat: "moduleName"
      })
    ).resolves.toEqual({
      schemaVersion: 5,
      triggerKey: "meta",
      colorPreset: "orange",
      parentLevels: 3,
      copyMode: "context",
      contextFields: ["tag", "location", "line"],
      locationFormat: "moduleName"
    });
    await expect(
      JSON.parse(await readFile(settingsPath, "utf8"))
    ).toEqual({
      schemaVersion: 5,
      triggerKey: "meta",
      colorPreset: "orange",
      parentLevels: 3,
      copyMode: "context",
      contextFields: ["tag", "location", "line"],
      locationFormat: "moduleName"
    });
    await expect(readdir(path.dirname(settingsPath))).resolves.toEqual([
      "settings.json"
    ]);

    await store.write({
      schemaVersion: 5,
      triggerKey: "alt",
      colorPreset: "neutral",
      parentLevels: 0,
      copyMode: "hash",
      contextFields: [],
      locationFormat: "moduleName"
    });
    await expect(
      JSON.parse(await readFile(settingsPath, "utf8"))
    ).toEqual({
      schemaVersion: 5,
      triggerKey: "alt",
      colorPreset: "neutral",
      parentLevels: 0,
      copyMode: "hash",
      contextFields: [],
      locationFormat: "moduleName"
    });
  });

  it("rejects an unsupported trigger key without touching the file", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "astro-locator-settings-")
    );
    const settingsPath = path.join(directory, "settings.json");
    const store = new LocatorSettingsStore(settingsPath);

    await expect(
      store.write({
        schemaVersion: 5,
        triggerKey: "shift",
        colorPreset: "violet",
        parentLevels: 1,
        copyMode: "hash",
        contextFields: ["location", "line"],
        locationFormat: "path"
      } as never)
    ).rejects.toThrow("trigger key");
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("rejects an unsupported color preset without touching the file", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "astro-locator-settings-")
    );
    const settingsPath = path.join(directory, "settings.json");
    const store = new LocatorSettingsStore(settingsPath);

    await expect(
      store.write({
        schemaVersion: 5,
        triggerKey: "alt",
        colorPreset: "pink",
        parentLevels: 1,
        copyMode: "hash",
        contextFields: ["location", "line"],
        locationFormat: "path"
      } as never)
    ).rejects.toThrow("color preset");
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it.each([-1, 1.5, 4, "1"])(
    "rejects invalid parent level %s without touching the file",
    async (parentLevels) => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "astro-locator-settings-")
      );
      const settingsPath = path.join(directory, "settings.json");
      const store = new LocatorSettingsStore(settingsPath);

      await expect(
        store.write({
          schemaVersion: 5,
          triggerKey: "alt",
          colorPreset: "violet",
          parentLevels,
          copyMode: "hash",
          contextFields: ["location", "line"],
          locationFormat: "path"
        })
      ).rejects.toThrow("parent levels");
      await expect(readdir(directory)).resolves.toEqual([]);
    }
  );

  it.each([
    ["unknown values", ["tag", "style"]],
    ["duplicate values", ["location", "location"]]
  ])("rejects context fields with %s", async (_label, contextFields) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "astro-locator-settings-")
    );
    const store = new LocatorSettingsStore(
      path.join(directory, "settings.json")
    );

    await expect(
      store.write({
        schemaVersion: 5,
        triggerKey: "alt",
        colorPreset: "violet",
        parentLevels: 1,
        copyMode: "context",
        contextFields,
        locationFormat: "path"
      })
    ).rejects.toThrow("context fields");
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("rejects Line without Location", () => {
    expect(() =>
      parseLocatorSettings({
        schemaVersion: 5,
        triggerKey: "alt",
        colorPreset: "violet",
        parentLevels: 1,
        copyMode: "context",
        contextFields: ["line"],
        locationFormat: "path"
      })
    ).toThrow("Line requires Location");
  });

  it("rejects Context mode without fields", () => {
    expect(() =>
      parseLocatorSettings({
        schemaVersion: 5,
        triggerKey: "alt",
        colorPreset: "violet",
        parentLevels: 1,
        copyMode: "context",
        contextFields: [],
        locationFormat: "path"
      })
    ).toThrow("Context mode requires");
  });

  it("allows Hash mode with no fields and retains the path preference", () => {
    expect(
      parseLocatorSettings({
        schemaVersion: 5,
        triggerKey: "alt",
        colorPreset: "violet",
        parentLevels: 1,
        copyMode: "hash",
        contextFields: [],
        locationFormat: "moduleName"
      })
    ).toEqual({
      schemaVersion: 5,
      triggerKey: "alt",
      colorPreset: "violet",
      parentLevels: 1,
      copyMode: "hash",
      contextFields: [],
      locationFormat: "moduleName"
    });
  });

  it.each([
    {
      label: "copy mode",
      copyMode: "snippet",
      locationFormat: "path",
      error: "copy mode"
    },
    {
      label: "location format",
      copyMode: "hash",
      locationFormat: "filename",
      error: "location format"
    }
  ])(
    "rejects an unsupported $label",
    ({ copyMode, locationFormat, error }) => {
      expect(() =>
        parseLocatorSettings({
          schemaVersion: 5,
          triggerKey: "alt",
          colorPreset: "violet",
          parentLevels: 1,
          copyMode,
          contextFields: ["location"],
          locationFormat
        })
      ).toThrow(error);
    }
  );
});
