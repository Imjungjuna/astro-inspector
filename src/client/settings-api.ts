import {
  TRIGGER_KEYS,
  type LocatorClientOptions,
  type LocatorSettings,
  type TriggerKey
} from "../shared/contracts.js";

const DEFAULT_SETTINGS: LocatorSettings = {
  schemaVersion: 1,
  triggerKey: "alt"
};

function isTriggerKey(value: unknown): value is TriggerKey {
  return (
    typeof value === "string" &&
    (TRIGGER_KEYS as readonly string[]).includes(value)
  );
}

function parseSettings(value: unknown): LocatorSettings {
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("triggerKey" in value) ||
    !isTriggerKey(value.triggerKey)
  ) {
    throw new Error("Settings endpoint returned invalid data");
  }
  return {
    schemaVersion: 1,
    triggerKey: value.triggerKey
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
      `astro-ai-locator: unable to load global settings; using Option/Alt (${
        error instanceof Error ? error.message : String(error)
      })`
    );
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveLocatorSettings(
  options: LocatorClientOptions,
  triggerKey: TriggerKey
): Promise<LocatorSettings> {
  const response = await fetch(options.settingsEndpoint, {
    method: "PUT",
    headers: requestHeaders(options),
    body: JSON.stringify({ schemaVersion: 1, triggerKey })
  });
  if (!response.ok) {
    throw new Error(`Settings update failed with HTTP ${response.status}`);
  }
  return parseSettings(await response.json());
}
