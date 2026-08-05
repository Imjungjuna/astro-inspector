# Compact Locator Token (5자) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클립보드 locator 토큰을 `astro_hash_` + 24 hex(35자)에서 `#a` + base36 3자리(5자 고정)로 바꾼다. 스펙: [2026-08-05-compact-token-design.md](../specs/2026-08-05-compact-token-design.md)

**Architecture:** 해시(내용 유도)를 버리고 서버 순번 발급으로 바꾼다. `ManifestStore`가 identity→token 역인덱스와 랜덤 시작점 카운터를 들고 `issue(entry)`로 발급한다. MCP resolve 에는 등록 시와 같은 태그 검증을 추가해, 전역 유일성을 잃은 대신 교차 오인(다른 프로젝트 토큰이 조용히 엉뚱한 요소로 붙는 것)을 막는다. 이름은 hash→token 으로 일관 변경한다.

**Tech Stack:** TypeScript 6, Vitest 4, Playwright 1.61, zod 4, Node `>=22.12.0`.

## Global Constraints

- 토큰 포맷: `#a` + base36 소문자 3자리 = 5자 고정. 정규식 `^#a[0-9a-z]{3}$`.
- 세션 용량 36³ = 46,656. 고갈 시 throw, 랩 후 번호 재사용으로 조용히 덮지 않는다.
- `nextIndex` 는 dev 서버 기동 시 `[0, 46656)` 랜덤 시작(세션 솔트).
- `data-astro-ai-locator-*` DOM 속성, `.astro-ai-locator/` 경로는 변경 금지 (1층은 범위 밖).
- manifest `schemaVersion` 1 → 2. 마이그레이션 없음(기동마다 리셋).
- settings schema v5 와 `copyMode: "hash" | "context"` 값은 변경 금지 — UI 라벨 "Hash" 도 이번엔 그대로 둔다(스키마 값과 짝이라 별도 작업).
- 각 Task 끝에서 해당 테스트가 통과해야 하고, Task 3 끝에서 `npm run verify` 전체 통과.
- 시작 전 베이스라인: `npm run test` 로 현재 unit 통과 수를 기록해 둔다(main 은 green).

---

## File Structure

| 파일 | 변경 | Task |
| --- | --- | --- |
| `src/shared/contracts.ts` | `HASH_PREFIX` 삭제, `TOKEN_PREFIX`/`TOKEN_PATTERN` 추가, `RegisterElementResponse.hash`→`token`, manifest 버전 리터럴 2 | 1 |
| `src/manifest/hash.ts` → `src/manifest/paths.ts` | 파일명 변경. `createElementHash` 삭제, 경로 유틸 2개만 유지 | 1 |
| `src/manifest/store.ts` | `upsert` → `issue`(역인덱스+카운터), evict/removeByFile 역인덱스 동기화, schemaVersion 2 | 1 |
| `src/manifest/schema.ts` | 키 정규식 `TOKEN_PATTERN`, `z.literal(2)` | 1 |
| `src/integration/request-handler.ts` | `store.issue` 사용, 응답 필드 `token` | 1 |
| `src/client/clipboard-payload.ts` | `registration.token` | 1 |
| `src/client/index.ts` | 정규식·필드·문구·속성명 token 으로 | 1 |
| `src/shared/source-tag.ts` | **신규.** `pointsToSourceTag` 공용 헬퍼 | 2 |
| `src/mcp/resolve-element.ts` | token 정규식·이름 변경 + 태그 검증 추가 | 2 |
| `src/mcp/server.ts` | 툴명 `get_astro_element_by_token`, 스키마·설명 | 2 |
| `src/client/mcp-prompt.ts` | 모델 유도 문구를 새 포맷으로 | 2 |
| `tests/e2e/locator.spec.ts` | 정규식 9곳 + 툴명 + 테스트 제목 | 3 |
| `README.md`, `docs/FUTURE_WORK.md`, `package.json` | 예시·셸 주의·0.4.0 | 3 |

---

## Task 1: 토큰 발급 코어 — store.issue + hash→token 리네임 전파

`RegisterElementResponse.hash`→`token` 타입 변경이 request-handler·client·clipboard 를 한 번에 끌고 가므로(중간 상태가 컴파일 불가), 이 리네임 물결 전체가 한 Task 다.

**Files:**
- Modify: `src/shared/contracts.ts:7,48-51,61-65`
- Rename: `src/manifest/hash.ts` → `src/manifest/paths.ts`
- Modify: `src/manifest/store.ts`
- Modify: `src/manifest/schema.ts:20-28`
- Modify: `src/integration/request-handler.ts:4,137-140`
- Modify: `src/client/clipboard-payload.ts:34`
- Modify: `src/client/index.ts:480,493,502,508,513`
- Modify: import 경로 4곳 — `src/integration/inject-jsx-source-metadata.ts:4`, `src/integration/inject-source-metadata.ts:4`, `src/integration/vite-plugin.ts:6-9`, `src/integration/request-handler.ts:4`
- Test: `tests/unit/manifest-store.test.ts` (재작성), `tests/unit/hash.test.ts` → `tests/unit/paths.test.ts`, `tests/unit/request-handler.test.ts`, `tests/unit/clipboard-payload.test.ts`, `tests/unit/vite-plugin.test.ts:184-222`, `tests/unit/resolve-element.test.ts`(시딩만 issue 로), `tests/integration/mcp-stdio.test.ts`(시딩만)

**Interfaces:**
- Consumes: 기존 `LocatorManifestEntry` (변경 없음).
- Produces:
  - `TOKEN_PREFIX = "#a"`, `TOKEN_PATTERN = /^#a[0-9a-z]{3}$/` (contracts)
  - `ManifestStore` 생성자 `(root: string, options?: { startIndex?: number; capacity?: number })`
  - `ManifestStore.issue(entry: LocatorManifestEntry): Promise<string>` — 토큰 반환. `upsert` 는 삭제.
  - `RegisterElementResponse = { token: string; entry; workspaceFile }`
  - register 응답 JSON 필드 `hash` → `token`

- [ ] **Step 1: manifest-store 테스트를 issue 기준으로 재작성한다 (실패 먼저)**

`tests/unit/manifest-store.test.ts` 를 통째로 교체:

```ts
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
```

기존 "rejects one hash mapping to two different elements" 테스트는 대체 없이 삭제한다 — 발급 주체가 서버라 충돌이 구조적으로 불가능해졌다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/manifest-store.test.ts`
Expected: FAIL — `store.issue is not a function` (및 startIndex 옵션 부재).

- [ ] **Step 3: contracts 를 바꾼다**

`src/shared/contracts.ts`:

```ts
// 7행 교체
export const TOKEN_PREFIX = "#a";
export const TOKEN_PATTERN = /^#a[0-9a-z]{3}$/;
```

`LocatorManifest`(48-51행) 버전 리터럴:

```ts
export interface LocatorManifest {
  schemaVersion: 2;
  entries: Record<string, LocatorManifestEntry>;
}
```

`RegisterElementResponse`(61-65행):

```ts
export interface RegisterElementResponse {
  token: string;
  entry: LocatorManifestEntry;
  workspaceFile: string;
}
```

- [ ] **Step 4: hash.ts 를 paths.ts 로 바꾼다**

```bash
git mv src/manifest/hash.ts src/manifest/paths.ts
git mv tests/unit/hash.test.ts tests/unit/paths.test.ts
```

`src/manifest/paths.ts` 에서 `createElementHash` 함수, `node:crypto` import, `HASH_PREFIX`/`LocatorManifestEntry` import 를 삭제한다. 남는 것은 `normalizeRelativeFile` 과 `toProjectRelativeFile` 뿐:

```ts
import path from "node:path";

export function normalizeRelativeFile(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

export function toProjectRelativeFile(
  root: string,
  absoluteFile: string
): string {
  return normalizeRelativeFile(path.relative(root, absoluteFile));
}
```

`tests/unit/paths.test.ts` 는 `describe("createElementHash")` 블록 전체를 삭제하고 import 를 `../../src/manifest/paths.js` 로 고친다. `normalizeRelativeFile` describe 는 그대로 둔다.

import 경로 4곳을 `../manifest/hash.js` → `../manifest/paths.js` 로:
`inject-jsx-source-metadata.ts:4`, `inject-source-metadata.ts:4`, `vite-plugin.ts:6-9`, `request-handler.ts:4`.

- [ ] **Step 5: store.issue 를 구현한다**

`src/manifest/store.ts` 를 통째로 교체:

```ts
import { randomInt } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MANIFEST_DIRECTORY,
  MANIFEST_FILENAME,
  TOKEN_PREFIX,
  type LocatorManifest,
  type LocatorManifestEntry
} from "../shared/contracts.js";
import { LocatorManifestSchema } from "./schema.js";

/**
 * The manifest only grows while a dev server lives; `reset()` runs once at
 * startup. Cap it so a long clicking session cannot grow the file — and the
 * full re-serialization on every click — without bound.
 */
const MAX_ENTRIES = 100;
const EVICT_COUNT = 50;
export const TOKEN_CAPACITY = 36 ** 3;

interface ManifestStoreOptions {
  /** Test override. Production uses a random session start (cross-project salt). */
  startIndex?: number;
  /** Test override for exhaustion behaviour. */
  capacity?: number;
}

function identityOf(entry: LocatorManifestEntry): string {
  return [entry.file, String(entry.line), String(entry.column), entry.domTag].join(
    "\0"
  );
}

export class ManifestStore {
  readonly manifestPath: string;
  private entries = new Map<string, LocatorManifestEntry>();
  private tokensByIdentity = new Map<string, string>();
  private nextIndex: number;
  private issuedCount = 0;
  private readonly capacity: number;
  private writeQueue: Promise<void> = Promise.resolve();
  private writeSequence = 0;

  constructor(root: string, options: ManifestStoreOptions = {}) {
    this.manifestPath = path.join(root, MANIFEST_DIRECTORY, MANIFEST_FILENAME);
    this.capacity = options.capacity ?? TOKEN_CAPACITY;
    // The random start doubles as a session salt: another project's token is
    // unlikely to be a live number here, so cross-project pastes fail loudly.
    this.nextIndex = options.startIndex ?? randomInt(this.capacity);
  }

  async reset(): Promise<void> {
    this.entries.clear();
    this.tokensByIdentity.clear();
    await this.persist();
  }

  /**
   * Returns the existing token when the same element is clicked again, so a
   * re-click never burns a fresh number. Numbers are never reused: an evicted
   * element gets a new token, and exhaustion throws instead of wrapping onto
   * numbers that may still be on someone's clipboard.
   */
  async issue(entry: LocatorManifestEntry): Promise<string> {
    const identity = identityOf(entry);
    const existing = this.tokensByIdentity.get(identity);
    if (existing !== undefined) {
      // `Map.set` keeps an existing key in place, so delete first to move a
      // re-clicked token to the back, away from eviction.
      this.entries.delete(existing);
      this.entries.set(existing, entry);
      await this.persist();
      return existing;
    }
    if (this.issuedCount >= this.capacity) {
      throw new Error(
        "Locator token space is exhausted for this session; restart astro dev"
      );
    }
    const token = `${TOKEN_PREFIX}${this.nextIndex
      .toString(36)
      .padStart(3, "0")}`;
    this.nextIndex = (this.nextIndex + 1) % this.capacity;
    this.issuedCount += 1;
    this.entries.set(token, entry);
    this.tokensByIdentity.set(identity, token);
    if (this.entries.size > MAX_ENTRIES) {
      for (const oldest of [...this.entries.keys()].slice(0, EVICT_COUNT)) {
        this.entries.delete(oldest);
      }
      this.pruneIdentities();
    }
    await this.persist();
    return token;
  }

  async removeByFile(file: string): Promise<void> {
    let changed = false;
    for (const [token, entry] of this.entries) {
      if (entry.file === file) {
        this.entries.delete(token);
        changed = true;
      }
    }
    if (changed) {
      this.pruneIdentities();
      await this.persist();
    }
  }

  async readSnapshot(): Promise<LocatorManifest> {
    const raw = await readFile(this.manifestPath, "utf8");
    return LocatorManifestSchema.parse(JSON.parse(raw));
  }

  /** Drops reverse-index rows whose token no longer lives in the manifest. */
  private pruneIdentities(): void {
    for (const [identity, token] of this.tokensByIdentity) {
      if (!this.entries.has(token)) {
        this.tokensByIdentity.delete(identity);
      }
    }
  }

  private persist(): Promise<void> {
    const snapshot: LocatorManifest = {
      schemaVersion: 2,
      entries: Object.fromEntries(
        [...this.entries.entries()].sort(([left], [right]) =>
          left.localeCompare(right)
        )
      )
    };

    this.writeQueue = this.writeQueue.then(async () => {
      const directory = path.dirname(this.manifestPath);
      await mkdir(directory, { recursive: true });
      const temporaryPath =
        `${this.manifestPath}.${process.pid}.${this.writeSequence++}.tmp`;
      await writeFile(
        temporaryPath,
        `${JSON.stringify(snapshot, null, 2)}\n`,
        "utf8"
      );
      await rename(temporaryPath, this.manifestPath);
    });

    return this.writeQueue;
  }
}
```

- [ ] **Step 6: schema 를 v2 로 올린다**

`src/manifest/schema.ts` 의 `LocatorManifestSchema`:

```ts
import { TOKEN_PATTERN } from "../shared/contracts.js";
```

```ts
export const LocatorManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    entries: z.record(
      z.string().regex(TOKEN_PATTERN),
      LocatorManifestEntrySchema
    )
  })
  .strict();
```

- [ ] **Step 7: store 테스트 통과 확인**

Run: `npx vitest run tests/unit/manifest-store.test.ts tests/unit/paths.test.ts`
Expected: PASS.

- [ ] **Step 8: request-handler 를 issue 로 전환한다**

`src/integration/request-handler.ts:4`:

```ts
import { toProjectRelativeFile } from "../manifest/paths.js";
```

137-140행:

```ts
      const token = await options.store.issue(entry);
      response.statusCode = 200;
      response.end(JSON.stringify({ token, entry, workspaceFile }));
```

(고갈 throw 는 기존 catch 가 400 + 메시지로 내려보낸다 — 추가 처리 불필요.)

`tests/unit/request-handler.test.ts` 에서 응답 필드 `hash` 참조를 전부 `token` 으로, 81행 정규식을 `/^#a[0-9a-z]{3}$/` 로 바꾼다. 테스트가 `ManifestStore` 를 직접 만들면 생성자에 `{ startIndex: 0 }` 를 넘겨 결정론적으로 만든다.

- [ ] **Step 9: 클라이언트 소비처를 바꾼다**

`src/client/clipboard-payload.ts:34`: `registration.hash` → `registration.token`.

`tests/unit/clipboard-payload.test.ts`: 픽스처 `hash: "astro_hash_8f92abcdef0123456789abcd"` → `token: "#a7k9"`, 단언 `toBe("astro_hash_...")` → `toBe("#a7k9")`.

`src/client/index.ts`:
- contracts import 목록에 `TOKEN_PATTERN` 추가.
- 480행: `!/^astro_hash_[a-f0-9]{24}$/u.test(result.hash)` → `!TOKEN_PATTERN.test(result.token)`
- 493행: `target.setAttribute("data-comp-token", result.token);`
- 502행: `` `Copied ${result.token}` ``
- 508행: `"Copy Astro locator token:"`
- 513행: `copyingContext ? "context" : "token"`

- [ ] **Step 10: 시딩만 하는 테스트들의 컴파일을 살린다**

`upsert` 삭제로 깨지는 곳 — 동작 검증은 Task 2 에서, 여기서는 컴파일·통과만:

- `tests/unit/vite-plugin.test.ts:184-222`: `store.upsert("astro_hash_...", entry)` → `await store.issue(entry)` 로 바꾸고, 이후 단언이 하드코딩 해시 문자열을 참조하면 `issue` 반환값을 변수로 받아 쓴다. 스토어 생성 시 `{ startIndex: 0 }`.
- `tests/unit/resolve-element.test.ts` / `tests/integration/mcp-stdio.test.ts`: 시딩을 `const token = await store.issue(entry)` 로 바꾸고 하드코딩 `astro_hash_...` 를 그 변수로 대체. 스토어 생성 시 `{ startIndex: 0 }`. raw JSON 픽스처(`'{"schemaVersion":1,...'`)는 `schemaVersion: 2` 로. **`resolveElementByHash` 호출부와 그 내부 정규식은 Task 2 에서 바꾸므로, 이 시점엔 resolve 계열 테스트가 "Invalid Astro element hash" 로 실패하는 것이 정상이다** — Step 11 에서 이 둘은 제외하고 돌린다.

- [ ] **Step 11: 타입체크 + resolve 계열 제외 전체 unit 통과 확인**

Run: `npm run check && npx vitest run tests/unit --exclude tests/unit/resolve-element.test.ts`
Expected: 타입체크 PASS, unit PASS (resolve-element 제외).

- [ ] **Step 12: 커밋**

```bash
git add -A
git commit -m "feat: issue compact 5-char locator tokens from the manifest store"
```

---

## Task 2: MCP 측 — resolve 리네임 + 태그 검증(교차 오인 2차 방어)

**Files:**
- Create: `src/shared/source-tag.ts`
- Modify: `src/mcp/resolve-element.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/integration/request-handler.ts:76-84` (헬퍼로 교체)
- Modify: `src/client/mcp-prompt.ts:31-34`
- Test: `tests/unit/resolve-element.test.ts`, `tests/unit/mcp-prompt.test.ts`, `tests/integration/mcp-stdio.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `TOKEN_PATTERN`, `store.issue`.
- Produces:
  - `pointsToSourceTag(lineText: string, column: number, sourceTag: string): boolean`
  - `resolveElementByToken(options: { projectRoot: string; token: string }): Promise<ResolvedAstroElement>` — `ResolvedAstroElement.hash` → `token`. `resolveElementByHash` 는 삭제.
  - MCP 툴 `get_astro_element_by_token`, 입력 `{ token: string }`

- [ ] **Step 1: 태그 불일치 실패 테스트를 쓴다**

`tests/unit/resolve-element.test.ts` 에 추가. manifest 를 직접 써서 "다른 프로젝트에서 온 우연히 유효한 토큰" 상황을 재현한다:

```ts
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
        schemaVersion: 2,
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
```

같은 파일에서 함께 고친다:
- import·호출을 `resolveElementByToken` / `{ projectRoot, token }` 으로.
- 결과 단언 `result.hash` → `result.token`.
- TSX 픽스처의 소스는 태그 검증을 통과하도록 교체 — `sourceTag: "Link"` 엔트리가 가리키는 위치가 실제로 `<Link` 여야 한다:

```ts
    await writeFile(file, "export const Button = () => <Link />;\n", "utf8");
```

(column 29 가 `<Link` 를 가리킨다. 기존 `<button />` 픽스처는 실제 서버가 등록해줄 수 없는 조합이었다 — 등록 핸들러는 위치-태그 일치를 이미 검사한다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/resolve-element.test.ts`
Expected: FAIL — `resolveElementByToken` 미존재.

- [ ] **Step 3: 공용 헬퍼를 만들고 등록 쪽을 헬퍼로 교체한다**

Create `src/shared/source-tag.ts`:

```ts
/**
 * True when `lineText` at 1-based `column` starts the source tag, e.g.
 * `<Card ` or `<a>`. Registration and MCP resolution share this check so a
 * token can never resolve to a location its tag does not occupy.
 */
export function pointsToSourceTag(
  lineText: string,
  column: number,
  sourceTag: string
): boolean {
  const sourceAtLocation = lineText.slice(column - 1);
  const tagPrefix = `<${sourceTag}`;
  const boundary = sourceAtLocation[tagPrefix.length];
  return (
    sourceAtLocation.startsWith(tagPrefix) &&
    (boundary === undefined || /[\s/>]/u.test(boundary))
  );
}
```

`src/integration/request-handler.ts` 의 `validateSource` 76-84행을 교체:

```ts
  if (!pointsToSourceTag(selectedLine, column, sourceTag)) {
    throw new Error("Source location does not point to the source tag");
  }
```

상단에 `import { pointsToSourceTag } from "../shared/source-tag.js";` 추가, 지역 변수 `sourceAtLocation`/`tagPrefix`/`tagBoundary` 삭제.

- [ ] **Step 4: resolve-element 를 token + 태그 검증으로 바꾼다**

`src/mcp/resolve-element.ts`:
- import 에 `TOKEN_PATTERN`(contracts)·`pointsToSourceTag`(shared/source-tag) 추가.
- `ResolvedAstroElement.hash` → `token`.
- `ResolveElementOptions.hash` → `token`.
- `resolveElementByHash` → `resolveElementByToken`.
- 67-69행:

```ts
  if (!TOKEN_PATTERN.test(options.token)) {
    throw new Error("Invalid locator token");
  }
```

- 84-87행: `manifest.entries[options.token]`, 에러 메시지 `` `Unknown locator token: ${options.token}` ``
- 98-101행(줄·칸 존재 검사) 바로 뒤에 태그 검증 추가:

```ts
  if (!pointsToSourceTag(selectedLine, entry.column, entry.sourceTag)) {
    throw new Error(
      "Manifest entry does not match the current source; the file has changed or the token belongs to another project"
    );
  }
```

- 반환 객체 `hash: options.hash` → `token: options.token`.

- [ ] **Step 5: MCP 서버 툴을 바꾼다**

`src/mcp/server.ts`:

```ts
import { TOKEN_PATTERN } from "../shared/contracts.js";
import { resolveElementByToken } from "./resolve-element.js";
```

```ts
  server.registerTool(
    "get_astro_element_by_token",
    {
      title: "Resolve an Astro UI element",
      description:
        "Call this whenever the user provides a 5-character locator token starting with #a (for example #a7k9). Returns the exact Astro, JSX, or TSX source file, line, column, source tag, rendered DOM tag, and a focused source excerpt for that selected UI element.",
      inputSchema: {
        token: z
          .string()
          .regex(TOKEN_PATTERN)
          .describe("The token copied by Astro Inspector, like #a7k9")
      }
    },
    async ({ token }): Promise<CallToolResult> => {
      try {
        const result = await resolveElementByToken({
          projectRoot: options.projectRoot,
          token
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to resolve element";
        console.error("get_astro_element_by_token failed:", message);
        return toolError(message);
      }
    }
  );
```

- [ ] **Step 6: MCP 셋업 프롬프트 문구를 바꾼다**

`src/client/mcp-prompt.ts` 마지막 세 줄 교체:

```ts
    "Reconnect MCP servers afterwards. From then on, whenever I paste a",
    "5-character token starting with #a (for example #a7k9), call",
    "get_astro_element_by_token to resolve it to a source file, line, and",
    "column before editing anything."
```

`tests/unit/mcp-prompt.test.ts` 의 문구 단언(`astro_hash_`·`get_astro_element_by_hash` 포함 검사)을 `#a`·`get_astro_element_by_token` 으로 바꾼다.

- [ ] **Step 7: MCP stdio 통합 테스트를 바꾼다**

`tests/integration/mcp-stdio.test.ts`: 툴 호출 `name: "get_astro_element_by_token"`, `arguments: { token }`. 시딩은 Task 1 Step 10 에서 이미 `store.issue` 기반으로 바꿨다.

- [ ] **Step 8: 통과 확인**

Run: `npm run check && npm run test && npm run test:integration`
Expected: 전부 PASS (베이스라인 수 + 태그 불일치 테스트 1개 추가).

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat: resolve tokens over MCP and verify the tag still occupies the location"
```

---

## Task 3: E2E · 문서 · 0.4.0

**Files:**
- Modify: `tests/e2e/locator.spec.ts`
- Modify: `README.md`, `docs/FUTURE_WORK.md`
- Modify: `package.json`, `package-lock.json`, `src/mcp/server.ts:20`

**Interfaces:**
- Consumes: Task 1·2 전부.
- Produces: 없음. 릴리스 준비 상태.

- [ ] **Step 1: E2E 를 새 포맷으로 바꾼다**

`tests/e2e/locator.spec.ts`:
- 정규식 9곳(558, 850, 1009, 1062, 1110, 1158, 1182, 1190, 1206행): `/^astro_hash_[a-f0-9]{24}$/` → `/^#a[0-9a-z]{3}$/`
- 160행: `expect(copied).toContain("get_astro_element_by_hash")` → `"get_astro_element_by_token"`
- 1196-1265행(MCP 왕복 테스트): 변수 `hash` → `token`, `name: "get_astro_element_by_token"`, `arguments: { token }`, 응답 파싱 필드 `hash` → `token`
- 테스트 제목 2곳: `"Alt click registers the source and copies its hash"` → `...its token`, `"repeated DOM instances from one source tag share one hash"` → `...share one token`, `"the copied browser hash resolves..."` → `...browser token resolves...`
- 파일 내 `astro_hash_` 잔여 검색이 0건인지 확인: `grep -c astro_hash_ tests/e2e/locator.spec.ts` → `0`

주의: 설정 패널의 `getByRole("radio", { name: "Hash" })` 와 `copyMode: "hash"` 픽스처는 **바꾸지 않는다** — settings schema v5 유지(Global Constraints).

- [ ] **Step 2: E2E 통과 확인**

Run: `npm run build && npx playwright test`
Expected: PASS (베이스라인 수 동일).

- [ ] **Step 3: README 를 갱신한다**

- 49행 예시: `[pastes astro_hash_0123456789abcdef01234567]` → `[pastes #a7k9]`
- 96행: `` a hash like `astro_hash_0123456789abcdef01234567` is copied `` → `` a 5-character token like `#a7k9` is copied ``
- 240행 부근: `` an `astro_hash_` value `` → `` a `#a` locator token ``, `get_astro_element_by_hash` → `get_astro_element_by_token`
- 96행 문장 뒤에 셸 주의 한 줄 추가:

```markdown
Tokens start with `#`, which shells treat as a comment marker — paste them into chat or editors, not into a terminal command line.
```

- 그 외 `astro_hash_`/`hash` 잔여를 훑어 토큰 문맥이면 교체: `grep -n "astro_hash_\|hash" README.md`

- [ ] **Step 4: FUTURE_WORK #3 을 완료 처리한다**

`docs/FUTURE_WORK.md` 의 `### 3. 더 짧은 locator token` 제목을 `### 3. 더 짧은 locator token ✅ 2026-08-05 완료` 로 바꾸고, 본문을 요약으로 교체:

```markdown
`#a` + base36 3자리(5자 고정)의 서버 순번 발급으로 구현했다. manifest cap(100)과
기동 시 리셋으로 충돌 모집단 전제가 사라져, alias 이중 지원 없이 포맷을
교체했다. 랜덤 시작점(세션 솔트)과 MCP 해석 시 태그 재검증이 교차 오인을
막는다. 상세는 specs/2026-08-05-compact-token-design.md.
```

권장 구현 순서 목록의 7번 항목도 취소선 처리한다.

- [ ] **Step 5: 버전을 0.4.0 으로 올린다**

```bash
npm version minor --no-git-tag-version
```

`src/mcp/server.ts:20` 의 `version: "0.3.0"` → `"0.4.0"`.

- [ ] **Step 6: 전체 verify**

Run: `npm run verify`
Expected: check · unit · MCP integration · E2E · production output 전부 PASS.

`npm run test:production` 이 검사하는 산출물 정규식에 `astro_hash_` 가 남아 있으면(`tests/integration/production-output.test.ts`) 함께 갱신한다 — Task 1 이후 dist 에 그 문자열이 존재하지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "chore: release 0.4.0 with the compact locator token"
```

---

## 남긴 것

- **UI 라벨 "Hash"** — settings schema v5 의 `copyMode: "hash"` 값과 짝이라 라벨만 바꾸면 절반짜리가 된다. 스키마 v6 마이그레이션과 함께 별도 작업.
- **npm publish** — 0.3.0 이 아직 미배포다. 배포 순서(0.3.0 먼저 vs 0.4.0 으로 건너뛰기)는 유저 결정.
- **멀티 프로젝트 MCP** — 여전히 범위 밖. 태그 검증이 교차 오인을 대부분 잡지만 구조적 격리는 아니다.
