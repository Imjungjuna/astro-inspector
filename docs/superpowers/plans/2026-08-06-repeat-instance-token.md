# 반복 인스턴스 식별 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 호출부가 여러 DOM 인스턴스를 찍는 자리에서, 집은 것이 몇 번째 항목인지를 토큰과 복사 payload 가 구분하게 만든다.

**Architecture:** 순수 계산(`repeat-instances.ts`)과 DOM 어댑터를 분리한다. 트리거 키를 누를 때 문서를 한 번 훑어 `Map<Element, RepeatInstance>` 를 만들고, 호버·클릭은 이 캐시만 읽는다. `instance` 는 토큰 신원에 들어가고 `instanceLabel` 은 라벨·Context·MCP 응답의 힌트로만 쓰인다.

**Tech Stack:** TypeScript(ESM, NodeNext), vitest(node 환경 — DOM 없음), Playwright e2e, zod v4, Astro 7 dev 통합.

## Global Constraints

- 대상 릴리스 0.7.0. 설계 문서는 `docs/superpowers/specs/2026-08-06-repeat-instance-token-design.md`.
- 코드 주석·문서는 한국어, 커밋 제목은 영어 `<type>: <message>`.
- 인스턴스 정보는 **문서에 같은 `file+loc+sourceTag` 요소가 2개 이상일 때만** 붙는다. 단일 요소는 지금과 동일하게 동작한다.
- `instance` 는 1부터 시작하는 문서 순서. `instanceLabel` 은 공백을 하나로 접고 앞 **40자**.
- `instance` 와 `instanceLabel` 은 **함께 오거나 함께 없다**. `instanceLabel` 은 빈 문자열일 수 있다(텍스트 없는 요소).
- 토큰 신원 = `file + line + column + sourceTag + instance`. `instanceLabel` 은 신원에 넣지 않는다.
- 화면(호버 라벨·Context 복사)에는 **텍스트만** 노출한다. 순번은 MCP 응답에만 실린다.
- Context 는 `contextFields` 설정과 무관하게 반복일 때 자동으로 붙는다. 설정 토글을 늘리지 않는다.
- 서버는 인스턴스 값의 진위를 검증하지 않는다(대조군이 없다). zod 로 형태만 좁힌다.
- vitest 는 `environment: "node"` 라 DOM 이 없다. 순수 로직만 유닛 테스트하고 DOM 경로는 e2e 로 덮는다.
- 검증은 `npm run verify`. 태스크 단위로는 해당 스위트만 돌려도 된다.
- `package-lock.json` 은 관련 없는 이유로 더럽다. 절대 `git add` 하지 않는다.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/client/repeat-instances.ts` (신규) | 순수 계산: 후보 배열 → 인스턴스 순번과 라벨 텍스트 |
| `src/client/index.ts` | DOM 어댑터(수집·조상 연결), 캐시 수명, 등록 payload |
| `src/client/overlay.ts` | 호버 라벨 우측 세그먼트 |
| `src/client/clipboard-payload.ts` | Context 문자열에 항목 텍스트 |
| `src/shared/contracts.ts` | 요청·엔트리 타입 확장, manifest `schemaVersion` 3 |
| `src/manifest/schema.ts` | zod 검증(쌍 강제, 길이·범위) |
| `src/manifest/store.ts` | `identityOf` 에 `instance` 포함 |
| `src/integration/request-handler.ts` | 검증된 필드를 엔트리로 전달 |
| `src/mcp/resolve-element.ts` | MCP 응답에 두 필드 |
| `tests/fixtures/basic/src/components/RepeatList.astro` (신규) | 한 호출부에서 카드 3개 + 텍스트 없는 아이콘 버튼 |

---

### Task 1: 순수 계산 모듈

**Files:**
- Create: `src/client/repeat-instances.ts`
- Create: `tests/unit/repeat-instances.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `export const INSTANCE_LABEL_MAX = 40`
  - `export interface RepeatCandidate { identity: string; text: string; parentIndex: number | null }`
  - `export interface RepeatInstance { instance: number; instanceLabel: string }`
  - `export function normalizeInstanceLabel(text: string): string`
  - `export function resolveRepeatInstances(candidates: RepeatCandidate[]): (RepeatInstance | null)[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// tests/unit/repeat-instances.test.ts
import { describe, expect, it } from "vitest";
import {
  normalizeInstanceLabel,
  resolveRepeatInstances,
  type RepeatCandidate
} from "../../src/client/repeat-instances.js";

function candidate(
  identity: string,
  text = "",
  parentIndex: number | null = null
): RepeatCandidate {
  return { identity, text, parentIndex };
}

describe("normalizeInstanceLabel", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeInstanceLabel("  강남   A병원\n  예약 ")).toBe(
      "강남 A병원 예약"
    );
  });

  it("cuts at 40 characters", () => {
    expect(normalizeInstanceLabel("가".repeat(50))).toHaveLength(40);
  });
});

describe("resolveRepeatInstances", () => {
  it("returns null for an identity that appears once", () => {
    expect(resolveRepeatInstances([candidate("a", "혼자")])).toEqual([null]);
  });

  it("numbers repeats in document order", () => {
    const resolved = resolveRepeatInstances([
      candidate("card", "첫째"),
      candidate("card", "둘째"),
      candidate("card", "셋째")
    ]);

    expect(resolved).toEqual([
      { instance: 1, instanceLabel: "첫째" },
      { instance: 2, instanceLabel: "둘째" },
      { instance: 3, instanceLabel: "셋째" }
    ]);
  });

  it("counts each identity separately", () => {
    const resolved = resolveRepeatInstances([
      candidate("card", "A"),
      candidate("link", "L1"),
      candidate("card", "B"),
      candidate("link", "L2")
    ]);

    expect(resolved.map((value) => value?.instance)).toEqual([1, 1, 2, 2]);
  });

  it("falls back to the nearest repeating ancestor when the element has no text", () => {
    // 0,2 = 카드(반복) · 1,3 = 카드 안의 아이콘 버튼(반복, 텍스트 없음)
    const resolved = resolveRepeatInstances([
      candidate("card", "강남 A병원"),
      candidate("icon", "", 0),
      candidate("card", "강남 B병원"),
      candidate("icon", "", 2)
    ]);

    expect(resolved[1]).toEqual({ instance: 1, instanceLabel: "강남 A병원" });
    expect(resolved[3]).toEqual({ instance: 2, instanceLabel: "강남 B병원" });
  });

  it("skips a non-repeating ancestor when looking for a label", () => {
    // 0 = 목록 컨테이너(한 번만 나옴) · 1,2 = 텍스트 없는 반복 요소
    const resolved = resolveRepeatInstances([
      candidate("list", "목록 전체 텍스트"),
      candidate("icon", "", 0),
      candidate("icon", "", 0)
    ]);

    expect(resolved[1]).toEqual({ instance: 1, instanceLabel: "" });
    expect(resolved[2]).toEqual({ instance: 2, instanceLabel: "" });
  });

  it("keeps its own text even when an ancestor also has text", () => {
    const resolved = resolveRepeatInstances([
      candidate("card", "카드 전체"),
      candidate("title", "제목", 0),
      candidate("card", "카드 전체 2"),
      candidate("title", "제목 2", 2)
    ]);

    expect(resolved[1]?.instanceLabel).toBe("제목");
  });

  it("stops instead of looping when ancestors form a cycle", () => {
    const cyclic: RepeatCandidate[] = [
      { identity: "a", text: "", parentIndex: 1 },
      { identity: "a", text: "", parentIndex: 0 }
    ];

    expect(resolveRepeatInstances(cyclic)).toEqual([
      { instance: 1, instanceLabel: "" },
      { instance: 2, instanceLabel: "" }
    ]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/unit/repeat-instances.test.ts`
Expected: FAIL — `Failed to resolve import ".../repeat-instances.js"`

- [ ] **Step 3: 구현한다**

```ts
// src/client/repeat-instances.ts
/**
 * 목록처럼 한 호출부가 여러 DOM 인스턴스를 찍는 자리에서 "몇 번째"를 계산한다.
 * DOM 을 직접 만지지 않는 순수 함수다 — 유닛 테스트가 node 환경에서 돌기 때문이고,
 * 수집·조상 연결 같은 DOM 작업은 호출부(client/index.ts)가 맡는다.
 */
export const INSTANCE_LABEL_MAX = 40;

export interface RepeatCandidate {
  /** file + loc + sourceTag 를 합친 값. 같으면 같은 호출부다. */
  identity: string;
  /** 요소 자신의 텍스트. 비어 있을 수 있다. */
  text: string;
  /** 같은 후보 배열에서 가장 가까운 조상의 인덱스. 없으면 null. */
  parentIndex: number | null;
}

export interface RepeatInstance {
  instance: number;
  instanceLabel: string;
}

export function normalizeInstanceLabel(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  return collapsed.slice(0, INSTANCE_LABEL_MAX);
}

export function resolveRepeatInstances(
  candidates: RepeatCandidate[]
): (RepeatInstance | null)[] {
  const totals = new Map<string, number>();
  for (const candidate of candidates) {
    totals.set(candidate.identity, (totals.get(candidate.identity) ?? 0) + 1);
  }
  const isRepeat = (index: number): boolean => {
    const candidate = candidates[index];
    return candidate !== undefined && (totals.get(candidate.identity) ?? 0) > 1;
  };

  /**
   * 자기 텍스트를 먼저 쓰고, 비어 있으면 그 자신도 반복 인스턴스인 첫 조상의
   * 텍스트를 쓴다. 카드 안 아이콘 버튼을 집어도 카드 이름이 잡히게 하는 장치다.
   * 반복이 아닌 조상(목록 컨테이너 등)은 항목을 특정하지 못하므로 건너뛴다.
   */
  const labelFor = (index: number): string => {
    const visited = new Set<number>();
    let current: number | null = index;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      const candidate = candidates[current];
      if (!candidate) {
        break;
      }
      const own = normalizeInstanceLabel(candidate.text);
      if (own && (current === index || isRepeat(current))) {
        return own;
      }
      current = candidate.parentIndex;
    }
    return "";
  };

  const counters = new Map<string, number>();
  return candidates.map((candidate, index) => {
    if (!isRepeat(index)) {
      return null;
    }
    const instance = (counters.get(candidate.identity) ?? 0) + 1;
    counters.set(candidate.identity, instance);
    return { instance, instanceLabel: labelFor(index) };
  });
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/unit/repeat-instances.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/client/repeat-instances.ts tests/unit/repeat-instances.test.ts
git commit -m "feat: compute repeat instance order and label text"
```

---

### Task 2: 계약·검증·토큰 신원

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/manifest/schema.ts`
- Modify: `src/manifest/store.ts`
- Modify: `src/integration/request-handler.ts`
- Modify: `tests/unit/manifest-store.test.ts`
- Modify: `tests/unit/request-handler.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `RegisterElementRequest` 와 `LocatorManifestEntry` 에 `instance?: number`, `instanceLabel?: string`
  - `LocatorManifest.schemaVersion` 이 `3`
  - `identityOf` 가 `instance` 를 포함해 토큰을 가른다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/manifest-store.test.ts` 의 `describe` 안에 추가한다.

```ts
  it("gives repeat instances of one call site different tokens", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();
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
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();
    const entry = {
      file: "src/pages/index.astro",
      line: 5,
      column: 1,
      sourceTag: "h1",
      domTag: "h1"
    };

    expect(await store.issue(entry)).toBe(await store.issue(entry));
  });
```

`tests/unit/request-handler.test.ts` 에는 zod 계약을 고정하는 테스트를 추가한다. 파일에 이미 있는 `requestFor`·`responseRecorder` 를 그대로 쓴다.

```ts
  async function registerWith(extra: Record<string, unknown>) {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const source = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "<article>Card</article>\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      workspaceRoot: root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor({
        sourceFile: source,
        line: 1,
        column: 1,
        sourceTag: "article",
        domTag: "article",
        ...extra
      }),
      recorder.response,
      vi.fn()
    );

    return { recorder, store };
  }

  it("rejects an instance without its label", async () => {
    const { recorder } = await registerWith({ instance: 2 });

    expect(recorder.response.statusCode).toBe(400);
  });

  it("rejects a non-positive instance", async () => {
    const { recorder } = await registerWith({
      instance: 0,
      instanceLabel: "첫째"
    });

    expect(recorder.response.statusCode).toBe(400);
  });

  it("stores the instance pair on the manifest entry", async () => {
    const { recorder, store } = await registerWith({
      instance: 2,
      instanceLabel: "강남 B병원"
    });

    expect(recorder.response.statusCode).toBe(200);
    const manifest = JSON.parse(
      await readFile(store.manifestPath, "utf8")
    ) as {
      entries: Record<string, { instance?: number; instanceLabel?: string }>;
    };
    const token = JSON.parse(recorder.body()).token as string;
    expect(manifest.entries[token]).toMatchObject({
      instance: 2,
      instanceLabel: "강남 B병원"
    });
  });
```

같은 파일의 첫 테스트는 manifest 전체를 `toEqual` 로 비교하며 `schemaVersion: 2` 를 기대한다. Step 3 에서 버전을 올리므로 그 기대값을 `schemaVersion: 3` 으로 함께 고친다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/unit/manifest-store.test.ts tests/unit/request-handler.test.ts`
Expected: FAIL — 타입 에러 또는 토큰이 같게 나온다.

- [ ] **Step 3: 계약을 넓힌다**

`src/shared/contracts.ts`:

```ts
export interface LocatorManifestEntry {
  file: string;
  line: number;
  column: number;
  sourceTag: string;
  domTag: string;
  /** 같은 호출부가 여러 번 렌더된 자리에서만 채워진다. 1부터 센다. */
  instance?: number;
  /** 항목을 사람이 알아보게 하는 힌트. 텍스트 없는 요소에서는 빈 문자열이다. */
  instanceLabel?: string;
}
```

`RegisterElementRequest` 에도 같은 두 필드를 같은 주석과 함께 추가한다. `LocatorManifest` 의 `schemaVersion` 은 `2` 에서 `3` 으로 올린다.

- [ ] **Step 4: zod 를 좁힌다**

`src/manifest/schema.ts`:

```ts
const InstanceSchema = z.number().int().positive();
const InstanceLabelSchema = z.string().max(40);

/** 둘은 함께 오거나 함께 없어야 한다. 한쪽만 오면 힌트가 반쪽이라 거부한다. */
function hasPairedInstance(value: {
  instance?: number;
  instanceLabel?: string;
}): boolean {
  return (value.instance === undefined) === (value.instanceLabel === undefined);
}

export const LocatorManifestEntrySchema = z
  .object({
    file: z.string().min(1).max(4096),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    sourceTag: SourceTagSchema,
    domTag: DomTagSchema,
    instance: InstanceSchema.optional(),
    instanceLabel: InstanceLabelSchema.optional()
  })
  .strict()
  .refine(hasPairedInstance, {
    message: "instance and instanceLabel must be provided together"
  });
```

`LocatorManifestSchema` 의 `schemaVersion` 은 `z.literal(3)` 으로 바꾸고, `RegisterElementRequestSchema` 에도 같은 두 필드와 같은 `.refine` 을 붙인다.

- [ ] **Step 5: 토큰 신원에 넣는다**

`src/manifest/store.ts` 의 `identityOf`:

```ts
function identityOf(entry: LocatorManifestEntry): string {
  return [
    entry.file,
    String(entry.line),
    String(entry.column),
    entry.sourceTag,
    // 인스턴스가 없는 요소는 예전과 같은 신원을 유지해야 하므로 0 으로 채운다.
    String(entry.instance ?? 0)
  ].join("\0");
}
```

`store.issue` 위의 주석에서 신원 목록을 `file+line+column+sourceTag+instance` 로 고친다.

- [ ] **Step 6: 핸들러가 필드를 넘기게 한다**

`src/integration/request-handler.ts` 에서 검증된 요청으로 엔트리를 만드는 지점을 찾아, `instance` 와 `instanceLabel` 을 그대로 얹는다. 값이 없으면 키를 넣지 않는다(`exactOptionalPropertyTypes` 가 켜져 있어 `undefined` 를 명시적으로 대입하면 타입이 깨진다).

```ts
    const entry: LocatorManifestEntry = {
      file: relativeFile,
      line: request.line,
      column: request.column,
      sourceTag: request.sourceTag,
      domTag: request.domTag,
      ...(request.instance === undefined
        ? {}
        : {
            instance: request.instance,
            instanceLabel: request.instanceLabel ?? ""
          })
    };
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npm run check && npx vitest run tests/unit`
Expected: PASS. `schemaVersion` 을 올렸으므로 예전 manifest 파일은 거부되지만, 스토어는 dev 서버 기동마다 `reset()` 하므로 마이그레이션은 필요 없다.

- [ ] **Step 8: 커밋한다**

```bash
git add src/shared/contracts.ts src/manifest/schema.ts src/manifest/store.ts src/integration/request-handler.ts tests/unit/manifest-store.test.ts tests/unit/request-handler.test.ts
git commit -m "feat: split tokens by repeat instance"
```

---

### Task 3: 클라이언트 수집과 등록 payload

**Files:**
- Modify: `src/client/index.ts`
- Create: `tests/fixtures/basic/src/components/RepeatList.astro`
- Modify: `tests/fixtures/basic/src/pages/index.astro`
- Modify: `tests/e2e/locator.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `resolveRepeatInstances`, `RepeatCandidate`, `RepeatInstance`; Task 2 의 `RegisterElementRequest` 확장
- Produces: 클릭 시 payload 에 `instance`·`instanceLabel` 이 실린다. 픽스처에 `data-testid="repeat-card-title"`(3개)와 `data-testid="repeat-card-icon"`(3개)가 생긴다.

- [ ] **Step 1: 픽스처를 만든다**

```astro
---
// tests/fixtures/basic/src/components/RepeatList.astro
// 한 호출부가 카드 3개를 찍는다. 아이콘 버튼은 텍스트가 없어 조상 폴백을 검증한다.
const hospitals = ["강남 A병원", "강남 B병원", "강남 C병원"];
---

<ul class="repeat-list">
  {
    hospitals.map((name) => (
      <li class="repeat-card" data-testid="repeat-card">
        <a href={`/hospital/${name}`} data-testid="repeat-card-title">
          {name}
        </a>
        <button type="button" aria-label="북마크" data-testid="repeat-card-icon" />
      </li>
    ))
  }
</ul>
```

`tests/fixtures/basic/src/pages/index.astro` 의 import 목록에 `import RepeatList from "../components/RepeatList.astro";` 를 추가하고, `<PlainWrapper>` 바로 뒤에 `<RepeatList />` 를 넣는다.

- [ ] **Step 2: 실패하는 e2e 테스트를 쓴다**

`tests/e2e/locator.spec.ts` 의 `repeated DOM instances from one source tag share one hash` 테스트 **바로 앞**에 넣는다.

```ts
test("repeat instances of one call site get different tokens", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));

  const titles = page.getByTestId("repeat-card-title");
  await titles.nth(0).click({ modifiers: ["Alt"] });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^#[0-9a-z]{4}$/u);
  const first = await page.evaluate(() => navigator.clipboard.readText());

  await page.evaluate(() => navigator.clipboard.writeText(""));
  await titles.nth(2).click({ modifiers: ["Alt"] });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^#[0-9a-z]{4}$/u);
  const third = await page.evaluate(() => navigator.clipboard.readText());

  expect(first).not.toBe(third);

  const manifestPath = path.resolve(
    "tests/fixtures/basic/.astro-ai-locator/manifest.json"
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    entries: Record<
      string,
      { instance?: number; instanceLabel?: string }
    >;
  };
  expect(manifest.entries[first]).toMatchObject({
    instance: 1,
    instanceLabel: "강남 A병원"
  });
  expect(manifest.entries[third]).toMatchObject({
    instance: 3,
    instanceLabel: "강남 C병원"
  });
});

test("a repeat instance with no text of its own borrows the card label", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));

  await page.getByTestId("repeat-card-icon").nth(1).click({ modifiers: ["Alt"] });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^#[0-9a-z]{4}$/u);
  const token = await page.evaluate(() => navigator.clipboard.readText());

  const manifestPath = path.resolve(
    "tests/fixtures/basic/.astro-ai-locator/manifest.json"
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    entries: Record<string, { instance?: number; instanceLabel?: string }>;
  };
  expect(manifest.entries[token]).toMatchObject({
    instance: 2,
    instanceLabel: "강남 B병원"
  });
});
```

- [ ] **Step 3: 기존 테스트의 전제를 갱신한다**

`repeated DOM instances from one source tag share one hash` 는 `Card.astro` 가 map 으로 찍는 `card-alpha` 와 `card-beta` 를 집어 **같은 토큰**을 기대한다. 이 변경으로 둘은 서로 다른 인스턴스가 되므로 전제가 뒤집힌다. 테스트 이름과 본문을 바꾼다.

```ts
test("repeated DOM instances are told apart by their instance order", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .getByTestId("card-alpha")
    .click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^#[0-9a-z]{4}$/u);
  const first = await page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .getByTestId("card-beta")
    .click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^#[0-9a-z]{4}$/u);
  const second = await page.evaluate(() => navigator.clipboard.readText());

  // 같은 호출부지만 다른 인스턴스라 토큰이 갈린다. 같은 카드를 다시 집으면 같은 토큰이다.
  expect(first).not.toBe(second);
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .getByTestId("card-alpha")
    .click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(first);
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `npm run build && npx playwright test -g "repeat instances of one call site"`
Expected: FAIL — 두 토큰이 같다.

- [ ] **Step 5: 수집 어댑터를 만든다**

`src/client/index.ts` 상단 import 에 추가한다.

```ts
import {
  resolveRepeatInstances,
  type RepeatCandidate,
  type RepeatInstance
} from "./repeat-instances.js";
```

`collectPointerTransparentCandidates` 아래에 어댑터를 둔다.

```ts
/**
 * 트리거 키를 누를 때 한 번만 돈다. 호버마다 문서를 다시 훑으면 큰 목록에서 비싸다.
 * 순번 계산은 순수 함수에 맡기고, 여기서는 DOM 에서 재료만 뽑는다.
 */
function collectRepeatInstances(): Map<Element, RepeatInstance> {
  const elements = Array.from(document.querySelectorAll(SOURCE_SELECTOR));
  const indexByElement = new Map<Element, number>();
  elements.forEach((element, index) => {
    indexByElement.set(element, index);
  });
  const candidates: RepeatCandidate[] = elements.map((element) => {
    let ancestor = element.parentElement;
    let parentIndex: number | null = null;
    while (ancestor) {
      const found = indexByElement.get(ancestor);
      if (found !== undefined) {
        parentIndex = found;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    return {
      identity: [
        element.getAttribute(SOURCE_FILE_ATTRIBUTE) ?? "",
        element.getAttribute(SOURCE_LOCATION_ATTRIBUTE) ?? "",
        element.getAttribute(SOURCE_TAG_ATTRIBUTE) ?? element.localName
      ].join(" "),
      text: element.textContent ?? "",
      parentIndex
    };
  });
  const resolved = resolveRepeatInstances(candidates);
  const instances = new Map<Element, RepeatInstance>();
  elements.forEach((element, index) => {
    const value = resolved[index];
    if (value) {
      instances.set(element, value);
    }
  });
  return instances;
}
```

- [ ] **Step 6: 캐시 수명을 붙인다**

`installReadyLocator` 안, `let pointerTransparentCandidates: Element[] = [];` 옆에 상태를 추가한다.

```ts
  let repeatInstances = new Map<Element, RepeatInstance>();
```

`setActive` 에서 `pointerTransparentCandidates = collectPointerTransparentCandidates();` 바로 다음 줄에 `repeatInstances = collectRepeatInstances();` 를 넣고, 비활성 분기에서 `pointerTransparentCandidates = [];` 옆에 `repeatInstances = new Map();` 을 넣는다.

- [ ] **Step 7: payload 에 싣는다**

`parseTarget` 이 인스턴스를 함께 받도록 시그니처를 넓힌다.

```ts
function parseTarget(
  target: Element,
  repeat: RepeatInstance | undefined
): RegisterElementRequest | null {
  const sourceFile = target.getAttribute(SOURCE_FILE_ATTRIBUTE);
  const location = target.getAttribute(SOURCE_LOCATION_ATTRIBUTE);
  const domTag = target.localName.toLowerCase();
  const sourceTag = target.getAttribute(SOURCE_TAG_ATTRIBUTE) ?? domTag;
  const match = location?.match(/^(\d+):(\d+)$/u);
  if (!sourceFile || !match) {
    return null;
  }
  return {
    sourceFile,
    line: Number(match[1]),
    column: Number(match[2]),
    sourceTag,
    domTag,
    ...(repeat
      ? { instance: repeat.instance, instanceLabel: repeat.instanceLabel }
      : {})
  };
}
```

클릭 핸들러의 호출부를 `const input = parseTarget(target, repeatInstances.get(target));` 로 바꾼다.

클릭이 트리거 키 없이 들어오는 경로가 있다면 캐시가 비어 있을 수 있다. 그 경우 `repeatInstances.get(target)` 이 `undefined` 라 예전 동작 그대로다 — 클릭 직전에 다시 수집하지 않는다.

- [ ] **Step 8: 통과를 확인한다**

Run: `npm run build && npx playwright test -g "repeat instance"` 그리고 `npx playwright test -g "repeated DOM instances"`
Expected: PASS (3 tests)

- [ ] **Step 9: 커밋한다**

```bash
git add src/client/index.ts tests/fixtures/basic/src/components/RepeatList.astro tests/fixtures/basic/src/pages/index.astro tests/e2e/locator.spec.ts
git commit -m "feat: send the repeat instance with each registration"
```

---

### Task 4: 라벨과 Context 표기

**Files:**
- Modify: `src/client/overlay.ts`
- Modify: `src/client/index.ts`
- Modify: `src/client/clipboard-payload.ts`
- Modify: `tests/unit/clipboard-payload.test.ts`
- Modify: `tests/e2e/locator.spec.ts`

**Interfaces:**
- Consumes: Task 3 의 `repeatInstances` 캐시, Task 2 의 엔트리 확장
- Produces: `overlay.show(target, instanceLabel?)`, Context 문자열 끝에 ` | <항목 텍스트>`

- [ ] **Step 1: 실패하는 유닛 테스트를 쓴다**

`tests/unit/clipboard-payload.test.ts` 에 추가한다. 이 파일에 이미 있는 registration 픽스처 생성 방식을 그대로 따르되, 엔트리에 두 필드를 얹는다.

```ts
  it("appends the item label for a repeat instance", () => {
    const payload = formatClipboardPayload(
      {
        token: "#a7k9",
        workspaceFile: "/src/pages/list.astro",
        entry: {
          file: "src/pages/list.astro",
          line: 42,
          column: 7,
          sourceTag: "Link",
          domTag: "a",
          instance: 3,
          instanceLabel: "강남 C병원"
        }
      },
      {
        schemaVersion: 5,
        triggerKey: "alt",
        colorPreset: "violet",
        parentLevels: 1,
        copyMode: "context",
        contextFields: ["tag", "location", "line"],
        locationFormat: "path"
      }
    );

    expect(payload).toBe(
      "<Link→a> | /src/pages/list.astro:42:7 | 강남 C병원"
    );
  });

  it("omits the label when the instance has no text", () => {
    const payload = formatClipboardPayload(
      {
        token: "#a7k9",
        workspaceFile: "/src/pages/list.astro",
        entry: {
          file: "src/pages/list.astro",
          line: 42,
          column: 7,
          sourceTag: "button",
          domTag: "button",
          instance: 2,
          instanceLabel: ""
        }
      },
      {
        schemaVersion: 5,
        triggerKey: "alt",
        colorPreset: "violet",
        parentLevels: 1,
        copyMode: "context",
        contextFields: ["tag"],
        locationFormat: "path"
      }
    );

    expect(payload).toBe("<button>");
  });

  it("leaves the hash payload untouched for a repeat instance", () => {
    const payload = formatClipboardPayload(
      {
        token: "#a7k9",
        workspaceFile: "/src/pages/list.astro",
        entry: {
          file: "src/pages/list.astro",
          line: 42,
          column: 7,
          sourceTag: "Link",
          domTag: "a",
          instance: 3,
          instanceLabel: "강남 C병원"
        }
      },
      {
        schemaVersion: 5,
        triggerKey: "alt",
        colorPreset: "violet",
        parentLevels: 1,
        copyMode: "hash",
        contextFields: ["tag"],
        locationFormat: "path"
      }
    );

    expect(payload).toBe("#a7k9");
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/unit/clipboard-payload.test.ts`
Expected: FAIL — 라벨이 붙지 않아 첫 테스트가 어긋난다.

- [ ] **Step 3: Context 에 붙인다**

`src/client/clipboard-payload.ts` 의 `formatClipboardPayload` 에서 `parts.length === 0` 검사 **앞**에 넣는다.

```ts
  // 반복 항목일 때만, 설정과 무관하게 붙는다. 어느 항목인지가 위치보다 먼저 필요하다.
  const instanceLabel = registration.entry.instanceLabel;
  if (instanceLabel) {
    parts.push(instanceLabel);
  }
```

- [ ] **Step 4: 유닛 통과를 확인한다**

Run: `npx vitest run tests/unit/clipboard-payload.test.ts`
Expected: PASS

- [ ] **Step 5: 실패하는 e2e 테스트를 쓴다**

```ts
test("the hover label shows which item a repeat instance is", async ({
  page
}) => {
  await mockSettingsEndpoint(page);
  await page.goto("/");

  const label = page.locator("[data-astro-ai-locator-overlay] .label");
  await page.getByTestId("repeat-card-title").nth(1).hover();
  await page.keyboard.down("Alt");
  await expect(label).toHaveText(/│강남 B병원$/u);

  // 반복이 아닌 요소에는 항목 세그먼트가 붙지 않는다.
  await page.getByRole("heading", { name: "Locator fixture" }).hover();
  await expect(label).toHaveText(/^<h1>│index\.astro│\d+:\d+$/u);
  await page.keyboard.up("Alt");
});

test("Context copy carries the item text for a repeat instance", async ({
  page
}) => {
  await mockSettingsEndpoint(page, "alt", "violet", 1, {
    copyMode: "context",
    contextFields: ["tag", "location", "line"],
    locationFormat: "path"
  });
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));

  await page.getByTestId("repeat-card-title").nth(2).click({ modifiers: ["Alt"] });

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^<a>\s\|\s\/tests\/fixtures\/basic\/src\/components\/RepeatList\.astro:\d+:\d+\s\|\s강남 C병원$/u);
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npm run build && npx playwright test -g "hover label shows which item"`
Expected: FAIL — 라벨에 항목 텍스트가 없다.

- [ ] **Step 7: 오버레이에 세그먼트를 넣는다**

`src/client/overlay.ts` 의 shadow 마크업에서 `.label` 안 마지막에 구분자와 세그먼트를 추가한다.

```html
<span class="label-separator" aria-hidden="true">│</span><span class="label-instance"></span>
```

스타일은 `.label-location` 규칙 아래에 둔다.

```css
      .label-instance {
        font-weight: 400;
        opacity: 0.85;
      }
```

세그먼트가 비었을 때 구분자만 남지 않도록, 인스턴스 구분자에는 표시 제어용 클래스를 준다. 마크업의 그 구분자를 `<span class="label-separator label-instance-separator" aria-hidden="true">│</span>` 로 쓰고 규칙을 더한다.

```css
      .label:not([data-instance]) .label-instance-separator,
      .label:not([data-instance]) .label-instance {
        display: none;
      }
```

`createOverlay` 에서 두 노드를 잡고(`labelInstance`), 초기화 실패 검사에 포함한 뒤 `show` 의 시그니처와 본문을 바꾼다.

```ts
    show(target, instanceLabel) {
      // ...기존 본문...
      labelLocation.textContent = location;
      if (instanceLabel) {
        label.dataset.instance = "";
        labelInstance.textContent = instanceLabel;
      } else {
        delete label.dataset.instance;
        labelInstance.textContent = "";
      }
      label.style.display = "block";
      // ...이하 배치 계산은 그대로...
    },
```

`LocatorOverlay` 인터페이스의 `show` 를 `show(target: Element, instanceLabel?: string): void` 로 넓힌다.

- [ ] **Step 8: 호출부에서 라벨을 넘긴다**

`src/client/index.ts` 에서 `overlay.show(activeTarget)` 을 부르는 지점을 모두 찾아(`repositionActiveTarget` 포함) 다음 형태로 바꾼다.

```ts
overlay.show(activeTarget, repeatInstances.get(activeTarget)?.instanceLabel);
```

- [ ] **Step 9: 통과를 확인한다**

Run: `npm run build && npx playwright test`
Expected: PASS. 라벨 텍스트를 정규식으로 고정한 기존 테스트가 있다면(`Alt hover reveals…`, `a stretched pseudo-element…` 등) 반복 요소를 집는 것이 있는지 확인하고, 있다면 기대값 끝에 항목 세그먼트를 더한다. 픽스처의 `card-alpha`·`react-child-label` 은 반복 요소이므로 특히 확인한다.

- [ ] **Step 10: 커밋한다**

```bash
git add src/client/overlay.ts src/client/index.ts src/client/clipboard-payload.ts tests/unit/clipboard-payload.test.ts tests/e2e/locator.spec.ts
git commit -m "feat: show the item label for repeat instances"
```

---

### Task 5: MCP 응답

**Files:**
- Modify: `src/mcp/resolve-element.ts`
- Modify: `src/mcp/server.ts`
- Modify: `tests/unit/resolve-element.test.ts`

**Interfaces:**
- Consumes: Task 2 의 엔트리 확장
- Produces: MCP 결과 객체에 `instance?: number`, `instanceLabel?: string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/resolve-element.test.ts` 에 추가한다. 파일의 기존 테스트와 같은 준비 방식이다 — 임시 루트에 소스 파일을 쓰고 `store.issue` 로 토큰을 받는다. 소스 첫 줄이 엔트리의 `sourceTag` 를 그 `column` 에서 가리켜야 한다(해석기가 태그 일치를 재검증한다).

```ts
  async function resolveWithEntry(
    extra: { instance?: number; instanceLabel?: string }
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const file = path.join(root, "src", "list.astro");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "<a href=\"/x\">강남 C병원</a>\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const token = await store.issue({
      file: "src/list.astro",
      line: 1,
      column: 1,
      sourceTag: "a",
      domTag: "a",
      ...extra
    });

    return resolveElementByToken({ projectRoot: root, token });
  }

  it("returns the instance pair when the entry carries one", async () => {
    const resolved = await resolveWithEntry({
      instance: 3,
      instanceLabel: "강남 C병원"
    });

    expect(resolved).toMatchObject({
      instance: 3,
      instanceLabel: "강남 C병원"
    });
  });

  it("omits the instance pair when the entry has none", async () => {
    const resolved = await resolveWithEntry({});

    expect(resolved).not.toHaveProperty("instance");
    expect(resolved).not.toHaveProperty("instanceLabel");
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/unit/resolve-element.test.ts`
Expected: FAIL — 결과에 두 필드가 없다.

- [ ] **Step 3: 응답에 싣는다**

`src/mcp/resolve-element.ts` 의 결과 인터페이스에 두 필드를 선택으로 추가하고, 반환 객체 끝에 조건부로 얹는다.

```ts
  return {
    token: options.token,
    relativeFile: entry.file,
    absoluteFile: canonicalSource,
    line: entry.line,
    column: entry.column,
    sourceTag: entry.sourceTag,
    domTag: entry.domTag,
    ...(entry.instance === undefined
      ? {}
      : {
          instance: entry.instance,
          instanceLabel: entry.instanceLabel ?? ""
        }),
    excerpt: createExcerpt(source, entry.line)
  };
```

- [ ] **Step 4: 툴 설명을 갱신한다**

`src/mcp/server.ts` 에서 `get_astro_element_by_token` 의 설명 문자열을 찾아, 반복 항목일 때 `instance`(1부터 세는 문서 순서)와 `instanceLabel`(항목 텍스트)이 함께 온다는 한 문장을 더한다. 기존 문장은 건드리지 않는다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npm run check && npx vitest run tests/unit && npm run test:integration`
Expected: PASS

- [ ] **Step 6: 커밋한다**

```bash
git add src/mcp/resolve-element.ts src/mcp/server.ts tests/unit/resolve-element.test.ts
git commit -m "feat: return the repeat instance through MCP"
```

---

### Task 6: 문서

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1-5 의 최종 동작
- Produces: 없음

- [ ] **Step 1: Hash stability 절을 고친다**

README 의 `### Hash stability` 첫 문장은 지금 이렇게 말한다: *"Repeated renders of the same `.astro` tag share one token across all DOM instances."* 이 변경으로 더 이상 사실이 아니다. 그 문장을 아래로 교체한다(뒤따르는 manifest cap 문단은 그대로 둔다).

```markdown
Repeated renders of the same `.astro` tag are told apart by their instance order, so the third card in a list gets its own token — clicking that same card again returns the same token. A tag that renders once keeps a single token, unchanged from before. When the file changes through HMR — or is deleted — its existing tokens are invalidated.
```

- [ ] **Step 2: 반복 항목 절을 새로 쓴다**

`### The hover label` 절 바로 뒤에 넣는다.

```markdown
### Repeated items

One call site can render many DOM nodes — a list, a grid, a table body. All of them share a source location, so the location alone cannot say *which* card you pointed at.

When a page holds two or more elements with the same source location, the locator adds the item's own text to the answer:

```
◆ <Link→a> │ list.astro │ 42:7 │ 강남 C병원
```

- The hover label and `Context` copy show the text. An element with no text of its own — an icon button inside a card — borrows the text of the nearest repeating ancestor.
- The token differs per item, so `Hash` copy points your agent at the card you clicked, not at the loop.
- The MCP response adds `instance` (1-based document order) alongside the text, so an agent can tell the third card from the first even when two cards read the same.

Instance order is read at click time. Re-sorting or filtering the list afterwards does not update a token you already copied.
```

- [ ] **Step 3: 전체 검증**

Run: `npm run verify`
Expected: 전부 PASS.

- [ ] **Step 4: 커밋한다**

```bash
git add README.md
git commit -m "docs: describe repeated item identity"
```

---

## 검증 요약

| 명령 | 무엇을 지키나 |
| --- | --- |
| `npx vitest run tests/unit` | 순번·라벨 계산, zod 쌍 강제, 토큰 신원 분리, Context 문자열, MCP 필드 |
| `npx playwright test` | 카드마다 다른 토큰, 조상 폴백, 라벨 세그먼트, 반복 아닌 요소는 그대로 |
| `npm run verify` | 위 전부 + 타입체크 + 통합 + 빌드 |
