# astro-inspector 0.2.0 실사용 버그 3건 수정 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대형 Astro 앱에 0.2.0 을 붙였을 때 나온 세 가지 실패를 없앤다. 남의 페이지 스크립트가 죽어도 로케이터는 살고, 프록시 뒤에서도 엔드포인트가 닿고, React 아일랜드에 하이드레이션 mismatch 를 만들지 않는다.

**Architecture:** 세 건 모두 "소비 레포 설정을 요구하지 않는다"는 한 방향으로 고친다. 클라이언트는 자기 URL 에서 자기가 서빙하고, HTTP 경로는 Vite 예약 접두사 `/@` 아래로 옮기고, JSX 위치 주입은 `transform` 이 아니라 `load` 에서 원본 파일 기준으로 한 번만 계산한다. 마지막 항목이 핵심이다. `load` 결과는 SSR·client 양쪽에 같은 문자열로 나가므로 좌표가 구조적으로 일치하고, 소스맵 재매핑과 등장 순서 인덱스라는 두 추측 경로를 통째로 삭제할 수 있다.

**Tech Stack:** TypeScript 6, Astro 6.2–7.x, Vite 7–8, `@babel/parser`, `magic-string`, Vitest 4, Playwright 1.61.

## Global Constraints

- Node.js `>=22.12.0`. peer 는 `astro >=6.2.2 <8.0.0`, `vite >=7.3.2 <9.0.0`.
- dev 전용. 프로덕션 빌드에는 클라이언트·엔드포인트·소스 메타데이터가 남지 않아야 한다.
- **프로토콜 호환 유지**: `data-astro-ai-locator-*` 속성 이름, `astro_hash_` 접두사, `.astro-ai-locator/manifest.json` 경로, manifest schema v1, 전역 설정 schema v5 는 바꾸지 않는다.
- HTTP 엔드포인트 경로만 바뀐다. 클라이언트와 서버가 같은 버전으로 함께 배포되므로 마이그레이션은 필요 없다.
- 모든 dev 엔드포인트는 `x-astro-ai-locator-token` 검사를 유지한다. 단 클라이언트 에셋은 `<script src>` 로 받으므로 토큰을 붙일 수 없다 — Task 2 에서 별도로 다룬다.
- 각 Task 끝에서 `npm run verify` 가 통과해야 한다. 현재 기준선: unit 106, MCP integration 1, E2E 35, production output 1.

---

## File Structure

| 파일 | 책임 | Task |
| --- | --- | --- |
| `src/shared/contracts.ts` | 엔드포인트 상수 3개 + 클라이언트 에셋 경로 상수 | 1, 2 |
| `src/integration/client-asset-handler.ts` | **신규.** `dist/client/**`·`dist/shared/**` 만 HTTP 로 서빙 | 2 |
| `src/integration/index.ts` | `injectScript("page")` → `head-inline` 한 줄 | 2 |
| `src/integration/vite-plugin.ts` | 에셋 미들웨어 등록, JSX 주입을 `transform` → `load` 이관 | 2, 3 |
| `src/integration/inject-jsx-source-metadata.ts` | `mapPosition`·`originalSource` 파라미터와 등장 순서 폴백 제거 | 3 |
| `tests/fixtures/basic/ssr-shift-plugin.mjs` | **신규.** SSR 파이프라인에서만 코드를 밀어 좌표 불일치를 재현하는 pre 플러그인 | 3 |

---

## Task 1: 엔드포인트 접두사를 `/@astro-inspector/*` 로 옮긴다

프록시가 Vite 로 보낼 경로를 `/@`·`/node_modules/`·`/src/` 접두사로 판별하는 것이 흔한 관례다. `/_astro-ai-locator/` 는 어디에도 안 걸려 기본 origin 으로 떨어지고 404 가 난다. `/@` 로 옮기면 소비 레포 설정이 0 줄이 된다.

**Files:**
- Modify: `src/shared/contracts.ts:1-3`
- Modify: `tests/unit/vite-plugin.test.ts` (마운트 경로 단언)
- Modify: `tests/e2e/locator.spec.ts:39,76,809` (`page.route` 글롭)
- Modify: `README.md` (Security 절의 경로 언급)

**Interfaces:**
- Consumes: 없음
- Produces: `LOCATOR_ENDPOINT = "/@astro-inspector/register"`, `LOCATOR_SETTINGS_ENDPOINT = "/@astro-inspector/settings"`, `LOCATOR_SESSION_ENDPOINT = "/@astro-inspector/session"`. Task 2 가 같은 `/@astro-inspector/` 네임스페이스 아래 `client/` 하위 경로를 추가한다.

- [ ] **Step 1: 실패하는 단언으로 바꾼다**

`tests/unit/vite-plugin.test.ts` 의 마운트 경로 단언을 새 값으로 먼저 고친다. 상수를 import 해 쓰고 있으므로, 리터럴을 직접 적어 상수가 실제로 바뀌었는지 검사한다.

```ts
    expect(mountedPaths).toEqual([
      "/@astro-inspector/register",
      "/@astro-inspector/settings",
      "/@astro-inspector/session"
    ]);
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/vite-plugin.test.ts`
Expected: FAIL — 받은 값이 `/_astro-ai-locator/...` 세 개.

- [ ] **Step 3: 상수 3개를 바꾼다**

`src/shared/contracts.ts` 맨 위 세 줄:

```ts
export const LOCATOR_ENDPOINT = "/@astro-inspector/register";
export const LOCATOR_SETTINGS_ENDPOINT = "/@astro-inspector/settings";
export const LOCATOR_SESSION_ENDPOINT = "/@astro-inspector/session";
```

`MANIFEST_DIRECTORY`, `HASH_PREFIX`, `SOURCE_*_ATTRIBUTE` 는 **건드리지 않는다.** 프로토콜 호환 대상이다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit`
Expected: PASS, 106 tests.

- [ ] **Step 5: E2E 목킹 글롭을 고친다**

`tests/e2e/locator.spec.ts` 세 군데:

```ts
  await page.route("**/@astro-inspector/settings", async (route) => {
  await page.route("**/@astro-inspector/session", async (route) => {
  await page.route("**/@astro-inspector/register", async (route) => {
```

- [ ] **Step 6: E2E 통과 확인**

Run: `npm run build && npx playwright test`
Expected: PASS, 35 passed.

- [ ] **Step 7: README 갱신**

`## Security` 절의 첫 문장에서 "session endpoint" 를 설명하는 문장 뒤에 한 줄을 더한다.

```markdown
Dev endpoints live under `/@astro-inspector/`. The `/@` prefix is what Vite reserves for its own internal requests, so proxies that already forward Vite traffic by path reach them without extra configuration.
```

- [ ] **Step 8: 커밋**

```bash
git add src/shared/contracts.ts tests/unit/vite-plugin.test.ts tests/e2e/locator.spec.ts README.md
git commit -m "fix: move dev endpoints under the /@ prefix so proxies reach them"
```

---

## Task 2: 클라이언트를 자기 URL 에서 직접 서빙한다

`injectScript("page", ...)` 는 페이지의 공용 스크립트 모듈 하나에 합쳐진다. 같은 모듈에 실린 남의 import 가 하나라도 404 면 ES 모듈 전체가 평가되지 않아 `installLocator()` 가 호출조차 안 된다. 실패 도메인을 분리한다.

**Files:**
- Create: `src/integration/client-asset-handler.ts`
- Create: `tests/unit/client-asset-handler.test.ts`
- Modify: `src/shared/contracts.ts` (에셋 경로 상수)
- Modify: `src/integration/index.ts:32-56`
- Modify: `src/integration/vite-plugin.ts` (미들웨어 등록)
- Modify: `tests/unit/vite-plugin.test.ts` (마운트 경로 4개로)
- Modify: `README.md` (How it works 1번 항목)

**Interfaces:**
- Consumes: Task 1 의 `/@astro-inspector/` 네임스페이스.
- Produces: `LOCATOR_ASSET_ENDPOINT = "/@astro-inspector"`, `createClientAssetHandler({ distDirectory }): (req, res, next) => Promise<void>`.

**마운트 지점이 네임스페이스 루트여야 하는 이유.** `dist/client/index.js` 는 `../shared/contracts.js` 를 import 한다. 브라우저는 URL 의 `..` 를 **요청을 보내기 전에 정규화**하므로, 이 import 는 `/@astro-inspector/shared/contracts.js` 로 나간다. 마운트를 `/@astro-inspector/client` 로 잡으면 이 요청이 마운트 밖이라 404 가 난다. 그래서 `/@astro-inspector` 에 걸고 `client/` 와 `shared/` 를 모두 처리한다. 앞서 등록된 `register`·`settings`·`session` 마운트가 먼저 매칭되므로 충돌하지 않는다 — connect 는 등록 순서대로 시도한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `tests/unit/client-asset-handler.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createClientAssetHandler } from "../../src/integration/client-asset-handler.js";

async function createDist() {
  const dist = await mkdtemp(path.join(os.tmpdir(), "astro-inspector-dist-"));
  await mkdir(path.join(dist, "client"), { recursive: true });
  await mkdir(path.join(dist, "shared"), { recursive: true });
  await mkdir(path.join(dist, "mcp"), { recursive: true });
  await writeFile(path.join(dist, "client", "index.js"), "export const a = 1;\n");
  await writeFile(path.join(dist, "shared", "contracts.js"), "export const b = 2;\n");
  await writeFile(path.join(dist, "mcp", "cli.js"), "export const secret = 3;\n");
  return dist;
}

function createExchange(url: string) {
  const request = { method: "GET", url } as unknown as IncomingMessage;
  const headers: Record<string, string> = {};
  let body = "";
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(chunk?: string) {
      body = chunk ?? "";
    }
  } as unknown as ServerResponse;
  let nextCalled = false;
  return {
    request,
    response,
    headers,
    next: () => {
      nextCalled = true;
    },
    body: () => body,
    status: () => response.statusCode,
    nextCalled: () => nextCalled
  };
}

describe("createClientAssetHandler", () => {
  it("serves a client module as JavaScript", async () => {
    const handler = createClientAssetHandler({ distDirectory: await createDist() });
    const exchange = createExchange("/client/index.js");

    await handler(exchange.request, exchange.response, exchange.next);

    expect(exchange.status()).toBe(200);
    expect(exchange.headers["content-type"]).toBe(
      "text/javascript; charset=utf-8"
    );
    expect(exchange.body()).toContain("export const a = 1;");
  });

  it("serves the shared modules the client imports", async () => {
    // 브라우저가 `../shared/contracts.js` 를 정규화해 보내는 바로 그 경로다.
    const handler = createClientAssetHandler({ distDirectory: await createDist() });
    const exchange = createExchange("/shared/contracts.js");

    await handler(exchange.request, exchange.response, exchange.next);

    expect(exchange.status()).toBe(200);
    expect(exchange.body()).toContain("export const b = 2;");
  });

  it("refuses directories outside the client and shared trees", async () => {
    const handler = createClientAssetHandler({ distDirectory: await createDist() });
    const exchange = createExchange("/mcp/cli.js");

    await handler(exchange.request, exchange.response, exchange.next);

    expect(exchange.status()).toBe(404);
    expect(exchange.body()).not.toContain("secret");
  });

  it("refuses traversal outside the package", async () => {
    const handler = createClientAssetHandler({ distDirectory: await createDist() });
    const exchange = createExchange("/client/../../../../etc/passwd");

    await handler(exchange.request, exchange.response, exchange.next);

    expect(exchange.status()).toBe(404);
  });

  it("passes non-GET requests to the next middleware", async () => {
    const handler = createClientAssetHandler({ distDirectory: await createDist() });
    const exchange = createExchange("/client/index.js");
    (exchange.request as { method: string }).method = "POST";

    await handler(exchange.request, exchange.response, exchange.next);

    expect(exchange.nextCalled()).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/client-asset-handler.test.ts`
Expected: FAIL — `Cannot find module '.../client-asset-handler.js'`.

- [ ] **Step 3: 핸들러를 구현한다**

Create `src/integration/client-asset-handler.ts`:

```ts
import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

type Next = (error?: unknown) => void;

interface ClientAssetHandlerOptions {
  distDirectory: string;
}

/**
 * Only the browser-facing trees are reachable. `client/` imports `shared/` with
 * relative specifiers, so both have to be served, and nothing else does.
 */
const SERVABLE_DIRECTORIES = ["client", "shared"];

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export function createClientAssetHandler(
  options: ClientAssetHandlerOptions
) {
  return async function clientAssetHandler(
    request: IncomingMessage,
    response: ServerResponse,
    next: Next
  ): Promise<void> {
    if (request.method !== "GET") {
      next();
      return;
    }

    try {
      const distRoot = await realpath(path.resolve(options.distDirectory));
      const requested = (request.url ?? "/").split("?", 1)[0] ?? "/";
      const candidate = path.resolve(
        path.join(distRoot, decodeURIComponent(requested))
      );
      const canonical = await realpath(candidate);
      const relative = path.relative(distRoot, canonical);
      const topLevel = relative.split(path.sep)[0] ?? "";
      if (
        !isInside(distRoot, canonical) ||
        !SERVABLE_DIRECTORIES.includes(topLevel) ||
        path.extname(canonical) !== ".js" ||
        !(await stat(canonical)).isFile()
      ) {
        throw new Error("Not a servable locator asset");
      }
      response.statusCode = 200;
      response.setHeader("content-type", "text/javascript; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.end(await readFile(canonical, "utf8"));
    } catch {
      response.statusCode = 404;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end("Not found");
    }
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit/client-asset-handler.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: 에셋 경로 상수를 더한다**

`src/shared/contracts.ts`, 세션 상수 바로 아래:

```ts
export const LOCATOR_ASSET_ENDPOINT = "/@astro-inspector";
```

- [ ] **Step 6: 미들웨어를 등록한다**

`src/integration/vite-plugin.ts` 상단 import 에 더한다.

```ts
import { fileURLToPath } from "node:url";
import { createClientAssetHandler } from "./client-asset-handler.js";
```

`LOCATOR_ASSET_ENDPOINT` 를 contracts import 목록에 더한다. 그리고 `sessionHandler` 선언 아래에:

```ts
  // dist/integration/vite-plugin.js 기준 한 단계 위가 dist 루트다.
  const distDirectory = fileURLToPath(new URL("..", import.meta.url));
  const clientAssetHandler = createClientAssetHandler({ distDirectory });
```

`configureServer` 안, **세션 미들웨어 다음에** 등록한다. 순서가 중요하다 — 이 마운트가 더 넓으므로 먼저 등록하면 세 엔드포인트를 가로챈다.

```ts
      server.middlewares.use(
        LOCATOR_ASSET_ENDPOINT,
        (request, response, next) => {
          void clientAssetHandler(request, response, next).catch(next);
        }
      );
```

- [ ] **Step 7: 마운트 경로 단언을 넷으로 늘린다**

`tests/unit/vite-plugin.test.ts`:

```ts
    expect(mountedPaths).toEqual([
      "/@astro-inspector/register",
      "/@astro-inspector/settings",
      "/@astro-inspector/session",
      "/@astro-inspector"
    ]);
```

- [ ] **Step 8: 주입 방식을 바꾼다**

`src/integration/index.ts` 의 `injectScript` 호출을 통째로 교체한다. `clientOptions` 는 그대로 두고 직렬화해 넘긴다.

```ts
        injectScript(
          "head-inline",
          [
            `import("${LOCATOR_ASSET_ENDPOINT}/client/index.js")`,
            `  .then(({ installLocator }) => installLocator(${JSON.stringify(clientOptions)}))`,
            `  .catch((error) => console.error("astro-inspector: client failed to load", error));`
          ].join("\n")
        );
```

두 가지가 이 형태를 강제한다.

**정적 `import` 를 쓸 수 없다.** Astro 는 `head-inline` 을 `type="module"` **없는 클래식 스크립트**로 렌더한다. 실측한 출력이다.

```html
<script>import { installLocator } from "/@astro-inspector/client/index.js";
```

클래식 스크립트에서 정적 `import` 는 SyntaxError 라 payload 가 통째로 실행되지 않는다. **동적 `import()`** 는 클래식 스크립트에서도 legal 하므로 이걸 쓴다. 격리 목표는 그대로다 — 자기 script 태그 안에서 자기 모듈을 URL 로 불러오므로, 남의 깨진 import 가 이걸 막지 못하고 반대도 마찬가지다.

**bare specifier 도 쓸 수 없다.** `head-inline` 은 Vite 가공을 타지 않으므로 절대 URL 경로여야 한다.

`.catch` 는 생략하지 않는다. 없으면 로드 실패가 진단 없는 unhandled rejection 으로 끝난다.

import 목록에 `LOCATOR_ASSET_ENDPOINT` 를 더한다.

- [ ] **Step 9: 실제 dev 서버에서 확인**

```bash
npm run build
npx astro dev --root tests/fixtures/basic --host 127.0.0.1 --port 45180 &
sleep 8
curl -s -o /dev/null -w "client=%{http_code}\n" http://127.0.0.1:45180/@astro-inspector/client/index.js
curl -s -o /dev/null -w "shared=%{http_code}\n" http://127.0.0.1:45180/@astro-inspector/shared/contracts.js
curl -s -o /dev/null -w "mcp=%{http_code}\n"    http://127.0.0.1:45180/@astro-inspector/mcp/cli.js
curl -s -o /dev/null -w "session=%{http_code}\n" http://127.0.0.1:45180/@astro-inspector/session
```

Expected: `client=200`, `shared=200`, `mcp=404`, `session=403`.

마지막 줄이 중요하다. `403` 이 나오면 넓은 에셋 마운트가 세션 엔드포인트를 가로채지 않았다는 뜻이다. `404` 가 나오면 등록 순서가 뒤집힌 것이다.

- [ ] **Step 10: 전체 verify**

Run: `npm run verify`
Expected: unit 111, MCP 1, E2E 35, production 1 모두 통과.

- [ ] **Step 11: README 갱신**

`## How it works` 의 1번 항목 앞에 0번을 끼운다.

```markdown
0. **Serve.** The integration serves its own browser client from `/@astro-inspector/client/` and injects a single `head-inline` script tag pointing at it. It never shares a module with other integrations' page scripts, so a failing import elsewhere on the page cannot stop the locator from installing.
```

- [ ] **Step 12: 커밋**

```bash
git add src/integration/client-asset-handler.ts tests/unit/client-asset-handler.test.ts \
  src/shared/contracts.ts src/integration/index.ts src/integration/vite-plugin.ts \
  tests/unit/vite-plugin.test.ts README.md
git commit -m "fix: serve the locator client from its own URL instead of the shared page script"
```

---

## Task 3: JSX 위치 주입을 `load` 로 옮겨 SSR/CSR 좌표를 일치시킨다

`transform` 은 앞선 플러그인이 이미 건드린 `code` 를 받는다. 그 코드는 SSR 파이프라인과 client 파이프라인에서 다를 수 있고, 원본 좌표를 되찾으려는 두 경로가 모두 같은 이름의 태그가 여럿이면 애매해진다. 소스맵 매핑은 [`inject-jsx-source-metadata.ts` 의 `pointsToSourceTag`](../../../src/integration/inject-jsx-source-metadata.ts) 가 "같은 이름 태그가 있기만 하면" 통과시켜 옆 `<div>` 에 착지해도 검증을 통과한다. 등장 순서 폴백은 변환 전후의 엘리먼트 개수와 순서가 같다고 전제한다.

`load` 는 원본 파일만 읽어 좌표를 굳힌다. 그 결과는 두 파이프라인에 같은 문자열로 나가고, 뒤따르는 플러그인이 코드를 어떻게 옮기든 이미 박힌 속성 값은 변하지 않는다. `.astro` 가 [`vite-plugin.ts` 의 `load`](../../../src/integration/vite-plugin.ts) 에서 이미 이 방식으로 동작하며 같은 버그를 내지 않는다.

**Files:**
- Create: `tests/fixtures/basic/ssr-shift-plugin.mjs`
- Modify: `tests/fixtures/basic/astro.config.mjs`
- Modify: `tests/e2e/locator.spec.ts` (SSR/CSR 속성 일치 단언)
- Modify: `src/integration/vite-plugin.ts` (`load` 로 이관, `transform` 훅 삭제)
- Modify: `src/integration/inject-jsx-source-metadata.ts` (파라미터 2개와 폴백 제거)
- Modify: `tests/unit/inject-jsx-source-metadata.test.ts` (시그니처 정리)

**Interfaces:**
- Consumes: Task 2 의 변경 없음. 독립적이다.
- Produces: `injectJsxSourceMetadata(source: string, file: string, root: string): { code: string; map: SourceMap } | null` — 파라미터가 셋으로 줄어든다. `SourcePosition` 과 `SourcePositionMapper` export 는 삭제된다.

- [ ] **Step 1: 재현용 pre 플러그인을 만든다**

Create `tests/fixtures/basic/ssr-shift-plugin.mjs`:

```js
/**
 * SSR 파이프라인에서만 `.tsx` 앞에 주석 줄을 끼워 넣는다. 실제 앱에서 lingui 매크로나
 * React Compiler 처럼 환경별로 다르게 도는 pre 플러그인이 만드는 상황을 최소로 재현한다.
 * 이 플러그인이 붙으면 SSR 이 보는 줄 번호가 client 보다 정확히 SHIFT_LINES 만큼 밀린다.
 */
const SHIFT_LINES = 3;

export function ssrShiftPlugin() {
  return {
    name: "fixture:ssr-shift",
    enforce: "pre",
    apply: "serve",
    transform(code, id, options) {
      const file = id.split("?", 1)[0] ?? "";
      if (!options?.ssr || !file.endsWith(".tsx")) {
        return null;
      }
      return {
        code: `${"// ssr-only shim\n".repeat(SHIFT_LINES)}${code}`,
        map: null
      };
    }
  };
}
```

- [ ] **Step 2: 픽스처에 플러그인을 붙인다**

`tests/fixtures/basic/astro.config.mjs` 를 통째로 교체한다.

```js
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { astroAiLocator } from "../../../dist/index.js";
import { ssrShiftPlugin } from "./ssr-shift-plugin.mjs";

export default defineConfig({
  integrations: [react(), astroAiLocator()],
  vite: {
    plugins: [ssrShiftPlugin()]
  }
});
```

- [ ] **Step 3: 실패하는 E2E 를 쓴다**

`tests/e2e/locator.spec.ts` 끝에 더한다. SSR 이 보낸 HTML 의 속성값과 하이드레이션 뒤 DOM 의 속성값을 직접 비교한다.

```ts
test("locator attributes survive hydration unchanged", async ({
  page,
  request
}) => {
  await mockSettingsEndpoint(page);
  await mockSessionEndpoint(page);

  // 1. SSR 이 내려보낸 원본 HTML 에서 값을 읽는다.
  const html = await (await request.get("/")).text();
  const ssrMatches = [
    ...html.matchAll(
      /data-astro-ai-locator-file="([^"]*ReactIsland\.tsx)"\s+data-astro-ai-locator-loc="(\d+:\d+)"/gu
    )
  ].map((match) => `${match[1]}@${match[2]}`);
  expect(ssrMatches.length).toBeGreaterThan(0);

  // 2. 하이드레이션이 끝난 뒤 DOM 에서 같은 값을 읽는다.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-astro-ai-locator-ready",
    ""
  );
  const clientMatches = await page.evaluate(() =>
    [...document.querySelectorAll("[data-astro-ai-locator-file]")]
      .map((element) => ({
        file: element.getAttribute("data-astro-ai-locator-file") ?? "",
        loc: element.getAttribute("data-astro-ai-locator-loc") ?? ""
      }))
      .filter((entry) => entry.file.endsWith("ReactIsland.tsx"))
      .map((entry) => `${entry.file}@${entry.loc}`)
  );

  expect(clientMatches).toEqual(ssrMatches);
});
```

- [ ] **Step 4: 실패 확인**

Run: `npm run build && npx playwright test -g "survive hydration"`
Expected: FAIL — `clientMatches` 의 줄 번호가 `ssrMatches` 보다 3 큰 값들이다. 이것이 재현이다. 실패 출력에 찍힌 두 배열을 기록해 둔다.

- [ ] **Step 5: 주입기에서 추측 경로를 걷어낸다**

`src/integration/inject-jsx-source-metadata.ts` 에서 다음을 **삭제**한다.

- `SourcePosition`, `SourcePositionMapper` 두 export 타입
- `pointsToSourceTag` 함수
- `originalPositionsByTag` 함수
- `injectJsxSourceMetadata` 의 `mapPosition`·`originalSource` 파라미터
- 본문의 `originalPositions`, `originalLines`, `occurrenceByTag`, `occurrence`, `mappedPosition`, `originalPosition` 지역 변수

시그니처와 루프 본문을 이렇게 만든다.

```ts
export function injectJsxSourceMetadata(
  source: string,
  file: string,
  root: string
): InjectionResult | null {
```

루프 안 좌표 계산은 한 줄로 줄어든다.

```ts
    const { line, column } = toLineColumn(lineStarts, opening.start);
```

`if (!originalPosition) { continue; }` 블록도 함께 삭제한다. `source` 가 곧 원본이므로 좌표가 없을 수 없다.

- [ ] **Step 6: 플러그인을 `load` 로 옮긴다**

`src/integration/vite-plugin.ts` 의 `load` 훅을 `.astro` 와 `.tsx`/`.jsx` 를 모두 처리하도록 바꾸고, `transform` 훅은 **통째로 삭제**한다.

```ts
    async load(id) {
      const file = id.split("?", 1)[0];
      if (!file || !isSourceFile(file)) {
        return null;
      }
      this.addWatchFile(file);
      const code = await readFile(file, "utf8").catch(() => undefined);
      if (code === undefined) {
        return null;
      }
      return path.extname(file).toLowerCase() === ".astro"
        ? injectAstroSourceMetadata(code, file, configuredRoot)
        : injectJsxSourceMetadata(code, file, configuredRoot);
    },
```

쿼리가 붙은 id(`?raw`, `?url`, `?worker`)는 `id.split("?", 1)[0]` 뒤에도 확장자가 남으므로 함께 걸린다. 이것들은 원본 텍스트를 그대로 원하므로 제외해야 한다. `load` 첫 줄에 가드를 더한다.

```ts
      if (id.includes("?")) {
        return null;
      }
```

이제 쓰이지 않는 import 를 지운다: `TraceMap`, `originalPositionFor`, `SourceMapInput`, `createSourcePositionMapper` 함수 전체, 그리고 `@jridgewell/trace-mapping` import 문.

- [ ] **Step 7: 재현 테스트가 통과하는지 확인**

Run: `npm run build && npx playwright test -g "survive hydration"`
Expected: PASS. SSR 과 client 의 배열이 정확히 같다.

- [ ] **Step 8: 단위 테스트 시그니처를 정리한다**

`tests/unit/inject-jsx-source-metadata.test.ts` 의 두 `it` 블록에서 `injectJsxSourceMetadata(...)` 호출에 넘기던 네 번째·다섯 번째 인자를 지운다. 인자는 `(source, file, root)` 셋만 남는다.

- [ ] **Step 9: 프롭 전개 우선순위를 못 박는다**

래퍼 컴포넌트가 받은 `data-*` 를 호스트 요소로 전개하면 정의부와 호출부 양쪽 속성이 한 요소에 실린다. 주입은 `output.appendLeft(opening.name.end, ...)` 로 **태그 이름 바로 뒤**, 즉 기존 속성보다 앞에 들어가므로 뒤따르는 `{...props}` 가 이긴다. 곧 **호출부가 이긴다.** 이 규칙을 테스트로 고정한다. `tests/e2e/locator.spec.ts` 의 기존 forwarded-button 테스트 근처에 더한다.

```ts
test("a forwarded component resolves to its call site, not its definition", async ({
  page
}) => {
  await mockSettingsEndpoint(page);
  await mockSessionEndpoint(page);
  await page.goto("/");

  const forwarded = page.getByTestId("forwarded-button");
  await expect(forwarded).toHaveAttribute(
    "data-astro-ai-locator-file",
    /index\.astro$/u
  );
  await expect(forwarded).toHaveAttribute(
    "data-astro-ai-locator-source-tag",
    "ForwardedButton"
  );
});
```

- [ ] **Step 10: 전체 verify**

Run: `npm run verify`
Expected: 전부 통과. E2E 는 37 이 된다.

- [ ] **Step 11: 커밋**

```bash
git add src/integration/vite-plugin.ts src/integration/inject-jsx-source-metadata.ts \
  tests/fixtures/basic/ssr-shift-plugin.mjs tests/fixtures/basic/astro.config.mjs \
  tests/unit/inject-jsx-source-metadata.test.ts tests/e2e/locator.spec.ts
git commit -m "fix: compute JSX source locations at load time so SSR and client agree"
```

---

## Task 4: 실사용 레포에서 세 건을 함께 검증하고 0.3.0 으로 낸다

픽스처는 세 버그를 모두 놓쳤다. 배포 전에 실제 소비 레포에서 눈으로 확인한다.

**Files:**
- Modify: `package.json` (version)
- Modify: `src/mcp/server.ts:20` (신고 버전)
- Modify: `docs/FUTURE_WORK.md` (미검토 항목 갱신)

**Interfaces:**
- Consumes: Task 1–3 전부.
- Produces: 없음.

- [ ] **Step 1: 소비 레포에 링크로 붙인다**

```bash
npm run build
cd <cashdoc-webview 워크트리>
pnpm --filter @cashdoc/astro add -D file:/Users/jungjun/Documents/work/astro-inspector
```

`file:` 은 심볼릭 링크로 걸리므로 `dist/` 는 항상 최신이다. 다만 **integration 은 `astro dev` 기동 시 한 번만 평가된다.** 아래 확인 전에 dev 서버를 반드시 재시작한다.

- [ ] **Step 2: 세 건을 각각 확인한다**

| 버그 | 확인 방법 | 통과 기준 |
| --- | --- | --- |
| 1 | 페이지에서 여우 버튼을 찾는다 | 다른 통합 스크립트가 404 여도 버튼이 뜬다 |
| 2 | 프록시 경유 주소로 접속해 요소를 클릭한다 | `Registration failed` 토스트 없이 해시가 복사된다 |
| 3 | 콘솔을 연 채 React 아일랜드가 있는 페이지를 새로고침한다 | `data-astro-ai-locator-*` 를 지목하는 하이드레이션 경고가 0건이다 |

- [ ] **Step 3: 버전을 올린다**

```bash
npm version minor --no-git-tag-version
```

`src/mcp/server.ts` 의 `version: "0.2.0"` 을 `"0.3.0"` 으로 바꾼다.

- [ ] **Step 4: FUTURE_WORK 의 미검토 항목을 갱신한다**

`## ⚠️ 현재 미검토·위험` 의 첫 항목을 실제 상태로 바꾼다.

```markdown
- 실사용 레포 수동 QA 를 2026-08-03 에 세 항목(클라이언트 격리, 프록시 경유 엔드포인트,
  하이드레이션 경고)으로 수행했다. 픽스처가 이 셋을 모두 놓쳤으므로, 앞으로 실사용
  경로에서만 재현되는 회귀는 픽스처에 합성 재현을 먼저 심는다.
```

- [ ] **Step 5: 최종 verify 와 배포**

```bash
npm run verify
npm publish
```

`prepublishOnly` 가 verify 를 다시 돌린다. npm 2FA 가 켜져 있으면 OTP 를 묻는다.

- [ ] **Step 6: 커밋과 태그**

```bash
git add package.json src/mcp/server.ts docs/FUTURE_WORK.md
git commit -m "chore: release 0.3.0"
git tag v0.3.0
git push && git push origin v0.3.0
```

---

## 남긴 것

- **Vue·Svelte 아일랜드.** 여전히 소스 추적 대상이 아니다.
- **`/@` 접두사를 못 넘기는 프록시.** 관례일 뿐 표준이 아니다. 그런 환경은 여전히 수동 설정이 필요하고, README 가 경로를 명시하므로 규칙 하나만 추가하면 된다.
- **`load` 선점의 부작용.** `.tsx` 를 다른 플러그인이 `load` 로 가로채야 하는 구성이라면 충돌한다. 현재 알려진 사례는 없고, `.astro` 는 이미 같은 방식으로 문제없이 동작한다.
