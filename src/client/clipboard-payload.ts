import type {
  LocatorSettings,
  RegisterElementResponse
} from "../shared/contracts.js";

function formatTag(registration: RegisterElementResponse): string {
  const { sourceTag, domTag } = registration.entry;
  return sourceTag === domTag
    ? `<${sourceTag}>`
    : `<${sourceTag}→${domTag}>`;
}

function formatLocation(
  registration: RegisterElementResponse,
  settings: LocatorSettings
): string {
  const file =
    settings.locationFormat === "moduleName"
      ? registration.workspaceFile.split("/").at(-1)
      : registration.workspaceFile;
  if (!file) {
    throw new Error("Registration returned an invalid workspace file");
  }
  return settings.contextFields.includes("line")
    ? `${file}:${registration.entry.line}:${registration.entry.column}`
    : file;
}

export function formatClipboardPayload(
  registration: RegisterElementResponse,
  settings: LocatorSettings
): string {
  if (settings.copyMode === "hash") {
    return registration.token;
  }

  const parts: string[] = [];
  if (settings.contextFields.includes("tag")) {
    parts.push(formatTag(registration));
  }
  if (settings.contextFields.includes("location")) {
    parts.push(formatLocation(registration, settings));
  }
  if (parts.length === 0) {
    throw new Error("Context copy requires at least one context field");
  }
  return parts.join(" | ");
}
