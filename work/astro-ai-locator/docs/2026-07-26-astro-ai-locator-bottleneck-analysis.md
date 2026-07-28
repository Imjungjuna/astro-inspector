# Astro AI Locator 예상 병목 지점 분석

> **구현 후 상태 (2026-07-26):** 이 문서에서 P0로 분류한 Astro 자체
> 메타데이터 전제는 실제 Astro 7.1.3 fixture에서 성립하지 않았다. 최종
> 구현은 `@astrojs/compiler-rs`로 원본 `.astro`를 파싱하고 Vite `load`
> 단계에서 패키지 전용 소스 속성을 주입한다. 이 결정은 source map,
> 반복 렌더 identity, 실제 브라우저와 프로덕션 무주입 테스트로
> 검증됐다.

## 문서 목적

이 문서는 `Alt/Option + hover/click → 해시 복사 → MCP 소스 조회` MVP를 구현할 때 실패 가능성이 높거나 일정이 늘어날 수 있는 지점을 미리 드러낸다. 구현 범위와 작업 순서는 [구현 계획서](./2026-07-26-astro-ai-locator-implementation-plan.md)를 기준으로 한다.

## 핵심 전제

- 브라우저 확장은 만들지 않는다.
- Astro Integration이 개발 페이지에 브라우저 클라이언트를 주입한다.
- 개발 모드에 한해 원본 `.astro`의 네이티브 HTML 태그를 AST로 찾아
  `data-astro-ai-locator-file`, `data-astro-ai-locator-loc`을 주입한다.
- 클릭된 요소만 manifest에 등록한다.
- Vite 개발 서버와 MCP 서버는 서로 다른 프로세스이며 JSON manifest를 공유한다.
- MVP는 네이티브 `.astro` 템플릿이 출력한 HTML만 지원한다.

## 우선순위 요약

| 우선순위 | 병목 | 가능성 | 영향 | MVP 판단 |
|---|---|---:|---:|---|
| P0 | Astro 소스 메타데이터의 버전별 차이 | 중간 | 매우 큼 | 시작 전에 fixture로 검증 |
| P0 | 클릭 대상과 실제 `.astro` 소스 위치 불일치 | 중간 | 매우 큼 | 사용자 흐름 전체를 E2E로 검증 |
| P0 | MCP host가 해시를 보고 tool을 호출하지 않음 | 중간 | 큼 | tool 설명과 사용 프롬프트를 강제 |
| P0 | 현재 Git 루트가 홈 디렉터리임 | 높음 | 매우 큼 | 커밋 전 전용 저장소 경계 확정 |
| P1 | HMR 이후 stale hash | 높음 | 큼 | 파일 단위 manifest 무효화 |
| P1 | manifest 동시 읽기/쓰기 | 중간 | 큼 | 직렬화 + 임시 파일 rename |
| P1 | Clipboard 권한과 사용자 제스처 | 중간 | 중간 | 클릭 이벤트 안에서 호출 + fallback |
| P1 | 전체 outline의 렌더링 비용 | 중간 | 중간 | 속성 선택자 + hover overlay + 성능 측정 |
| P1 | 경로 traversal 및 symlink 탈출 | 낮음 | 매우 큼 | 브라우저 endpoint와 MCP 양쪽에서 canonical 검증 |
| P2 | framework island 내부 요소 미지원 | 높음 | 중간 | README에 MVP 범위로 명시 |
| P2 | Alt/Option 키와 브라우저·OS 충돌 | 중간 | 중간 | blur/keyup 정리, modifier 옵션은 후속 |
| P2 | npm self-import와 tarball 해석 문제 | 중간 | 중간 | 실제 `npm pack` 설치 smoke test |

## 1. Astro 소스 메타데이터 생성

### 병목

초기 계획은 Astro가 개발 HTML에 삽입하는 속성을 재사용하려 했지만
Astro 7.1.3 server HTML에서는 안정적으로 제공되지 않았다. 최종 MVP는
다음 패키지 전용 속성을 생성한다.

```html
data-astro-ai-locator-file="src/components/Card.astro"
data-astro-ai-locator-loc="12:5"
```

Vite `transform` 훅은 Astro 컴파일러보다 늦게 실행될 수 있으므로,
플러그인의 `load` 훅이 원본 파일을 읽어 AST 변환 결과를 Astro
컴파일러에 넘긴다. 이 방식은 Astro 내부 AST 구조와 compiler-rs 버전에
대한 호환성 검증이 필요하다.

### 관찰 가능한 증상

- `Alt/Option`을 눌러도 아무 요소도 강조되지 않는다.
- 일부 페이지에서는 동작하지만 layout 또는 component root에서 동작하지 않는다.
- compiler AST 위치가 예상한 원본 `line:column`과 다르다.
- 경로가 절대 경로가 아니라 URL 또는 상대 경로로 들어온다.

### MVP 완화책

1. MVP peer range와 동일한 Astro 7 fixture에서 주입 속성 존재와 형식을 확인한다.
2. 컴포넌트 태그, `script`, `style`은 주입 대상에서 제외한다.
3. MagicString source map에 원본 절대 경로와 source content를 보존한다.
4. 클라이언트가 속성을 찾지 못하면 개발 콘솔에 한 번만 경고한다.
5. 서버는 전달된 상대 경로를 project root 기준으로 canonicalize한다.

### Go/No-Go 기준

- Astro 7 fixture에서 동일한 `<article>`이 파일·줄·열로 해석되면 진행한다.
- Astro 6 지원은 같은 E2E fixture가 통과한 뒤에만 peer range를 넓힌다.

## 2. DOM 인스턴스와 소스 요소의 정체성

### 병목

한 `.astro` 태그가 반복문으로 여러 DOM 인스턴스를 만들 수 있다.

```astro
{items.map((item) => <article>{item.name}</article>)}
```

두 `<article>`은 브라우저에서는 서로 다른 객체지만 소스 파일·줄·열은 같다. 이 제품은 DOM 인스턴스가 아니라 소스 템플릿 요소를 찾는 도구이므로 같은 hash를 만드는 것이 맞다.

### 반대 상황

- 같은 줄에 여러 태그가 있으면 column이 반드시 달라야 한다.
- 소스 위쪽에 줄을 추가하면 hash가 바뀐다.
- 파일을 이동하거나 이름을 바꾸면 hash가 바뀐다.

### MVP 판단

hash는 영구 ID가 아니라 현재 개발 세션의 source locator다. 줄·열 변화로 hash가 바뀌는 것은 허용한다. 사용자가 클릭 직후 AI에 붙여넣는 흐름을 최적화하며, 이 값을 이슈나 데이터베이스에 장기 저장하는 기능은 제공하지 않는다.

### 완화책

- identity 입력을 `relative file + line + column + tag`로 고정한다.
- hash 알고리즘 버전을 입력 맨 앞의 `v1`로 구분한다.
- 96-bit 길이인 SHA-256 앞 24 hex를 사용한다.
- manifest에 같은 hash가 다른 entry를 가리키는지 검사하는 충돌 방어 테스트를 추가한다.

## 3. “모든 경계선” 표시의 렌더링 비용

### 병목

활성화 중 다음 CSS는 모든 소스-backed 요소에 적용된다.

```css
html[data-astro-ai-locator-active]
  [data-astro-ai-locator-file][data-astro-ai-locator-loc] {
  outline: 1px dashed rgba(139, 92, 246, 0.55) !important;
}
```

대형 페이지에서는 수천 개 요소의 style recalculation과 paint가 발생할 수 있다. 모든 요소에 개별 event listener를 달면 비용이 더 커진다.

### MVP 완화책

- event delegation으로 window listener만 사용한다.
- `border`가 아니라 `outline`을 사용해 layout shift를 방지한다.
- 전체 경계는 한 개의 root attribute와 한 개의 CSS rule로 토글한다.
- 강한 hover 표시는 한 개의 fixed overlay만 재사용한다.
- pointermove에서 DOM 생성이나 manifest 요청을 하지 않는다.
- 실제 성능 문제가 확인되면 pointermove 좌표 처리를 `requestAnimationFrame`당 한 번으로 제한한다.

### 측정 기준

- 2,000개 annotated element fixture에서 Alt keydown 후 long task가 50ms를 넘지 않는다.
- pointermove 동안 overlay DOM node 수가 증가하지 않는다.
- Alt keyup 후 root attribute와 overlay가 즉시 제거된다.

## 4. CSS 격리와 좌표 정확도

### 병목

사용자 프로젝트의 전역 CSS가 overlay를 오염시킬 수 있다. `transform`, zoom, scroll, sticky, fixed, SVG, `display: contents`, overflow clipping도 target box와 시각적 경계의 오차를 만든다.

### MVP 완화책

- 강한 overlay 내부는 open Shadow DOM으로 격리한다.
- overlay host는 `position: fixed`, `pointer-events: none`, 최대 z-index를 사용한다.
- target은 `getBoundingClientRect()`로 측정한다.
- overlay가 자기 자신을 target으로 잡지 않도록 source attribute가 있는 요소만 선택한다.
- scroll과 resize 중 활성 상태라면 현재 target을 다시 측정하는 테스트를 추가한다.

### 알려진 제한

- iframe 내부 문서는 부모 document의 client가 직접 선택하지 못한다.
- closed Shadow DOM 내부 요소는 바깥에서 탐색할 수 없다.
- SVG의 일부 geometry는 HTML box와 다르게 보일 수 있다.
- `display: contents` 요소는 유효한 box가 없을 수 있다.

이 네 가지는 0.1에서 지원하지 않고 문서화한다.

## 5. Alt/Option 키 상태 손실

### 병목

브라우저 메뉴, OS 단축키, 창 전환 때문에 `keyup`이 페이지에 도착하지 않을 수 있다. 그러면 경계선이 계속 남는 stuck state가 발생한다.

### MVP 완화책

- `keyup`뿐 아니라 `window.blur`에서도 비활성화한다.
- click 성공·실패 후 `finally`에서 비활성화한다.
- pointermove의 `event.altKey`가 false면 다음 tick에 비활성화한다.
- 페이지가 숨겨지는 `visibilitychange`도 cleanup 경로에 추가한다.
- integration이 중복 설치되면 이전 cleanup을 먼저 호출한다.

### 후속 확장 조건

사용자 피드백에서 Alt 충돌이 반복될 때만 `modifier: "alt" | "meta" | "ctrl" | "shift"` 옵션을 추가한다. 초기부터 조합 키 설정 UI를 만들지 않는다.

## 6. Clipboard API

### 병목

`navigator.clipboard.writeText()`는 secure context와 사용자 제스처에 영향을 받는다. `localhost`는 일반적으로 개발에 적합하지만 LAN IP의 평문 HTTP, iframe 권한 정책, 브라우저별 permission 차이에서는 실패할 수 있다.

### MVP 완화책

- clipboard 흐름은 `Alt/Option + Click` handler에서 시작하지만, 네트워크
  응답을 기다리는 동안 transient user activation이 사라질 수 있음을
  명시적으로 테스트한다.
- 서버 응답 후 Clipboard API를 호출하고, 실패하면 임시 textarea와
  `document.execCommand("copy")`를 사용한다.
- 두 방식이 모두 실패하면 선택된 hash가 들어 있는 `window.prompt`를 열어
  사용자가 수동 복사할 수 있게 한다.
- Chromium E2E에는 `clipboard-read`, `clipboard-write` 권한을 명시한다.
- E2E는 클릭 직후 clipboard를 한 번 읽지 않고, 먼저 기존 값을 지운 뒤
  새 `astro_hash_` 값이 나타날 때까지 polling해 비동기 race를 막는다.
- 출시 전에는 clipboard 권한을 거부한 상태에서 수동 복사 prompt가
  실제로 열리는지도 한 번 확인한다.

### 병목 가능성이 큰 환경

- `http://192.168.x.x:<port>`로 접속
- 원격 개발 컨테이너의 port forwarding
- Safari/WebKit의 stricter clipboard 정책
- cross-origin iframe preview

초기 출시 전 최소 Chromium과 WebKit에서 수동 smoke test를 수행한다.

## 7. Vite middleware 수명주기와 HMR

### 병목

Vite 개발 서버는 파일 변경을 감시하지만 manifest는 Vite module graph 자체가 아니다. HMR이 발생해도 오래된 hash entry를 직접 지우지 않으면 MCP가 이전 줄·열을 계속 반환한다.

Astro 7은 AI coding agent를 감지하면 `astro dev`를 자동으로 background process로 띄울 수 있다. Playwright의 `webServer`가 foreground child process를 관리한다고 가정하면 테스트 종료 후 서버가 남거나 중복 server lock에 걸릴 수 있다.

### MVP 완화책

- `handleHotUpdate`에서 변경된 `.astro` 파일의 모든 entry를 제거한다.
- watcher `unlink`에서도 삭제된 파일 entry를 제거한다.
- manifest directory는 source watcher 대상과 분리해 자체 쓰기가 HMR loop를 만들지 않게 한다.
- 한 파일의 새 entry는 다음 사용자 클릭 때 등록한다.
- 개발 서버 시작 시 manifest를 empty snapshot으로 초기화한다.
- Playwright `webServer.env`에 `ASTRO_DEV_BACKGROUND=0`을 설정해 test server를 foreground process로 고정한다.

### 의도적인 trade-off

서버 재시작 시 이전에 복사한 hash는 사라진다. MVP의 hash는 현재 세션 locator이므로 허용한다. 세션 간 보존을 원하면 file fingerprint와 schema migration이 필요하며 별도 기능으로 다룬다.

## 8. Manifest 원자성 및 다중 프로세스

### 병목

Vite 프로세스가 manifest를 쓰는 순간 MCP 프로세스가 읽을 수 있다. 직접 overwrite하면 MCP가 반쪽 JSON을 읽을 수 있다.

### MVP 완화책

1. 메모리 Map에서 immutable snapshot을 만든다.
2. key를 정렬해 deterministic JSON을 만든다.
3. 같은 디렉터리에 고유 temp file을 쓴다.
4. write 완료 후 rename한다.
5. 프로세스 내부 write promise를 직렬화한다.
6. MCP는 cache하지 않고 tool 호출마다 manifest를 새로 읽는다.

### 남는 위험

같은 project root에서 Astro dev server를 두 개 실행하면 서로 다른 프로세스의 write queue가 보호되지 않는다. 0.1은 project root당 dev server 한 개만 지원한다.

### 후속 설계

다중 서버 지원이 필요해지면 다음 중 하나를 별도 결정한다.

- manifest filename에 session ID 또는 port 포함
- file lock
- MCP가 active session 목록을 선택
- manifest 대신 Vite server IPC 사용

## 9. 파일 경로 보안

### 병목

등록 endpoint는 브라우저가 보낸 `sourceFile`을 신뢰할 수 없다. MCP도 manifest 내용을 신뢰할 수 없다. 단순 `path.resolve()`만 사용하면 `..` 또는 symlink를 통해 project root 밖 파일을 읽을 수 있다.

### 양방향 검증

Vite endpoint와 MCP resolver 모두 다음 순서를 독립적으로 수행한다.

1. project root를 `realpath`.
2. candidate file을 resolve.
3. candidate를 `realpath`.
4. `path.relative(root, candidate)`가 root 밖을 가리키는지 검사.
5. `.astro` 확장자 확인.
6. regular file 확인.
7. byte size 제한.

### Monorepo trade-off

Astro 프로젝트가 workspace 바깥의 공유 `.astro` 패키지를 source로 직접 읽는 경우 strict root 검증 때문에 거부될 수 있다. MVP에서는 안전성을 우선한다. 실제 요구가 확인되면 `allowRoots: string[]` 옵션을 추가하되 각 root를 같은 방식으로 canonicalize한다.

## 10. MCP가 hash를 “자동 인식”하지 않는 문제

### 병목

MCP 서버가 clipboard나 채팅 입력을 가로채는 것은 아니다. 사용자가 hash를 붙여넣으면 모델이 tool을 호출할지 판단한다. Host, model, system prompt에 따라 hash를 일반 문자열로만 취급할 수 있다.

### MVP 완화책

Tool 이름:

```text
get_astro_element_by_hash
```

Tool 설명:

```text
Call this whenever the user provides an astro_hash_ value. Returns the exact
Astro source file, line, column, tag, excerpt, and full source for that selected
UI element.
```

README 사용 예:

```text
astro_hash_0123456789abcdef01234567 이 요소의 padding을 줄여줘.
```

### 검증 방법

- tool 목록에 설명이 그대로 노출되는지 MCP client로 확인한다.
- 실제 사용할 CLI/ACP에서 위 한 줄만 입력해 tool call이 발생하는지 수동 확인한다.
- 자동 호출이 불안정한 host에는 “astro_hash_가 있으면 tool을 호출”이라는 한 줄 instruction을 설정 문서에 추가한다.

## 11. MCP stdio 오염

### 병목

MCP stdio는 stdout을 JSON-RPC 채널로 사용한다. `console.log`, dependency banner, debug 출력 하나만 섞여도 host가 protocol parse error를 낼 수 있다.

### MVP 완화책

- MCP CLI에서는 `console.log`를 금지한다.
- 상태·오류 로그는 `console.error`만 사용한다.
- stdio integration test가 실제 child process를 실행한다.
- `npm pack` 결과의 CLI도 같은 테스트로 실행한다.
- 상세 내부 error를 tool result에 무조건 노출하지 않고, 사용자에게 필요한 메시지만 `isError: true`로 반환한다.

## 12. MCP host의 working directory와 실행 명령

### 병목

에디터와 CLI가 MCP 서버를 실행할 때 `process.cwd()`는 Astro 프로젝트가 아닐 수 있다. 또한 global install, local install, `npx`, package manager에 따라 binary resolution이 달라진다.

### MVP 완화책

- `--project-root`를 필수 인자로 만든다.
- root를 absolute/canonical path로 변환한다.
- README 기본 명령은 local dependency를 사용하는 `npx --no-install`로 제시한다.
- 인자가 없으면 즉시 usage를 stderr에 출력하고 non-zero 종료한다.

### 출시 전 확인

- 최소 한 CLI host와 한 ACP/editor host에서 local binary가 실행되는지 확인한다.
- 경로에 공백과 한글이 있는 project root로 smoke test한다.

## 13. 전체 소스 반환에 따른 context 비용

### 병목

사용자 요구는 component 전체 소스 반환이다. `.astro` 파일이 크면 tool result가 model context를 불필요하게 많이 소비한다.

### MVP 완화책

- 정확한 line 주변 excerpt를 항상 함께 반환한다.
- 전체 source 크기를 512 KiB로 제한한다.
- JSON 결과에 `relativeFile`, `absoluteFile`, `line`, `column`, `tag`, `excerpt`, `source`를 명시한다.
- source를 중복 포맷하거나 Markdown code fence로 한 번 더 감싸지 않는다.

### 후속 최적화 기준

실사용에서 token 비용이 문제가 될 때 `includeSource?: boolean` 또는 `contextLines?: number`를 추가한다. 0.1에서 옵션을 먼저 만들지 않는다.

## 14. Framework island 내부 요소

### 병목

React/Vue/Svelte/Solid가 hydration 후 만든 내부 DOM에는 Astro template source attribute가 없을 수 있다. 가장 가까운 source-backed element가 `<astro-island>` wrapper 또는 바깥 `.astro` 요소가 될 수 있다.

### MVP 판단

이 제품의 0.1 정체성은 “Astro template locator”다. framework-specific Babel/Vue/Svelte transforms를 동시에 지원하면 프로젝트가 여러 독립 subsystem으로 커진다.

### 완화책

- hover 대상은 source attribute가 있는 가장 가까운 요소로 제한한다.
- label에 실제 선택된 `.astro` file을 보여 오인 가능성을 줄인다.
- README에 island 내부 DOM 미지원 사실을 명시한다.
- 추후 adapter API를 설계할 때 React/JSX, Vue SFC, Svelte를 각각 별도 패키지로 평가한다.

## 15. CSP와 스타일 주입

### 병목

엄격한 개발 CSP는 injected module script 또는 동적으로 만든 `<style>`을 막을 수 있다. Astro Integration의 `injectScript("page")`는 Vite가 처리하지만 사용자 CSP 설정에 따라 실행이 제한될 수 있다.

### MVP 완화책

- client는 package ESM entry로 제공하고 `injectScript("page")`에서 import한다.
- network 요청은 same-origin Vite endpoint만 사용한다.
- style이 차단되더라도 click handler까지 함께 무너지는지 console warning으로 구분한다.
- CSP 지원을 보장한다고 문서화하지 않는다.

## 16. 패키지 self-import와 publish artifact

### 병목

Integration이 다음 public subpath를 주입한다.

```ts
import { installLocator } from "astro-ai-locator/client";
```

소스 checkout, local file dependency, npm tarball에서 export resolution 결과가 다르면 fixture에서는 성공하고 실제 설치에서 실패할 수 있다.

### MVP 완화책

- `package.json.exports`에 `.`, `./client`, `./mcp`를 명시한다.
- fixture는 build output을 사용한다.
- `npm pack --dry-run`뿐 아니라 실제 tarball을 임시 Astro fixture에 설치하는 smoke test를 출시 직전에 수행한다.
- browser client가 Node built-in module을 import하지 않는지 dist를 검사한다.
- CLI shebang이 build 후 첫 줄에 보존되는지 검사한다.

## 17. Astro 및 도구 버전 범위

### 병목

Astro 7, Vite, TypeScript, MCP SDK가 각각 독립적으로 major 변경될 수 있다. 특히 MCP SDK v2 예제는 v1 import 경로와 다르므로 혼용하면 빌드가 깨진다.

### MVP 완화책

- MCP는 `@modelcontextprotocol/sdk` 1.x만 사용한다.
- v1 import 경로의 `.js` suffix를 유지한다.
- Astro 7의 현재 최소 조건에 맞춰 Node.js `>=22.12.0`을 요구한다.
- Astro peer range를 실제 fixture가 통과한 범위보다 넓게 선언하지 않는다.
- dependency lockfile을 포함하고 Renovate/Dependabot 같은 자동 업데이트는 0.1 출시 후 설정한다.
- 새 major 업그레이드는 별도 compatibility branch에서 수행한다.

## 18. 현재 Git 저장소 경계

### 병목

현재 `/Users/jungjun/astro-ai-locator`에서 확인한 Git top level은 `/Users/jungjun`이다. 프로젝트 파일도 아직 home-level repository에서 untracked로 보인다. 이 상태에서 일반적인 `git add .`를 실행하면 홈 디렉터리의 대량 파일을 실수로 stage할 수 있다.

### 필수 안전 조치

모든 commit 전에 다음 검사가 성공해야 한다.

```bash
if [ "$(git rev-parse --show-toplevel)" != "/Users/jungjun/astro-ai-locator" ]; then
  echo "Unsafe Git root; stop before staging." >&2
  exit 1
fi
```

실패하면 commit 작업을 중단한다. 구현 시작 전에 다음 중 하나를 사용자가 명시적으로 선택해야 한다.

- `/Users/jungjun/astro-ai-locator`를 독립 Git repository로 초기화
- 의도한 기존 repository/worktree 안으로 프로젝트 이동
- 당분간 commit 없이 파일 작업만 수행

사용자의 명시적 선택 없이 home-level Git 설정을 변경하거나 새 repository를 초기화하지 않는다.

## 단계별 Go/No-Go 게이트

### Gate A — Astro source annotation

통과 조건:

- Astro fixture의 target에 패키지가 주입한 file/loc 속성이 존재한다.
- 반복 렌더링된 target이 의도대로 같은 source 위치를 가진다.

실제 결과:

- Astro 자체 속성 재사용은 실패했다.
- raw `.astro` Vite `load` + compiler AST 방식으로 전환한 뒤 통과했다.
- Astro 7.1.3 이외 버전은 같은 fixture가 통과한 뒤 peer range를 넓힌다.

### Gate B — Browser interaction

통과 조건:

- Alt keydown 시 전체 경계와 current overlay가 보인다.
- keyup/blur 후 UI가 남지 않는다.
- Alt click만 원래 click을 막는다.
- hash가 clipboard에 복사된다.

실패 시:

- browser extension으로 전환하지 않는다.
- injected client의 event/CSP/clipboard 원인을 먼저 분리한다.

### Gate C — Manifest integrity

통과 조건:

- concurrent in-process update 후 JSON이 항상 parse된다.
- HMR 후 변경 파일의 entry만 제거된다.
- MCP가 write 중간 상태를 읽지 않는다.

실패 시:

- 기능 추가를 중단하고 store 직렬화와 atomic rename을 먼저 해결한다.

### Gate D — MCP round trip

통과 조건:

- stdio client가 tool 목록을 읽는다.
- copied hash와 동일한 값으로 tool call이 성공한다.
- stdout protocol parse error가 없다.
- unknown/traversal hash는 안전하게 실패한다.

실패 시:

- UI 기능을 늘리지 않고 MCP CLI, cwd, stdout을 먼저 수정한다.

### Gate E — Package installation

통과 조건:

- npm tarball을 새 Astro fixture에 설치할 수 있다.
- package root, client subpath, CLI binary가 모두 resolve된다.
- production build에는 locator가 없다.

실패 시:

- npm publish를 중단한다.

## 주말 MVP에서 의도적으로 하지 않을 것

- Chrome/Firefox/Safari browser extension
- Cursor/VS Code/JetBrains deep link
- React/Vue/Svelte/Solid source transform
- `.astro` AST rewrite
- 영구적으로 안정적인 element ID
- 원격 HTTP MCP server
- 여러 project root 또는 monorepo allowlist
- 설정 UI와 toolbar
- 사용자 계정, telemetry, cloud manifest
- 여러 modifier 조합을 위한 설정 화면

## 구현 순서에 미치는 결론

가장 위험한 순서는 package scaffolding부터 전부 만든 뒤 마지막에 브라우저와 MCP를 연결하는 것이다. 다음 vertical slices로 검증해야 한다.

1. Astro metadata fixture 확인.
2. hover overlay만 구현하고 실제 브라우저 검증.
3. click → endpoint → manifest → clipboard 연결.
4. manifest → pure resolver 연결.
5. resolver → stdio MCP tool 연결.
6. 마지막에 npm tarball과 host 설정 검증.

각 단계가 실패하면 이후 단계로 넘어가지 않는다. 특히 Astro metadata와 MCP tool-call 유도는 코드 양보다 제품 성립 여부에 더 큰 영향을 준다.
