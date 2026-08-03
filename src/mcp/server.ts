import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { resolveElementByHash } from "./resolve-element.js";

interface McpServerOptions {
  projectRoot: string;
}

function toolError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer({
    name: "astro-inspector",
    version: "0.3.0"
  });

  server.registerTool(
    "get_astro_element_by_hash",
    {
      title: "Resolve an Astro UI element",
      description:
        "Call this whenever the user provides an astro_hash_ value. Returns the exact Astro, JSX, or TSX source file, line, column, source tag, rendered DOM tag, and a focused source excerpt for that selected UI element.",
      inputSchema: {
        hash: z
          .string()
          .regex(/^astro_hash_[a-f0-9]{24}$/u)
          .describe("The hash copied by Astro Inspector")
      }
    },
    async ({ hash }): Promise<CallToolResult> => {
      try {
        const result = await resolveElementByHash({
          projectRoot: options.projectRoot,
          hash
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to resolve element";
        console.error("get_astro_element_by_hash failed:", message);
        return toolError(message);
      }
    }
  );

  return server;
}
