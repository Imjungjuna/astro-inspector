#!/usr/bin/env node

import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

function readProjectRoot(arguments_: string[]): string {
  const index = arguments_.indexOf("--project-root");
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(
      "Usage: astro-ai-locator-mcp --project-root <absolute-project-path>"
    );
  }
  if (!path.isAbsolute(value)) {
    throw new Error("--project-root must be an absolute path");
  }
  return value;
}

async function main(): Promise<void> {
  const configuredRoot = readProjectRoot(process.argv.slice(2));
  const projectRoot = await realpath(path.resolve(configuredRoot));
  if (!(await stat(projectRoot)).isDirectory()) {
    throw new Error("The MCP project root is not a directory");
  }
  const server = createMcpServer({ projectRoot });
  await server.connect(new StdioServerTransport());
  console.error(`astro-ai-locator MCP ready for ${projectRoot}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
