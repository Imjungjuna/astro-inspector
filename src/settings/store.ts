import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  TRIGGER_KEYS,
  type LocatorSettings,
  type TriggerKey
} from "../shared/contracts.js";

export const DEFAULT_LOCATOR_SETTINGS: LocatorSettings = {
  schemaVersion: 1,
  triggerKey: "alt"
};

export function defaultLocatorSettingsPath(
  homeDirectory = os.homedir()
): string {
  return path.join(homeDirectory, ".astro-ai-locator", "settings.json");
}

function isTriggerKey(value: unknown): value is TriggerKey {
  return (
    typeof value === "string" &&
    (TRIGGER_KEYS as readonly string[]).includes(value)
  );
}

export function parseLocatorSettings(value: unknown): LocatorSettings {
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("triggerKey" in value) ||
    !isTriggerKey(value.triggerKey)
  ) {
    throw new Error("Invalid locator settings or trigger key");
  }
  return {
    schemaVersion: 1,
    triggerKey: value.triggerKey
  };
}

export class LocatorSettingsStore {
  readonly settingsPath: string;

  constructor(settingsPath = defaultLocatorSettingsPath()) {
    this.settingsPath = path.resolve(settingsPath);
  }

  async read(): Promise<LocatorSettings> {
    try {
      return parseLocatorSettings(
        JSON.parse(await readFile(this.settingsPath, "utf8"))
      );
    } catch {
      return { ...DEFAULT_LOCATOR_SETTINGS };
    }
  }

  async write(value: unknown): Promise<LocatorSettings> {
    const settings = parseLocatorSettings(value);
    const directory = path.dirname(this.settingsPath);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.settingsPath)}.${process.pid}.${randomUUID()}.tmp`
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });

    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(settings, null, 2)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        }
      );
      await rename(temporaryPath, this.settingsPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    return settings;
  }
}
