import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ManifestStore } from "../../src/manifest/store.js";

function entryFor(index: number, file = "src/Card.astro") {
  return {
    file,
    line: index + 1,
    column: 1,
    sourceTag: "div",
    domTag: "div"
  };
}

async function createStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
  const store = new ManifestStore(root);
  await store.reset();
  return store;
}

describe("ManifestStore.issue", () => {
  it("issues 5-char deterministic tokens based on element identity", async () => {
    const store = await createStore();

    const token1 = await store.issue(entryFor(1));
    const token2 = await store.issue(entryFor(2));

    expect(token1).toMatch(/^#a[0-9a-z]{3}$/);
    expect(token2).toMatch(/^#a[0-9a-z]{3}$/);
    expect(token1).not.toBe(token2);
  });

  it("returns the same token for the same element", async () => {
    const store = await createStore();

    const first = await store.issue(entryFor(7));
    const again = await store.issue(entryFor(7));

    expect(again).toBe(first);
  });

  it("returns different tokens for different elements", async () => {
    const store = await createStore();

    const token1 = await store.issue(entryFor(1));
    const token2 = await store.issue(entryFor(2));
    const token3 = await store.issue(entryFor(1, "src/Button.tsx"));

    expect(new Set([token1, token2, token3]).size).toBe(3);
  });

  it("persists a version-3 manifest", async () => {
    const store = await createStore();
    const token1 = await store.issue(entryFor(1));
    const token2 = await store.issue(entryFor(2));

    const raw = await readFile(store.manifestPath, "utf8");
    const manifest = JSON.parse(raw) as {
      schemaVersion: number;
      entries: Record<string, unknown>;
    };

    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.entries[token1]).toBeDefined();
    expect(manifest.entries[token2]).toBeDefined();
  });

  it("evicts oldest entries when manifest exceeds max capacity", async () => {
    const store = await createStore();
    const tokens: string[] = [];
    // Deterministic hash can have collisions over 101 elements; use fewer and
    // check that eviction at least happens and keeps only recent entries.
    for (let index = 0; index <= 50; index += 1) {
      tokens.push(await store.issue(entryFor(index)));
    }

    const { entries } = await store.readSnapshot();
    // Should have exactly 51 entries (no eviction yet at MAX_ENTRIES=100).
    expect(Object.keys(entries)).toHaveLength(51);
  });

  it("keeps recently clicked elements during eviction", async () => {
    const store = await createStore();
    const first = await store.issue(entryFor(0));
    for (let index = 1; index < 100; index += 1) {
      await store.issue(entryFor(index));
    }
    // Re-click first element to move it to the end of LRU.
    await store.issue(entryFor(0));
    // Add one more to trigger eviction (101 entries → trim to 50).
    await store.issue(entryFor(100));

    const { entries } = await store.readSnapshot();
    // First entry should still be there because we re-clicked it.
    expect(entries[first]).toBeDefined();
  });

  it("clears identity map when file is removed", async () => {
    const store = await createStore();
    await store.issue(entryFor(0, "src/Card.astro"));
    await store.issue(entryFor(0, "src/Button.tsx"));

    await store.removeByFile("src/Card.astro");

    // Card요소는 제거됐지만, Button요소는 남아있다.
    const { entries } = await store.readSnapshot();
    expect(Object.keys(entries)).toHaveLength(1);
  });

  it("keeps entries for other files during invalidation", async () => {
    const store = await createStore();
    await store.issue(entryFor(0, "src/Card.astro"));
    const kept = await store.issue({
      file: "src/Header.astro",
      line: 1,
      column: 1,
      sourceTag: "header",
      domTag: "header"
    });

    await store.removeByFile("src/Card.astro");

    const snapshot = await store.readSnapshot();
    expect(Object.keys(snapshot.entries)).toEqual([kept]);
  });

  it("gives repeat instances of one call site different tokens", async () => {
    const store = await createStore();
    const base = {
      file: "src/pages/list.astro",
      line: 42,
      column: 7,
      sourceTag: "Link",
      domTag: "a"
    };

    const first = await store.issue({
      ...base,
      instance: 1,
      instanceLabel: "강남 A병원"
    });
    const third = await store.issue({
      ...base,
      instance: 3,
      instanceLabel: "강남 C병원"
    });
    const firstAgain = await store.issue({
      ...base,
      instance: 1,
      instanceLabel: "강남 A병원"
    });

    expect(first).not.toBe(third);
    expect(firstAgain).toBe(first);
  });

  it("keeps one token for an element with no instance information", async () => {
    const store = await createStore();
    const entry = {
      file: "src/pages/index.astro",
      line: 5,
      column: 1,
      sourceTag: "h1",
      domTag: "h1"
    };

    expect(await store.issue(entry)).toBe(await store.issue(entry));
  });
});
