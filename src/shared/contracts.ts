export const LOCATOR_ENDPOINT = "/@astro-inspector/register";
export const LOCATOR_SETTINGS_ENDPOINT = "/@astro-inspector/settings";
export const LOCATOR_SESSION_ENDPOINT = "/@astro-inspector/session";
export const MANIFEST_DIRECTORY = ".astro-ai-locator";
export const MANIFEST_FILENAME = "manifest.json";
export const HASH_PREFIX = "astro_hash_";
export const SOURCE_FILE_ATTRIBUTE = "data-astro-ai-locator-file";
export const SOURCE_LOCATION_ATTRIBUTE = "data-astro-ai-locator-loc";
export const SOURCE_TAG_ATTRIBUTE = "data-astro-ai-locator-source-tag";
export const TRIGGER_KEYS = ["control", "alt", "meta"] as const;
export const COLOR_PRESETS = [
  "neutral",
  "violet",
  "orange",
  "sky"
] as const;
export const PARENT_LEVELS = [0, 1, 2, 3] as const;
export const COPY_MODES = ["hash", "context"] as const;
export const CONTEXT_FIELDS = ["tag", "location", "line"] as const;
export const LOCATION_FORMATS = ["path", "moduleName"] as const;

export type TriggerKey = (typeof TRIGGER_KEYS)[number];
export type ColorPreset = (typeof COLOR_PRESETS)[number];
export type ParentLevels = (typeof PARENT_LEVELS)[number];
export type CopyMode = (typeof COPY_MODES)[number];
export type ContextField = (typeof CONTEXT_FIELDS)[number];
export type LocationFormat = (typeof LOCATION_FORMATS)[number];

export interface LocatorSettings {
  schemaVersion: 5;
  triggerKey: TriggerKey;
  colorPreset: ColorPreset;
  parentLevels: ParentLevels;
  copyMode: CopyMode;
  contextFields: ContextField[];
  locationFormat: LocationFormat;
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
  workspaceFile: string;
}

/**
 * Facts about the running dev server process, not persisted anywhere.
 * `disabled` resets when the dev server restarts, which is the only way to
 * bring the locator back after Quit Extension.
 */
export interface LocatorSessionState {
  disabled: boolean;
  mcpCommand: string;
  mcpArgs: string[];
}

export interface LocatorClientOptions {
  endpoint: string;
  settingsEndpoint: string;
  sessionEndpoint: string;
  sessionToken: string;
  showAllBoundaries: boolean;
}
