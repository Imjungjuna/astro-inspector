# 창닫기 옵션 2종 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** locator 종료를 Hide(이 탭에서 여우 버튼만 제거, 새로고침하면 복귀)와 Quit(dev 서버 전체 종료 + 서버 계측 정지) 두 갈래로 나눈다.

**Architecture:** `disabled` 플래그를 `createSessionHandler` 지역 변수에서 공유 모듈(`session-state.ts`)로 끌어올려 Vite 플러그인이 같은 값을 읽게 한다. 플러그인은 disabled 이면 `load()` 주입을 건너뛰고, `/register` 에 410 을 돌려주고, watcher 리스너를 떼고, 이미 변환된 모듈을 무효화한다. Hide 는 서버를 건드리지 않고 클라이언트에서 설정 패널 호스트만 제거한다.

**Tech Stack:** TypeScript(ESM, NodeNext), Vite 8 플러그인 API, Astro 7, vitest(unit·integration), Playwright(e2e).

## Global Constraints

- 대상 릴리스 0.6.0. 설계 문서는 `docs/superpowers/specs/2026-08-05-close-options-design.md`.
- 코드 주석·문서는 한국어, 커밋 제목은 영어 `<type>: <message>`.
- Node.js ≥ 22.12. 새 런타임 의존성 추가 금지.
- Hide 상태는 저장하지 않는다. 클라이언트 메모리, 탭 단위, 복구는 새로고침뿐.
- Quit 후에도 `/session` 과 `/settings` 는 계속 응답한다. `/register` 만 410.
- Hide 문구: `Button hidden. Reload the page to bring it back.`
- Hide 버튼 `aria-label`·`title`: `Hide the button until reload`.
- Quit 토스트 문구는 현행 유지: `Locator closed. Restart the dev server to bring it back.`
- 검증은 `npm run verify`. 태스크 단위로는 해당 스위트만 돌려도 된다.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/integration/session-state.ts` (신규) | disabled 플래그 하나와 disable 시 실행할 리스너 목록. 서버 상태의 단일 출처 |
| `src/integration/session-handler.ts` (수정) | HTTP 계약만 담당. 플래그는 주입받는다 |
| `src/integration/vite-plugin.ts` (수정) | 상태 생성·주입, `load()` 스킵, `/register` 410, watcher 해제, 모듈 무효화 |
| `src/client/hide-mark.ts` (신규) | eye-off 아이콘 SVG 문자열 |
| `src/client/settings-panel.ts` (수정) | 푸터에 Hide 아이콘 버튼 추가, `onHide` 콜백 호출 |
| `src/client/index.ts` (수정) | `onHide` 구현 — 패널만 파괴하고 토스트, 리스너·오버레이는 유지 |
| `tests/unit/session-state.test.ts` (신규) | 상태 모듈 단위 테스트 |
| `tests/integration/quit-stops-instrumentation.test.ts` (신규) | 전용 dev 서버로 Quit 이후 HTML 검증 |

---

### Task 1: 모듈 무효화 실측 스파이크

설계 §2 는 "무효화하되 HMR 은 보내지 않는다"로 잡혀 있지만, Astro 가 `.astro` 모듈 무효화를 감지해 자체적으로 full reload 를 밀 수 있다. 코드를 쓰기 전에 실측한다.

**Files:**
- Create: `.claude/scratch/invalidate-spike.mjs` (커밋하지 않는다)
- Modify: `docs/superpowers/specs/2026-08-05-close-options-design.md` (결과 반영)

**Interfaces:**
- Consumes: 없음
- Produces: Task 3 이 구현할 무효화 방식의 확정. 두 결과 중 하나 — `invalidate` 또는 `silent`

- [ ] **Step 1: 픽스처 dev 서버를 스파이크 스크립트로 띄운다**

```js
// .claude/scratch/invalidate-spike.mjs
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../tests/fixtures/basic", import.meta.url));
const server = await createServer({ root, server: { port: 45199 } });
await server.listen();

// 1) 페이지를 한 번 SSR 해서 모듈 그래프를 채운다.
await fetch("http://127.0.0.1:45199/").then((response) => response.text());

// 2) 사용 가능한 모듈 그래프 API 를 찍는다. Vite 8 은 environments 로 갈라져 있다.
console.log("has server.environments:", Boolean(server.environments));
console.log("has server.moduleGraph:", Boolean(server.moduleGraph));

// 3) HMR 로 나가는 메시지를 전부 기록한다.
const sent = [];
const originalSend = server.ws.send.bind(server.ws);
server.ws.send = (...args) => {
  sent.push(JSON.stringify(args[0] ?? args));
  return originalSend(...args);
};

// 4) .astro 모듈을 무효화한다.
const graphs = server.environments
  ? Object.values(server.environments).map((environment) => environment.moduleGraph)
  : [server.moduleGraph];
let invalidated = 0;
for (const graph of graphs) {
  for (const module of graph.idToModuleMap.values()) {
    if (module.file?.endsWith(".astro")) {
      graph.invalidateModule(module);
      invalidated += 1;
    }
  }
}
console.log("invalidated modules:", invalidated);

await new Promise((resolve) => setTimeout(resolve, 1000));
console.log("ws messages after invalidate:", sent);
await server.close();
```

- [ ] **Step 2: 실행하고 출력을 읽는다**

Run: `node .claude/scratch/invalidate-spike.mjs`
확인할 것 두 가지 — `invalidated modules` 가 0보다 큰가, `ws messages after invalidate` 에 `full-reload` 나 `update` 가 들어 있는가.

- [ ] **Step 3: 결과를 스펙에 적는다**

`full-reload` 가 없으면 스펙 §2 의 무효화 행 뒤에 한 줄 추가:

```markdown
2026-08-05 실측: 무효화만으로는 HMR 메시지가 나가지 않는다(스파이크 확인). 설계대로 간다.
```

`full-reload` 가 나오면 그 행을 다음으로 교체하고, Task 3 Step 5·6 과 Task 5 를 이 결정에 맞춰 조정한다:

```markdown
| 이미 변환된 모듈 | 손대지 않는다. 무효화하면 Astro 가 full reload 를 밀어 폼 입력이 날아간다(2026-08-05 실측). 다음 요청부터 주입만 건너뛴다 |
```

- [ ] **Step 4: 스크립트를 지우고 스펙 변경만 커밋한다**

```bash
rm .claude/scratch/invalidate-spike.mjs
git add docs/superpowers/specs/2026-08-05-close-options-design.md
git commit -m "docs: record the module invalidation spike result"
```

---

### Task 2: 세션 상태 모듈

**Files:**
- Create: `src/integration/session-state.ts`
- Create: `tests/unit/session-state.test.ts`
- Modify: `src/integration/session-handler.ts`
- Modify: `tests/unit/session-handler.test.ts`
- Modify: `src/integration/vite-plugin.ts:111-114` (핸들러 생성부에 상태 주입)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `export interface LocatorSessionStateStore { isDisabled(): boolean; disable(): void; onDisable(listener: () => void): void }`
  - `export function createSessionState(): LocatorSessionStateStore`
  - `createSessionHandler` 옵션에 `state: LocatorSessionStateStore` 추가 (필수)
  - `createLocatorVitePlugin` 옵션에 `session?: LocatorSessionStateStore` 추가 (테스트 주입용, 기본값은 내부 생성)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// tests/unit/session-state.test.ts
import { describe, expect, it, vi } from "vitest";
import { createSessionState } from "../../src/integration/session-state.js";

describe("createSessionState", () => {
  it("starts enabled", () => {
    expect(createSessionState().isDisabled()).toBe(false);
  });

  it("stays disabled once disabled", () => {
    const state = createSessionState();
    state.disable();
    state.disable();
    expect(state.isDisabled()).toBe(true);
  });

  it("runs every listener once on the first disable", () => {
    const state = createSessionState();
    const first = vi.fn();
    const second = vi.fn();
    state.onDisable(first);
    state.onDisable(second);

    state.disable();
    state.disable();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("runs a listener registered after disable immediately", () => {
    const state = createSessionState();
    state.disable();
    const listener = vi.fn();

    state.onDisable(listener);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/unit/session-state.test.ts`
Expected: FAIL — `Failed to resolve import ".../session-state.js"`

- [ ] **Step 3: 최소 구현을 쓴다**

```ts
// src/integration/session-state.ts
/**
 * dev 서버 프로세스 하나가 들고 있는 종료 플래그. 세션 핸들러와 Vite 플러그인이
 * 같은 값을 봐야 하므로 핸들러 밖으로 뺐다. 디스크에 쓰지 않는다 — 영속화하면
 * 재시작이라는 유일한 복구 경로가 막힌다.
 */
export interface LocatorSessionStateStore {
  isDisabled(): boolean;
  disable(): void;
  onDisable(listener: () => void): void;
}

export function createSessionState(): LocatorSessionStateStore {
  let disabled = false;
  const listeners: Array<() => void> = [];

  return {
    isDisabled: () => disabled,
    disable() {
      if (disabled) {
        return;
      }
      disabled = true;
      for (const listener of listeners) {
        listener();
      }
    },
    // 이미 닫힌 뒤 붙는 리스너도 정리 작업을 놓치면 안 되므로 즉시 실행한다.
    onDisable(listener) {
      if (disabled) {
        listener();
        return;
      }
      listeners.push(listener);
    }
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/unit/session-state.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 세션 핸들러가 이 상태를 쓰게 바꾼다**

`src/integration/session-handler.ts` 에서 지역 `let disabled = false;` 를 지우고 옵션으로 받는다.

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LocatorSessionState } from "../shared/contracts.js";
import type { LocatorSessionStateStore } from "./session-state.js";

type Next = (error?: unknown) => void;

interface SessionHandlerOptions {
  mcpCommand: string;
  mcpArgs: string[];
  sessionToken: string;
  state: LocatorSessionStateStore;
}

export function createSessionHandler(options: SessionHandlerOptions) {
  const state = (): LocatorSessionState => ({
    disabled: options.state.isDisabled(),
    mcpCommand: options.mcpCommand,
    mcpArgs: [...options.mcpArgs]
  });
  // ... 이하 본문은 그대로. POST 분기만 아래로 바꾼다.
```

POST 분기:

```ts
    if (request.method === "POST") {
      options.state.disable();
      request.resume();
    }
```

- [ ] **Step 6: 기존 세션 핸들러 테스트를 새 시그니처에 맞춘다**

`tests/unit/session-handler.test.ts` 의 `createHandler` 를 교체한다.

```ts
import { createSessionState } from "../../src/integration/session-state.js";

function createHandler(state = createSessionState()) {
  return createSessionHandler({
    mcpCommand: "/project/node_modules/.bin/astro-inspector-mcp",
    mcpArgs: ["--project-root", "/project"],
    sessionToken: TOKEN,
    state
  });
}
```

같은 파일에 상태 공유를 고정하는 테스트를 하나 추가한다.

```ts
  it("reports the shared state that the plugin also reads", async () => {
    const state = createSessionState();
    const handler = createHandler(state);
    const quit = createExchange("POST", TOKEN);

    await handler(quit.request, quit.response, () => {});

    expect(state.isDisabled()).toBe(true);
  });
```

- [ ] **Step 7: 플러그인이 상태를 만들어 주입하게 한다**

`src/integration/vite-plugin.ts` 의 옵션과 핸들러 생성부를 바꾼다.

```ts
import { createSessionState, type LocatorSessionStateStore } from "./session-state.js";

interface LocatorVitePluginOptions {
  root: string;
  sessionToken: string;
  store?: ManifestStore;
  settingsStore?: LocatorSettingsStore;
  session?: LocatorSessionStateStore;
}
```

```ts
  const session = options.session ?? createSessionState();
  const sessionHandler = createSessionHandler({
    ...resolveMcpCommand(configuredRoot, workspaceRoot),
    sessionToken: options.sessionToken,
    state: session
  });
```

- [ ] **Step 8: 유닛 스위트와 타입체크를 돌린다**

Run: `npm run check && npx vitest run tests/unit`
Expected: PASS. 실패하면 `state` 를 넘기지 않은 호출부가 남은 것이다.

- [ ] **Step 9: 커밋한다**

```bash
git add src/integration/session-state.ts src/integration/session-handler.ts src/integration/vite-plugin.ts tests/unit/session-state.test.ts tests/unit/session-handler.test.ts
git commit -m "refactor: move the dev-server disable flag into shared session state"
```

---

### Task 3: Quit 이 서버 계측을 멈춘다

**Files:**
- Modify: `src/integration/vite-plugin.ts` (`load`, `configureServer`)
- Modify: `tests/unit/vite-plugin.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `createSessionState()`, `createLocatorVitePlugin({ session })`
- Produces: disabled 상태에서 `load()` 가 `null`, `/register` 가 410, watcher `unlink` 리스너 해제, 주입된 모듈 무효화

- [ ] **Step 1: 실패하는 테스트 세 개를 쓴다**

`tests/unit/vite-plugin.test.ts` 상단 import 에 `createSessionState` 를 추가하고, `describe` 안에 붙인다.

```ts
  it("stops injecting once the session is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const file = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "<article>Card</article>", "utf8");
    const session = createSessionState();
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token",
      session
    });
    const load = plugin.load;
    if (typeof load !== "function") {
      throw new Error("Expected a callable load hook");
    }

    session.disable();

    expect(await load.call({ addWatchFile() {} } as never, file)).toBeNull();
  });

  it("answers registration with 410 once the session is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const session = createSessionState();
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token",
      session
    });
    const configureServer = plugin.configureServer;
    if (typeof configureServer !== "function") {
      throw new Error("Expected a callable configureServer hook");
    }
    const routes = new Map<string, (request: unknown, response: unknown, next: () => void) => void>();

    configureServer.call({} as never, {
      middlewares: {
        use(route: string, handler: (request: unknown, response: unknown, next: () => void) => void) {
          routes.set(route, handler);
        }
      },
      watcher: { on() {}, off() {} },
      httpServer: null,
      config: { logger: { error() {} } }
    } as never);

    session.disable();

    const register = routes.get(LOCATOR_ENDPOINT);
    if (!register) {
      throw new Error("Registration middleware was not mounted");
    }
    let statusCode = 0;
    let body = "";
    register(
      { method: "POST", headers: {} },
      {
        setHeader() {},
        set statusCode(value: number) {
          statusCode = value;
        },
        get statusCode() {
          return statusCode;
        },
        end(chunk?: string) {
          body = chunk ?? "";
        }
      },
      () => {
        throw new Error("Disabled registration must not fall through");
      }
    );

    expect(statusCode).toBe(410);
    expect(JSON.parse(body).error).toBe("Locator is closed for this dev server");
  });

  it("detaches the unlink watcher once the session is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const session = createSessionState();
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token",
      session
    });
    const configureServer = plugin.configureServer;
    if (typeof configureServer !== "function") {
      throw new Error("Expected a callable configureServer hook");
    }
    const detached: string[] = [];

    configureServer.call({} as never, {
      middlewares: { use() {} },
      watcher: {
        on() {},
        off(event: string) {
          detached.push(event);
        }
      },
      httpServer: null,
      config: { logger: { error() {} } },
      environments: {}
    } as never);

    session.disable();

    expect(detached).toContain("unlink");
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/unit/vite-plugin.test.ts`
Expected: FAIL 3건 — 주입이 계속 되고(`toBeNull` 실패), 410 대신 미들웨어가 통과하고, `off` 가 안 불린다.

- [ ] **Step 3: `load()` 에 게이트를 단다**

`src/integration/vite-plugin.ts` 의 `load` 첫 줄에 추가한다.

```ts
    async load(id) {
      // Quit 이후에는 원본을 그대로 서빙한다.
      if (session.isDisabled()) {
        return null;
      }
      // `?raw`, `?url` and friends still end in a source extension but must be
      // served verbatim.
      if (id.includes("?")) {
        return null;
      }
```

- [ ] **Step 4: `/register` 에 410 게이트를 단다**

`configureServer` 의 첫 미들웨어를 교체한다.

```ts
      server.middlewares.use(LOCATOR_ENDPOINT, (request, response, next) => {
        if (session.isDisabled()) {
          response.statusCode = 410;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          response.end(
            JSON.stringify({ error: "Locator is closed for this dev server" })
          );
          return;
        }
        void ready
          .then(() => registrationHandler(request, response, next))
          .catch(next);
      });
```

- [ ] **Step 5: 무효화 헬퍼를 추가한다**

Task 1 이 `silent` 로 끝났으면 이 스텝은 건너뛰고 Step 6 의 `invalidateInjectedModules(server)` 호출도 빼라. 파일 상단 헬퍼 옆(`isSourceFile` 아래)에 둔다.

```ts
/**
 * Quit 시점에 이미 변환돼 캐시된 모듈을 그래프에서 떨어뜨린다. HMR 업데이트는
 * 보내지 않는다 — 버튼 하나 눌렀다고 열려 있는 탭이 full reload 되면 폼 입력과
 * 스크롤이 날아간다. 현재 탭은 그대로 두고 다음 요청부터 깨끗해진다.
 * Vite 8 은 모듈 그래프가 환경별로 갈라져 있어 둘 다 훑는다.
 */
function invalidateInjectedModules(
  server: ViteDevServer,
  isInjectedFile: (file: string) => boolean
): void {
  const graphs = (
    server.environments
      ? Object.values(server.environments).map(
          (environment) => environment.moduleGraph
        )
      : [server.moduleGraph]
  ).filter(Boolean);
  for (const graph of graphs) {
    for (const module of graph.idToModuleMap.values()) {
      if (module.file && isInjectedFile(module.file)) {
        graph.invalidateModule(module);
      }
    }
  }
}
```

`vite` import 에 타입을 추가한다: `import { searchForWorkspaceRoot, type Plugin, type ViteDevServer } from "vite";`

- [ ] **Step 6: disable 리스너를 배선한다**

`configureServer` 안, `server.watcher.on("unlink", removeUnlinkedFile);` 바로 아래에 넣는다.

```ts
      const isInjectedFile = (file: string) => {
        if (!isSourceFile(file)) {
          return false;
        }
        const absoluteFile = path.resolve(file);
        return [configuredRoot, root].some((base) => {
          const relative = path.relative(base, absoluteFile);
          return (
            relative !== "" &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
          );
        });
      };

      session.onDisable(() => {
        server.watcher.off("unlink", removeUnlinkedFile);
        invalidateInjectedModules(server, isInjectedFile);
      });
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npx vitest run tests/unit/vite-plugin.test.ts`
Expected: PASS (기존 7건 + 신규 3건)

- [ ] **Step 8: 커밋한다**

```bash
git add src/integration/vite-plugin.ts tests/unit/vite-plugin.test.ts
git commit -m "feat: stop server-side instrumentation when the locator quits"
```

---

### Task 4: Hide 아이콘과 클라이언트 동작

**Files:**
- Create: `src/client/hide-mark.ts`
- Modify: `src/client/settings-panel.ts` (푸터 CSS `:206`, 마크업 `:648`, 옵션 `:37`, 배선 `:1147`)
- Modify: `src/client/index.ts` (`createSettingsPanel` 호출부 `:351`)
- Modify: `tests/e2e/locator.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `export const HIDE_MARK_SVG: string`
  - `SettingsPanelOptions` 에 `onHide(): void` 추가 (필수)
  - 푸터 DOM: `[data-ui-hide]` 버튼이 `[data-ui-quit]` 왼쪽에 온다

- [ ] **Step 1: 실패하는 e2e 테스트를 쓴다**

`tests/e2e/locator.spec.ts` 의 `Quit Extension closes the locator...` 테스트 바로 뒤에 넣는다.

```ts
test("Hide removes the button for this page but keeps the locator working", async ({
  page
}) => {
  await mockSettingsEndpoint(page);
  await mockSessionEndpoint(page);
  await page.goto("/");

  const launcher = page.locator("[data-astro-ai-locator-launcher]");
  await expect(launcher).toBeVisible();
  await launcher.click();
  await page.locator("[data-ui-hide]").click();

  await expect(page.locator("[data-astro-ai-locator-toast]")).toContainText(
    "Reload the page to bring it back"
  );
  await expect(launcher).toHaveCount(0);
  await expect(page.locator("[data-astro-ai-locator-popover]")).toHaveCount(0);

  // 버튼만 사라졌을 뿐 선택 기능은 그대로다.
  await page.getByTestId("card-alpha").hover();
  await page.keyboard.down("Alt");
  await expect(page.locator("[data-astro-ai-locator-overlay]")).toBeVisible();
  await expect(
    page.locator("[data-astro-ai-locator-overlay] .label")
  ).toHaveText(/^<article>│Card\.astro│\d+:\d+$/u);
  await page.keyboard.up("Alt");

  // 새로고침이 유일한 복구 경로다.
  await page.reload();
  await expect(page.locator("[data-astro-ai-locator-launcher]")).toBeVisible();
});
```

`the floating launcher exposes the settings hierarchy` 테스트의 푸터 단언도 함께 고친다. 현재 `.footer .footer-button` 이 두 개라고 단언하는 곳(`Quit Extension`, `Copy MCP Prompt`)에 아이콘이 하나 늘어난다.

```ts
  await expect(page.locator(".footer .footer-button")).toHaveText([
    "",
    "Quit Extension",
    "Copy MCP Prompt"
  ]);
  await expect(page.locator("[data-ui-hide]")).toHaveAttribute(
    "aria-label",
    "Hide the button until reload"
  );
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx playwright test -g "Hide removes the button"`
Expected: FAIL — `[data-ui-hide]` 를 못 찾는다.

- [ ] **Step 3: 아이콘 모듈을 만든다**

```ts
// src/client/hide-mark.ts
/** 눈에 사선이 그어진 eye-off 아이콘. 24×24 뷰박스에 맞춰 그렸다. */
export const HIDE_MARK_SVG: string =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2.1 3.5 3.5 2.1l18.4 18.4-1.4 1.4-3.3-3.3A11 11 0 0 1 12 20C6.5 20 2.7 15.6 1.3 12.8a1.8 1.8 0 0 1 0-1.6A15 15 0 0 1 5 6.8L2.1 3.5Zm6.4 6.4a4 4 0 0 0 5.6 5.6l-1.5-1.5a2 2 0 0 1-2.6-2.6L8.5 9.9ZM12 4c5.5 0 9.3 4.4 10.7 7.2a1.8 1.8 0 0 1 0 1.6 15.6 15.6 0 0 1-2.6 3.6l-3-3A4 4 0 0 0 11.6 8L9.4 5.8C10.2 4.6 11.1 4 12 4Z"/></svg>';
```

- [ ] **Step 4: 푸터에 버튼을 넣는다**

`src/client/settings-panel.ts` 상단에 import 를 추가한다.

```ts
import { HIDE_MARK_SVG } from "./hide-mark.js";
```

CSS `.footer` 를 바꾸고 아이콘 규칙을 바로 뒤에 붙인다.

```css
      .footer {
        display: grid;
        grid-template-columns: 28px 1fr 1fr;
        gap: 6px;
        padding: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.14);
      }
      .footer-icon {
        display: grid;
        padding: 0;
        place-items: center;
      }
      .footer-icon svg {
        width: 14px;
        height: 14px;
        fill: #f4f4f5;
      }
```

마크업의 `<div class="footer">` 안 첫 자식으로 넣는다.

```html
      <div class="footer">
        <button
          class="footer-button footer-icon"
          type="button"
          data-ui-hide
          aria-label="Hide the button until reload"
          title="Hide the button until reload"
        >${HIDE_MARK_SVG}</button>
        <button class="footer-button" type="button" data-ui-quit>
          Quit Extension
        </button>
        <button class="footer-button" type="button" data-ui-copy-mcp>
          Copy MCP Prompt
        </button>
      </div>
```

- [ ] **Step 5: 옵션과 클릭 배선을 추가한다**

`SettingsPanelOptions` 에 콜백을 추가한다.

```ts
interface SettingsPanelOptions {
  settings: LocatorSettings;
  onSettingsChange(
    settings: LocatorSettings
  ): Promise<LocatorSettings | null>;
  onCopyMcpPrompt(): Promise<boolean>;
  onQuit(): Promise<void>;
  onHide(): void;
}
```

버튼 조회부(`const quitButton = ...` 근처)와 클릭 핸들러를 바꾼다.

```ts
  const quitButton = shadow.querySelector<HTMLButtonElement>("[data-ui-quit]");
  const hideButton = shadow.querySelector<HTMLButtonElement>("[data-ui-hide]");
  if (!copyMcpButton || !quitButton || !hideButton) {
    throw new Error("Locator settings panel could not initialize");
  }
```

```ts
  hideButton.addEventListener("click", () => {
    setOpen(false);
    options.onHide();
  });
```

- [ ] **Step 6: 클라이언트가 패널만 없애게 한다**

`src/client/index.ts` 의 `quitExtension` 정의 아래에 추가한다.

```ts
  /**
   * Hide 는 서버에 아무것도 보내지 않는다. 이 문서의 패널 호스트만 제거하고
   * 리스너와 오버레이는 그대로 두므로 트리거 키 선택은 계속 동작한다.
   * 복구 경로는 새로고침뿐이다.
   */
  const hideLauncher = () => {
    settingsPanel.destroy();
    overlay.toast("Button hidden. Reload the page to bring it back.");
  };
```

`createSettingsPanel` 호출에 콜백을 넘긴다.

```ts
  settingsPanel = createSettingsPanel({
    settings: currentSettings,
    onCopyMcpPrompt: copyMcpPrompt,
    onQuit: quitExtension,
    onHide: hideLauncher,
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npm run build && npx playwright test -g "Hide removes the button"`
Expected: PASS

- [ ] **Step 8: 푸터를 건드린 기존 e2e 도 함께 돌린다**

Run: `npx playwright test -g "floating launcher"`
Expected: PASS. 실패하면 Step 1 에서 고친 단언과 실제 DOM 순서를 맞춘다.

- [ ] **Step 9: 커밋한다**

```bash
git add src/client/hide-mark.ts src/client/settings-panel.ts src/client/index.ts tests/e2e/locator.spec.ts
git commit -m "feat: add a hide button that clears the launcher until reload"
```

---

### Task 5: Quit 이후 서버 HTML 통합 테스트

기존 e2e 는 픽스처 dev 서버 하나를 모든 테스트가 공유하므로 진짜 Quit 을 보낼 수 없다. 이 검증만 전용 서버를 띄운다.

**Files:**
- Create: `tests/integration/quit-stops-instrumentation.test.ts`
- Modify: `package.json` (`test:integration` 스크립트에 새 파일 추가)

**Interfaces:**
- Consumes: Task 3 의 `load()` 게이트와 무효화
- Produces: 없음 (검증 전용)

- [ ] **Step 1: 테스트를 쓴다**

세션 토큰은 dev 서버가 페이지에 심는 클라이언트 옵션 안에 들어 있다. HTML 에서 뽑아 쓴다.

```ts
// tests/integration/quit-stops-instrumentation.test.ts
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const PORT = 45174;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) {
        return;
      }
    } catch {
      // 아직 리스닝 전이다.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Fixture dev server did not start");
}

describe("quit stops server-side instrumentation", () => {
  it("serves clean HTML after the session is quit", async () => {
    const server = spawn(
      "npx",
      [
        "astro",
        "dev",
        "--root",
        "tests/fixtures/basic",
        "--host",
        "127.0.0.1",
        "--port",
        String(PORT)
      ],
      { env: { ...process.env, ASTRO_DEV_BACKGROUND: "0" }, stdio: "ignore" }
    );

    try {
      await waitForServer();

      const before = await (await fetch(BASE_URL)).text();
      expect(before).toContain("data-astro-ai-locator-file");

      const token = /sessionToken":"([^"]+)"/u.exec(before)?.[1];
      expect(token).toBeTruthy();

      const quit = await fetch(`${BASE_URL}/@astro-inspector/session`, {
        method: "POST",
        headers: { "x-astro-ai-locator-token": token ?? "" }
      });
      expect(quit.status).toBe(200);
      expect(((await quit.json()) as { disabled: boolean }).disabled).toBe(true);

      const after = await (await fetch(BASE_URL)).text();
      expect(after).not.toContain("data-astro-ai-locator-file");

      const register = await fetch(`${BASE_URL}/@astro-inspector/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-astro-ai-locator-token": token ?? ""
        },
        body: JSON.stringify({
          sourceFile: "src/components/Card.astro",
          line: 5,
          column: 1,
          sourceTag: "article",
          domTag: "article"
        })
      });
      expect(register.status).toBe(410);

      // 설정 엔드포인트는 살려 둔다. 닫으면 클라이언트가 부팅할 때마다 경고를 찍는다.
      const settings = await fetch(`${BASE_URL}/@astro-inspector/settings`, {
        headers: { "x-astro-ai-locator-token": token ?? "" }
      });
      expect(settings.status).toBe(200);
    } finally {
      server.kill("SIGTERM");
    }
  }, 120_000);
});
```

Task 1 이 `silent` 로 끝났다면 `after` 단언은 이미 캐시된 `/` 를 다시 받으므로 실패한다. 그 경우 픽스처에 `tests/fixtures/basic/src/pages/quit-probe.astro` 를 만들고(내용은 `<html><body><p>probe</p></body></html>`) `after` 를 `fetch(`${BASE_URL}/quit-probe`)` 로 바꾼다. 이 페이지는 Quit 전에 한 번도 로드되지 않았으므로 캐시가 없다.

- [ ] **Step 2: 실행한다**

Run: `npm run build && npx vitest run tests/integration/quit-stops-instrumentation.test.ts`
Expected: PASS. dev 서버 기동에 시간이 걸리므로 첫 실행은 1분 가까이 걸릴 수 있다.

- [ ] **Step 3: verify 파이프라인에 넣는다**

`package.json` 의 `test:integration` 을 파일 지정 대신 디렉터리 지정으로 바꾼다. `production-output` 은 dist 빌드가 필요하므로 그대로 두고, 새 파일만 추가한다.

```json
    "test:integration": "npm run build && vitest run tests/integration/mcp-stdio.test.ts tests/integration/quit-stops-instrumentation.test.ts",
```

- [ ] **Step 4: 커밋한다**

```bash
git add tests/integration/quit-stops-instrumentation.test.ts package.json
git commit -m "test: verify quit stops injection and closes registration"
```

---

### Task 6: 문서 갱신

**Files:**
- Modify: `README.md` (`### The popover footer`, `### Closing the locator`, `## Scope` 의 dev-only 항목)
- Modify: `docs/FUTURE_WORK.md` (§7)

**Interfaces:**
- Consumes: Task 3·4 의 최종 동작
- Produces: 없음

- [ ] **Step 1: 푸터 표에 Hide 를 넣는다**

`### The popover footer` 의 표를 교체한다.

```markdown
Three controls sit below the preference rows.

| Button | What it does |
| --- | --- |
| eye-off icon | Hides the fox button for this page only — see [Closing the locator](#closing-the-locator) |
| `Quit Extension` | Closes the locator for this dev server |
| `Copy MCP Prompt` | Copies a setup message for your AI agent — see [MCP setup](#mcp-setup) |
```

- [ ] **Step 2: 종료 절을 두 갈래로 다시 쓴다**

`### Closing the locator` 본문을 교체한다.

```markdown
There are two ways out, and they differ in how far they reach.

**Hide** — the eye-off icon removes the fox button and its popover from the current page. Nothing else changes: hold the trigger key and selection still works. Nothing is sent to the dev server and nothing is stored, so a reload brings the button back.

**Quit Extension** — removes every listener, the overlay, and the fox button, then confirms with a short toast. The dev server records the choice in memory for the rest of the process, so **reloading the page does not bring the locator back**, and from that point it also stops instrumenting source files: `.astro`, `.tsx`, and `.jsx` are served as written, the registration endpoint answers `410`, and the file watcher hook is detached. Already-compiled modules are dropped from the module graph without pushing an HMR update, so the tab you are looking at keeps its state and the next navigation is clean.

One thing survives: the small client script tag. Astro injects it when the dev server starts and there is no way to withdraw it mid-run, so each page still fetches the client asset and asks the session endpoint once, then shuts itself down. A fully zero-load dev server needs a restart, which is also the only way to bring the locator back. Nothing is written to disk — the choice never outlives the process that received it. Other tabs already open keep working until they reload.
```

- [ ] **Step 3: FUTURE_WORK §7 의 미완 문단을 갱신한다**

`source instrumentation을 건너뛰는 진짜 zero-overhead 모드는 여전히 미구현이다.` 로 시작하는 문단을 교체한다.

```markdown
2026-08-05: Quit이 source instrumentation까지 멈추도록 확장했다(0.6.0). `load()` 주입 skip,
`/register` 410, watcher 해제, 모듈 그래프 무효화까지 간다. 남은 잔여 부하는 head-inline
스크립트 태그 하나뿐이며, 이것은 integration이 기동 시 심는 것이라 dev 실행 중 회수할 수 없다.
완전한 zero-load는 여전히 재시작이 필요하다. 아래 Pause/Disable 2단계 모델은 폐기한다 —
Hide(이 탭만)와 Quit(서버까지)의 두 갈래로 대체됐다.
```

- [ ] **Step 4: 전체 검증을 돌린다**

Run: `npm run verify`
Expected: 전부 PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add README.md docs/FUTURE_WORK.md
git commit -m "docs: describe hide and the widened quit"
```

---

## 검증 요약

| 명령 | 무엇을 지키나 |
| --- | --- |
| `npx vitest run tests/unit` | 세션 상태, 핸들러 계약, `load()` 게이트, 410, watcher 해제 |
| `npx playwright test` | Hide 가 버튼만 없애고 기능은 남기며 새로고침으로 복귀한다 |
| `npx vitest run tests/integration` | 진짜 Quit 이후 서버가 깨끗한 HTML 을 준다 |
| `npm run verify` | 위 전부 + 타입체크 + 빌드 |
