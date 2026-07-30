import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  COLOR_PRESETS,
  CONTEXT_FIELDS,
  COPY_MODES,
  LOCATION_FORMATS,
  PARENT_LEVELS,
  TRIGGER_KEYS,
  type ColorPreset,
  type ContextField,
  type CopyMode,
  type LocationFormat,
  type LocatorSettings,
  type ParentLevels,
  type TriggerKey
} from "../shared/contracts.js";

export const DEFAULT_LOCATOR_SETTINGS: LocatorSettings = {
  schemaVersion: 5,
  triggerKey: "alt",
  colorPreset: "violet",
  parentLevels: 1,
  copyMode: "hash",
  contextFields: ["location", "line"],
  locationFormat: "path"
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

function isColorPreset(value: unknown): value is ColorPreset {
  return (
    typeof value === "string" &&
    (COLOR_PRESETS as readonly string[]).includes(value)
  );
}

function isParentLevels(value: unknown): value is ParentLevels {
  return PARENT_LEVELS.includes(value as ParentLevels);
}

function isCopyMode(value: unknown): value is CopyMode {
  return (
    typeof value === "string" &&
    (COPY_MODES as readonly string[]).includes(value)
  );
}

function isLocationFormat(value: unknown): value is LocationFormat {
  return (
    typeof value === "string" &&
    (LOCATION_FORMATS as readonly string[]).includes(value)
  );
}

function parseContextFields(value: unknown): ContextField[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (field) =>
        typeof field !== "string" ||
        !(CONTEXT_FIELDS as readonly string[]).includes(field)
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("Invalid locator settings or context fields");
  }
  return [...value] as ContextField[];
}

function copyDefaults(): Pick<
  LocatorSettings,
  "copyMode" | "contextFields" | "locationFormat"
> {
  return {
    copyMode: DEFAULT_LOCATOR_SETTINGS.copyMode,
    contextFields: [...DEFAULT_LOCATOR_SETTINGS.contextFields],
    locationFormat: DEFAULT_LOCATOR_SETTINGS.locationFormat
  };
}

function cloneSettings(settings: LocatorSettings): LocatorSettings {
  return {
    ...settings,
    contextFields: [...settings.contextFields]
  };
}

export function parseLocatorSettings(value: unknown): LocatorSettings {
  if (
    !value ||
    typeof value !== "object" ||
    !("triggerKey" in value) ||
    !isTriggerKey(value.triggerKey)
  ) {
    throw new Error("Invalid locator settings or trigger key");
  }
  if ("schemaVersion" in value && value.schemaVersion === 1) {
    return {
      schemaVersion: 5,
      triggerKey: value.triggerKey,
      colorPreset: "violet",
      parentLevels: 1,
      ...copyDefaults()
    };
  }
  if (
    !("schemaVersion" in value) ||
    (value.schemaVersion !== 2 &&
      value.schemaVersion !== 3 &&
      value.schemaVersion !== 4 &&
      value.schemaVersion !== 5) ||
    !("colorPreset" in value) ||
    !isColorPreset(value.colorPreset)
  ) {
    throw new Error("Invalid locator settings or color preset");
  }
  if (value.schemaVersion === 2) {
    return {
      schemaVersion: 5,
      triggerKey: value.triggerKey,
      colorPreset: value.colorPreset,
      parentLevels: 1,
      ...copyDefaults()
    };
  }
  if (
    !("parentLevels" in value) ||
    !isParentLevels(value.parentLevels)
  ) {
    throw new Error("Invalid locator settings or parent levels");
  }
  if (value.schemaVersion === 3) {
    return {
      schemaVersion: 5,
      triggerKey: value.triggerKey,
      colorPreset: value.colorPreset,
      parentLevels: value.parentLevels,
      ...copyDefaults()
    };
  }
  if (!("copyMode" in value) || !isCopyMode(value.copyMode)) {
    throw new Error("Invalid locator settings or copy mode");
  }
  if (value.schemaVersion === 4) {
    if (!("contextFields" in value) || !Array.isArray(value.contextFields)) {
      throw new Error("Invalid locator settings or context fields");
    }
    const oldFields = value.contextFields;
    if (
      oldFields.some(
        (field) =>
          typeof field !== "string" ||
          !["tag", "module", "line"].includes(field)
      ) ||
      new Set(oldFields).size !== oldFields.length
    ) {
      throw new Error("Invalid locator settings or context fields");
    }
    if (oldFields.includes("line") && !oldFields.includes("module")) {
      throw new Error("Line requires Module");
    }
    if (value.copyMode === "context" && oldFields.length === 0) {
      throw new Error("Context mode requires at least one context field");
    }
    if (
      !("modulePath" in value) ||
      (value.modulePath !== "relative" && value.modulePath !== "absolute")
    ) {
      throw new Error("Invalid locator settings or module path");
    }
    const contextFields = oldFields.map((field) =>
      field === "module" ? "location" : field
    ) as ContextField[];
    return {
      schemaVersion: 5,
      triggerKey: value.triggerKey,
      colorPreset: value.colorPreset,
      parentLevels: value.parentLevels,
      copyMode: value.copyMode,
      contextFields,
      locationFormat: "path"
    };
  }
  if (!("contextFields" in value)) {
    throw new Error("Invalid locator settings or context fields");
  }
  const contextFields = parseContextFields(value.contextFields);
  if (contextFields.includes("line") && !contextFields.includes("location")) {
    throw new Error("Line requires Location");
  }
  if (value.copyMode === "context" && contextFields.length === 0) {
    throw new Error("Context mode requires at least one context field");
  }
  if (
    !("locationFormat" in value) ||
    !isLocationFormat(value.locationFormat)
  ) {
    throw new Error("Invalid locator settings or location format");
  }
  return {
    schemaVersion: 5,
    triggerKey: value.triggerKey,
    colorPreset: value.colorPreset,
    parentLevels: value.parentLevels,
    copyMode: value.copyMode,
    contextFields,
    locationFormat: value.locationFormat
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
      return cloneSettings(DEFAULT_LOCATOR_SETTINGS);
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
