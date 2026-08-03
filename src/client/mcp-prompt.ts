import type { LocatorSessionState } from "../shared/contracts.js";

/**
 * Builds the message the user pastes into an AI agent. The agent works out
 * which MCP host it is running in, so the product never has to branch on it.
 */
export function formatMcpSetupPrompt(state: LocatorSessionState): string {
  const config = JSON.stringify(
    {
      mcpServers: {
        "astro-inspector": {
          command: state.mcpCommand,
          args: state.mcpArgs
        }
      }
    },
    null,
    2
  );

  return [
    "Set up the astro-inspector MCP server for this project, then confirm it",
    "responds.",
    "",
    "Add this entry to the MCP config for whichever host you are running in.",
    "Claude Code uses .mcp.json at the project root; Cursor uses",
    ".cursor/mcp.json. Both take the same shape, so merge it into an existing",
    "mcpServers object instead of replacing the file.",
    "",
    config,
    "",
    "Reconnect MCP servers afterwards. From then on, whenever I paste a value",
    "starting with astro_hash_, call get_astro_element_by_hash to resolve it to",
    "a source file, line, and column before editing anything."
  ].join("\n");
}
