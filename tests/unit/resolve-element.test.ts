import {
  mkdir,
  mkdtemp,
  realpath,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveElementByToken } from "../../src/mcp/resolve-element.js";
import { ManifestStore } from "../../src/manifest/store.js";

describe("resolveElementByToken", () => {
  it("returns the validated source and focused excerpt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const file = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      "---\nconst title = 'Card';\n---\n<article>{title}</article>\n",
      "utf8"
    );
    const store = new ManifestStore(root);
    await store.reset();
    const token = await store.issue({
      file: "src/Card.astro",
      line: 4,
      column: 1,
      sourceTag: "article",
      domTag: "article"
    });

    const result = await resolveElementByToken({ projectRoot: root, token });

    expect(result.relativeFile).toBe("src/Card.astro");
    expect(result.absoluteFile).toBe(await realpath(file));
    expect(result.line).toBe(4);
    expect(result).not.toHaveProperty("source");
    expect(result.excerpt).toContain("4 | <article>");
  });

  it("resolves a validated TSX source element", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const file = path.join(root, "src", "Button.tsx");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "export const Button = () => <Link />;\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const token = await store.issue({
      file: "src/Button.tsx",
      line: 1,
      column: 29,
      sourceTag: "Link",
      domTag: "a"
    });

    const result = await resolveElementByToken({ projectRoot: root, token });

    expect(result.relativeFile).toBe("src/Button.tsx");
    expect(result.sourceTag).toBe("Link");
    expect(result.domTag).toBe("a");
    expect(result).not.toHaveProperty("source");
  });

  it("rejects an unknown token", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();

    await expect(
      resolveElementByToken({
        projectRoot: root,
        token: "#a999"
      })
    ).rejects.toThrow("Unknown locator token");
  });

  it("rejects a manifest path that escapes the project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "outside-"));
    const outsideFile = path.join(outside, "Escape.astro");
    await writeFile(outsideFile, "<div>Escape</div>\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const token = await store.issue({
      file: path.relative(root, outsideFile),
      line: 1,
      column: 1,
      sourceTag: "div",
      domTag: "div"
    });

    await expect(
      resolveElementByToken({ projectRoot: root, token })
    ).rejects.toThrow("Manifest entry escapes the Astro project");
  });

  it.skipIf(process.platform === "win32")(
    "rejects a source symlink that escapes the project root",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
      const outside = await mkdtemp(path.join(os.tmpdir(), "outside-"));
      const outsideFile = path.join(outside, "Escape.astro");
      await writeFile(outsideFile, "<div>Escape</div>\n", "utf8");
      const sourceDirectory = path.join(root, "src");
      await mkdir(sourceDirectory, { recursive: true });
      await symlink(outsideFile, path.join(sourceDirectory, "Linked.astro"));
      const store = new ManifestStore(root);
      await store.reset();
      const token = await store.issue({
        file: "src/Linked.astro",
        line: 1,
        column: 1,
        sourceTag: "div",
        domTag: "div"
      });

      await expect(
        resolveElementByToken({ projectRoot: root, token })
      ).rejects.toThrow("Manifest entry escapes the Astro project");
    }
  );

  it.skipIf(process.platform === "win32")(
    "rejects a manifest symlink that escapes the project root",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
      const outside = await mkdtemp(path.join(os.tmpdir(), "outside-"));
      const outsideManifest = path.join(outside, "manifest.json");
      await writeFile(
        outsideManifest,
        '{"schemaVersion":2,"entries":{}}\n',
        "utf8"
      );
      const manifestDirectory = path.join(root, ".astro-ai-locator");
      await mkdir(manifestDirectory, { recursive: true });
      await symlink(
        outsideManifest,
        path.join(manifestDirectory, "manifest.json")
      );

      await expect(
        resolveElementByToken({
          projectRoot: root,
          token: "#a999"
        })
      ).rejects.toThrow("Locator manifest escapes the Astro project");
    }
  );

  it("rejects an oversized Astro source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const source = path.join(root, "src", "Large.astro");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "x".repeat(512 * 1024 + 1), "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const token = await store.issue({
      file: "src/Large.astro",
      line: 1,
      column: 1,
      sourceTag: "div",
      domTag: "div"
    });

    await expect(
      resolveElementByToken({ projectRoot: root, token })
    ).rejects.toThrow("exceeds its size limit");
  });

  it("rejects a malformed manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();
    await writeFile(store.manifestPath, "{}\n", "utf8");

    await expect(
      resolveElementByToken({
        projectRoot: root,
        token: "#a999"
      })
    ).rejects.toThrow();
  });

  it("rejects an entry whose tag no longer matches the source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const file = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      "---\nconst title = 'Card';\n---\n<article>{title}</article>\n",
      "utf8"
    );
    await mkdir(path.join(root, ".astro-ai-locator"), { recursive: true });
    await writeFile(
      path.join(root, ".astro-ai-locator", "manifest.json"),
      JSON.stringify({
        schemaVersion: 3,
        entries: {
          "#a000": {
            file: "src/Card.astro",
            line: 4,
            column: 1,
            sourceTag: "button",
            domTag: "button"
          }
        }
      }),
      "utf8"
    );

    await expect(
      resolveElementByToken({ projectRoot: root, token: "#a000" })
    ).rejects.toThrow(/does not match the current source/u);
  });
});
