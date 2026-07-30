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
  type LocatorClientOptions,
  type LocatorSettings,
  type ParentLevels,
  type TriggerKey
} from "../shared/contracts.js";

const DEFAULT_SETTINGS: LocatorSettings = {
  schemaVersion: 5,
  triggerKey: "alt",
  colorPreset: "violet",
  parentLevels: 1,
  copyMode: "hash",
  contextFields: ["location", "line"],
  locationFormat: "path"
};

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

function parseContextFields(value: unknown): ContextField[] | undefined {
  if (
    !Array.isArray(value) ||
    value.some(
      (field) =>
        typeof field !== "string" ||
        !(CONTEXT_FIELDS as readonly string[]).includes(field)
    ) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  return [...value] as ContextField[];
}

function parseSettings(value: unknown): LocatorSettings {
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 5 ||
    !("triggerKey" in value) ||
    !isTriggerKey(value.triggerKey) ||
    !("colorPreset" in value) ||
    !isColorPreset(value.colorPreset) ||
    !("parentLevels" in value) ||
    !isParentLevels(value.parentLevels) ||
    !("copyMode" in value) ||
    !isCopyMode(value.copyMode) ||
    !("contextFields" in value) ||
    !("locationFormat" in value) ||
    !isLocationFormat(value.locationFormat)
  ) {
    throw new Error("Settings endpoint returned invalid data");
  }
  const contextFields = parseContextFields(value.contextFields);
  if (
    !contextFields ||
    (contextFields.includes("line") &&
      !contextFields.includes("location")) ||
    (value.copyMode === "context" && contextFields.length === 0)
  ) {
    throw new Error("Settings endpoint returned invalid data");
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

function requestHeaders(options: LocatorClientOptions): HeadersInit {
  return {
    "content-type": "application/json",
    "x-astro-ai-locator-token": options.sessionToken
  };
}

export async function loadLocatorSettings(
  options: LocatorClientOptions
): Promise<LocatorSettings> {
  try {
    const response = await fetch(options.settingsEndpoint, {
      headers: requestHeaders(options),
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return parseSettings(await response.json());
  } catch (error) {
    console.warn(
      `astro-inspector: unable to load global settings; using Option/Alt (${
        error instanceof Error ? error.message : String(error)
      })`
    );
    return {
      ...DEFAULT_SETTINGS,
      contextFields: [...DEFAULT_SETTINGS.contextFields]
    };
  }
}

export async function saveLocatorSettings(
  options: LocatorClientOptions,
  settings: LocatorSettings
): Promise<LocatorSettings> {
  const response = await fetch(options.settingsEndpoint, {
    method: "PUT",
    headers: requestHeaders(options),
    body: JSON.stringify(settings)
  });
  if (!response.ok) {
    throw new Error(`Settings update failed with HTTP ${response.status}`);
  }
  return parseSettings(await response.json());
}
