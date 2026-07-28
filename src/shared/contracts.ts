export const LOCATOR_ENDPOINT = "/_astro-ai-locator/register";
export const LOCATOR_SETTINGS_ENDPOINT = "/_astro-ai-locator/settings";
export const MANIFEST_DIRECTORY = ".astro-ai-locator";
export const MANIFEST_FILENAME = "manifest.json";
export const HASH_PREFIX = "astro_hash_";
export const SOURCE_FILE_ATTRIBUTE = "data-astro-ai-locator-file";
export const SOURCE_LOCATION_ATTRIBUTE = "data-astro-ai-locator-loc";
export const SOURCE_TAG_ATTRIBUTE = "data-astro-ai-locator-source-tag";
export const TRIGGER_KEYS = ["control", "alt", "meta"] as const;

export type TriggerKey = (typeof TRIGGER_KEYS)[number];

export interface LocatorSettings {
  schemaVersion: 1;
  triggerKey: TriggerKey;
}

export interface LocatorManifestEntry {
  file: string;
  line: number;
  column: number;
  sourceTag: string;
  domTag: string;
}

export interface LocatorManifest {
  schemaVersion: 1;
  entries: Record<string, LocatorManifestEntry>;
}

export interface RegisterElementRequest {
  sourceFile: string;
  line: number;
  column: number;
  sourceTag: string;
  domTag: string;
}

export interface RegisterElementResponse {
  hash: string;
  entry: LocatorManifestEntry;
}

export interface LocatorClientOptions {
  endpoint: string;
  settingsEndpoint: string;
  sessionToken: string;
  showAllBoundaries: boolean;
}
