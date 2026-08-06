import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { TOKEN_PATTERN } from "../shared/contracts.js";
import { resolveElementByToken } from "./resolve-element.js";

/**
 * MCP 핸드셰이크로 호스트에 보고되는 버전. 상수로 복제하면 릴리스마다 손으로
 * 맞춰야 하고 실제로 0.4.0 에서 멈춰 있었다. `rootDir` 이 src 라 JSON import 는
 * 빌드가 거부하므로 런타임에 읽는다. `dist/mcp/` 와 `src/mcp/` 모두 두 단계 위가
 * 패키지 루트다.
 */
const { version } = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};

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
    version
  });

  server.registerTool(
    "get_astro_element_by_token",
    {
      title: "Resolve an Astro UI element",
      description:
        "Call this whenever the user provides a 5-character locator token starting with #a (for example #a7k9). Returns the exact Astro, JSX, or TSX source file, line, column, source tag, rendered DOM tag, and a focused source excerpt for that selected UI element. When the element came from a repeated call site — a card in a list, a row in a table — the response also includes `instance` (1-based document order) and `instanceLabel` (the item's own text), so you can tell which occurrence was selected even when several occurrences read the same.",
      inputSchema: {
        token: z
          .string()
          .regex(TOKEN_PATTERN)
          .describe("The token copied by Astro Inspector, like #a7k9")
      }
    },
    async ({ token }): Promise<CallToolResult> => {
      try {
        const result = await resolveElementByToken({
          projectRoot: options.projectRoot,
          token
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
        console.error("get_astro_element_by_token failed:", message);
        return toolError(message);
      }
    }
  );

  return server;
}
