import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ManifestStore } from "../../src/manifest/store.js";

function entryFor(index: number) {
  return {
    file: "src/Card.astro",
    line: index + 1,
    column: 1,
    sourceTag: "div",
    domTag: "div"
  };
}

async function createStore(options?: {
  startIndex?: number;
  capacity?: number;
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
  const store = new ManifestStore(root, { startIndex: 0, ...options });
  await store.reset();
  return store;
}

describe("ManifestStore.issue", () => {
  it("issues fixed-width 5-char tokens in sequence", async () => {
    const store = await createStore();

    expect(await store.issue(entryFor(0))).toBe("#a000");
    expect(await store.issue(entryFor(1))).toBe("#a001");
    expect(await store.issue(entryFor(1295))).toMatch(/^#a[0-9a-z]{3}$/);
  });

  it("returns the same token for the same element", async () => {
    const store = await createStore();

    const first = await store.issue(entryFor(7));
    const again = await store.issue(entryFor(7));

    expect(again).toBe(first);
    // 재클릭이 새 번호를 소비하지 않는다.
    expect(await store.issue(entryFor(8))).toBe("#a001");
  });

  it("persists a sorted version-2 manifest", async () => {
    const store = await createStore();
    await store.issue(entryFor(1));
    await store.issue(entryFor(0));

    const raw = await readFile(store.manifestPath, "utf8");
    const manifest = JSON.parse(raw) as {
      schemaVersion: number;
      entries: Record<string, unknown>;
    };

    expect(manifest.schemaVersion).toBe(2);
    expect(Object.keys(manifest.entries)).toEqual(["#a000", "#a001"]);
  });

  it("starts from the configured start index and wraps", async () => {
    const store = await createStore({ startIndex: 46655 });

    expect(await store.issue(entryFor(0))).toBe("#azzz");
    expect(await store.issue(entryFor(1))).toBe("#a000");
  });

  it("throws instead of reusing numbers when the space is exhausted", async () => {
    const store = await createStore({ capacity: 2 });
    await store.issue(entryFor(0));
    await store.issue(entryFor(1));

    await expect(store.issue(entryFor(2))).rejects.toThrow(
      /exhausted.*restart/iu
    );
    // 기존 요소 재클릭은 고갈 뒤에도 동작한다.
    expect(await store.issue(entryFor(0))).toBe("#a000");
  });

  it("caps the manifest by dropping the oldest entries", async () => {
    const store = await createStore();
    const tokens: string[] = [];
    for (let index = 0; index <= 100; index += 1) {
      tokens.push(await store.issue(entryFor(index)));
    }

    const { entries } = await store.readSnapshot();
    expect(Object.keys(entries)).toHaveLength(51);
    expect(entries[tokens[49]!]).toBeUndefined();
    expect(entries[tokens[50]!]).toBeDefined();
    expect(entries[tokens[100]!]).toBeDefined();
  });

  it("does not resurrect an evicted element's old token", async () => {
    const store = await createStore();
    const evicted = await store.issue(entryFor(0));
    for (let index = 1; index <= 100; index += 1) {
      await store.issue(entryFor(index));
    }
    // entryFor(0) 은 방금 evict 됐다. 재클릭은 새 번호를 받아야 한다.
    const reissued = await store.issue(entryFor(0));

    expect(reissued).not.toBe(evicted);
    expect((await store.readSnapshot()).entries[evicted]).toBeUndefined();
  });

  it("moves a re-clicked element away from eviction", async () => {
    const store = await createStore();
    const tokens: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      tokens.push(await store.issue(entryFor(index)));
    }
    await store.issue(entryFor(0)); // LRU 갱신
    await store.issue(entryFor(100)); // 101번째 → evict 발동

    const { entries } = await store.readSnapshot();
    expect(entries[tokens[0]!]).toBeDefined();
    expect(entries[tokens[1]!]).toBeUndefined();
  });

  it("frees the identity when its file is invalidated", async () => {
    const store = await createStore();
    const before = await store.issue(entryFor(0));

    await store.removeByFile("src/Card.astro");
    const after = await store.issue(entryFor(0));

    expect((await store.readSnapshot()).entries[before]).toBeUndefined();
    expect(after).not.toBe(before);
  });

  it("keeps entries for other Astro files during invalidation", async () => {
    const store = await createStore();
    await store.issue(entryFor(0));
    const kept = await store.issue({
      file: "src/Header.astro",
      line: 1,
      column: 1,
      sourceTag: "header",
      domTag: "header"
    });

    await store.removeByFile("src/Card.astro");

    expect(Object.keys((await store.readSnapshot()).entries)).toEqual([kept]);
  });
});
