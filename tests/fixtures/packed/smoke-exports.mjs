import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { astroAiLocator } from "astro-ai-locator";
import { installLocator } from "astro-ai-locator/client";

if (
  typeof astroAiLocator !== "function" ||
  typeof installLocator !== "function"
) {
  throw new Error("Packed root or client export did not resolve");
}

const executableName =
  process.platform === "win32"
    ? "astro-ai-locator-mcp.cmd"
    : "astro-ai-locator-mcp";
const executable = new URL(
  `./node_modules/.bin/${executableName}`,
  import.meta.url
);
await access(
  executable,
  process.platform === "win32" ? constants.F_OK : constants.X_OK
);

if (process.platform !== "win32") {
  const target = await realpath(executable);
  const firstLine = (await readFile(target, "utf8")).split(/\r?\n/u)[0];
  if (firstLine !== "#!/usr/bin/env node") {
    throw new Error(`Packed CLI shebang is invalid: ${firstLine}`);
  }
}

console.log("packed exports and CLI resolved");
