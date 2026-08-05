import { describe, expect, it } from "vitest";
import { formatMcpSetupPrompt } from "../../src/client/mcp-prompt.js";

describe("formatMcpSetupPrompt", () => {
  it("embeds a resolved bin path as valid mcpServers JSON", () => {
    const prompt = formatMcpSetupPrompt({
      disabled: false,
      mcpCommand: "/app/node_modules/.bin/astro-inspector-mcp",
      mcpArgs: ["--project-root", "/app"]
    });

    const json = prompt.slice(prompt.indexOf("{"), prompt.lastIndexOf("}") + 1);
    expect(JSON.parse(json)).toEqual({
      mcpServers: {
        "astro-inspector": {
          command: "/app/node_modules/.bin/astro-inspector-mcp",
          args: ["--project-root", "/app"]
        }
      }
    });
  });

  it("embeds the npx fallback form", () => {
    const prompt = formatMcpSetupPrompt({
      disabled: false,
      mcpCommand: "npx",
      mcpArgs: [
        "--no-install",
        "astro-inspector-mcp",
        "--project-root",
        "/app"
      ]
    });

    const json = prompt.slice(prompt.indexOf("{"), prompt.lastIndexOf("}") + 1);
    expect(
      (JSON.parse(json) as { mcpServers: Record<string, unknown> }).mcpServers[
        "astro-inspector"
      ]
    ).toEqual({
      command: "npx",
      args: [
        "--no-install",
        "astro-inspector-mcp",
        "--project-root",
        "/app"
      ]
    });
  });

  it("names both host config files and tells the agent to merge", () => {
    const prompt = formatMcpSetupPrompt({
      disabled: false,
      mcpCommand: "npx",
      mcpArgs: []
    });

    expect(prompt).toContain(".mcp.json");
    expect(prompt).toContain(".cursor/mcp.json");
    expect(prompt).toContain("merge it into an existing");
    expect(prompt).toContain("get_astro_element_by_token");
  });
});
