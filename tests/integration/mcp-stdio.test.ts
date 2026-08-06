import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { ManifestStore } from "../../src/manifest/store.js";

describe("stdio MCP server", () => {
  it("resolves a locator token through the published CLI shape", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const sourceFile = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, "<article>Card</article>\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const token = await store.issue({
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
      // 핸드셰이크 버전은 package.json 을 따라가야 한다. 상수로 두면 릴리스마다
      // 잊혀 실제로 0.4.0 에서 멈춰 있었다.
      expect(client.getServerVersion()?.version).toBe(
        JSON.parse(await readFile("package.json", "utf8")).version
      );
      const result = CallToolResultSchema.parse(
        await client.callTool({
          name: "get_astro_element_by_token",
          arguments: { token }
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
