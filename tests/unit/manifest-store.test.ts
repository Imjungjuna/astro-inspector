import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ManifestStore } from "../../src/manifest/store.js";

describe("ManifestStore", () => {
  it("persists a sorted versioned manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();

    await store.upsert("astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb", {
      file: "src/B.astro",
      line: 2,
      column: 1,
      sourceTag: "div",
      domTag: "div"
    });
    await store.upsert("astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa", {
      file: "src/A.astro",
      line: 1,
      column: 1,
      sourceTag: "main",
      domTag: "main"
    });

    const raw = await readFile(store.manifestPath, "utf8");
    const manifest = JSON.parse(raw) as {
      schemaVersion: number;
      entries: Record<string, unknown>;
    };

    expect(manifest.schemaVersion).toBe(1);
    expect(Object.keys(manifest.entries)).toEqual([
      "astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa",
      "astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb"
    ]);
  });

  it("removes every entry belonging to one source file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();
    await store.upsert("astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa", {
      file: "src/Card.astro",
      line: 1,
      column: 1,
      sourceTag: "article",
      domTag: "article"
    });
    await store.upsert("astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb", {
      file: "src/Card.astro",
      line: 2,
      column: 1,
      sourceTag: "button",
      domTag: "button"
    });

    await store.removeByFile("src/Card.astro");

    expect((await store.readSnapshot()).entries).toEqual({});
  });

  it("rejects one hash mapping to two different elements", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();
    const hash = "astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa";
    await store.upsert(hash, {
      file: "src/Card.astro",
      line: 1,
      column: 1,
      sourceTag: "article",
      domTag: "article"
    });

    await expect(
      store.upsert(hash, {
        file: "src/Header.astro",
        line: 1,
        column: 1,
        sourceTag: "header",
        domTag: "header"
      })
    ).rejects.toThrow("Locator hash collision");
  });

  it("keeps entries for other Astro files during invalidation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();
    await store.upsert("astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa", {
      file: "src/Card.astro",
      line: 1,
      column: 1,
      sourceTag: "article",
      domTag: "article"
    });
    await store.upsert("astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb", {
      file: "src/Header.astro",
      line: 1,
      column: 1,
      sourceTag: "header",
      domTag: "header"
    });

    await store.removeByFile("src/Card.astro");

    expect(Object.keys((await store.readSnapshot()).entries)).toEqual([
      "astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb"
    ]);
  });
});
