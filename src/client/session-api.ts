import type {
  LocatorClientOptions,
  LocatorSessionState
} from "../shared/contracts.js";

function requestHeaders(options: LocatorClientOptions): HeadersInit {
  return {
    "content-type": "application/json",
    "x-astro-ai-locator-token": options.sessionToken
  };
}

function parseSessionState(value: unknown): LocatorSessionState {
  if (
    !value ||
    typeof value !== "object" ||
    !("disabled" in value) ||
    typeof value.disabled !== "boolean" ||
    !("mcpCommand" in value) ||
    typeof value.mcpCommand !== "string" ||
    value.mcpCommand.length === 0 ||
    !("mcpArgs" in value) ||
    !Array.isArray(value.mcpArgs) ||
    value.mcpArgs.some((argument) => typeof argument !== "string")
  ) {
    throw new Error("Session endpoint returned invalid data");
  }
  return {
    disabled: value.disabled,
    mcpCommand: value.mcpCommand,
    mcpArgs: [...value.mcpArgs] as string[]
  };
}

/**
 * Returns `null` when the session state cannot be read. The caller installs the
 * locator anyway: failing closed would kill the tool whenever this endpoint
 * hiccups, which is worse than briefly ignoring a quit.
 */
export async function loadSessionState(
  options: LocatorClientOptions
): Promise<LocatorSessionState | null> {
  try {
    const response = await fetch(options.sessionEndpoint, {
      headers: requestHeaders(options),
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return parseSessionState(await response.json());
  } catch (error) {
    console.warn(
      `astro-inspector: unable to read dev server session state (${
        error instanceof Error ? error.message : String(error)
      })`
    );
    return null;
  }
}

export async function quitLocatorSession(
  options: LocatorClientOptions
): Promise<void> {
  const response = await fetch(options.sessionEndpoint, {
    method: "POST",
    headers: requestHeaders(options)
  });
  if (!response.ok) {
    throw new Error(`Quit failed with HTTP ${response.status}`);
  }
}
