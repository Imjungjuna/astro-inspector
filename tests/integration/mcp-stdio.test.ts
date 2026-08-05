import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { ManifestStore } from "../../src/manifest/store.js";

describe("stdio MCP server", () => {
  it("resolves a locator hash through the published CLI shape", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const sourceFile = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, "<article>Card</article>\n", "utf8");
    const store = new ManifestStore(root, { startIndex: 0 });
    await store.reset();
    const hash = await store.issue({
      file: "src/Card.astro",
      line: 1,
      column: 1,
      sourceTag: "article",
      domTag: "article"
    });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.resolve("dist/mcp/cli.js"),
        "--project-root",
        root
      ],
      stderr: "pipe"
    });
    const client = new Client({
      name: "astro-inspector-test",
      version: "0.1.0"
    });

    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.name).toBe("astro-inspector");
      const result = CallToolResultSchema.parse(
        await client.callTool({
          name: "get_astro_element_by_hash",
          arguments: { hash }
        })
      );
      const text = result.content.find(
        (item): item is { type: "text"; text: string } =>
          item.type === "text"
      );
      expect(text?.text).toContain('"relativeFile": "src/Card.astro"');
      expect(text?.text).toContain("<article>Card</article>");
      expect(text?.text).not.toContain('"source":');
    } finally {
      await client.close();
    }
  });
});
