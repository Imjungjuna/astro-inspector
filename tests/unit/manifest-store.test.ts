import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ManifestStore } from "../../src/manifest/store.js";

function hashFor(index: number): string {
  return `astro_hash_${index.toString(16).padStart(24, "0")}`;
}

function entryFor(index: number) {
  return {
    file: "src/Card.astro",
    line: index + 1,
    column: 1,
    sourceTag: "div",
    domTag: "div"
  };
}

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

  it("caps the manifest by dropping the oldest entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();

    for (let index = 0; index <= 100; index += 1) {
      await store.upsert(hashFor(index), entryFor(index));
    }

    const { entries } = await store.readSnapshot();
    expect(Object.keys(entries)).toHaveLength(51);
    expect(entries[hashFor(49)]).toBeUndefined();
    expect(entries[hashFor(50)]).toBeDefined();
    expect(entries[hashFor(100)]).toBeDefined();
  });

  it("moves a re-registered hash away from eviction", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();

    for (let index = 0; index < 100; index += 1) {
      await store.upsert(hashFor(index), entryFor(index));
    }
    // The oldest entry becomes the newest, so the next eviction skips it.
    await store.upsert(hashFor(0), entryFor(0));
    await store.upsert(hashFor(100), entryFor(100));

    const { entries } = await store.readSnapshot();
    expect(Object.keys(entries)).toHaveLength(51);
    expect(entries[hashFor(0)]).toBeDefined();
    expect(entries[hashFor(1)]).toBeUndefined();
    expect(entries[hashFor(50)]).toBeUndefined();
    expect(entries[hashFor(51)]).toBeDefined();
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
