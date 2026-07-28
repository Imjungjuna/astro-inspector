import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(target) : [target];
    })
  );
  return nested.flat();
}

describe("production output", () => {
  it("contains no Astro AI Locator runtime", async () => {
    const output = path.resolve("tests/fixtures/basic/dist");
    const files = await listFiles(output);
    const textFiles = files.filter((file) =>
      /\.(?:html|js|css)$/u.test(file)
    );
    const combined = (
      await Promise.all(textFiles.map((file) => readFile(file, "utf8")))
    ).join("\n");

    expect(combined).not.toMatch(
      /astro-ai-locator\/client|_astro-ai-locator\/register|data-astro-ai-locator/u
    );
  });
});
