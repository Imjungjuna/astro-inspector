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
  // 반복 항목일 때만, 설정과 무관하게 붙는다. 어느 항목인지가 위치보다 먼저 필요하다.
  const instanceLabel = registration.entry.instanceLabel;
  if (instanceLabel) {
    parts.push(instanceLabel);
  }
  if (parts.length === 0) {
    throw new Error("Context copy requires at least one context field");
  }
  return parts.join(" | ");
}
