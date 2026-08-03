# Quit Extension + Copy MCP Prompt — 설계

> 2026-08-03 작성
>
> 팝오버 푸터에 버튼 두 개를 놓고, 여우 FAB 우클릭에 같은 quit 동작을
> 말풍선으로 붙인다. 두 버튼은 자리만 나눠 쓰고 서로 의존하지 않으므로
> 순서를 바꿔 구현해도 된다.

## 1. 세션 비활성화 — Quit Extension

### 요구

누르면 로케이터가 사라진다. 새로고침해도 돌아오지 않는다. dev server 를
다시 띄우는 것이 유일한 복구 경로다.

### 상태를 어디에 두나

Vite 플러그인 클로저의 `let disabled = false`. 프로세스 메모리이므로 dev
server 재시작이 곧 초기화다.

파일에 쓰면 재시작해도 살아남아 요구와 어긋난다. `localStorage` 와
`sessionStorage` 도 재시작으로 지워지지 않으므로 쓰지 않는다.

### 엔드포인트

`/_astro-ai-locator/session` 하나를 더한다.

| 메서드 | 동작 |
| --- | --- |
| `GET` | `{ disabled, mcpCommand, mcpArgs }` 반환 |
| `POST` | `disabled` 를 `true` 로 바꾸고 같은 형태를 반환 |
| 그 밖 | 405, `allow: GET, POST` |

토큰 검사는 [`settings-handler.ts`](../../../src/integration/settings-handler.ts)와
같다. 헤더가 틀리면 403이다. 본문을 읽지 않으므로 크기 제한은 필요 없다.

`disabled` 와 MCP 경로를 한 엔드포인트에 합친다. 둘 다 "이 dev server
프로세스에 관한 사실"이고, 나누면 핸들러·클라이언트 모듈·테스트 파일이
하나씩 더 생긴다.

### 페이지 로드 경로

```text
installLocator()
  └ Promise.all([ loadLocatorSettings(), loadSessionState() ])
      ├ disabled=true  → 아무것도 설치하지 않고 끝낸다
      └ disabled=false → 기존 installReadyLocator()
```

두 요청이 병렬이므로 지연이 늘지 않는다.

`injectScript` 내용은 `astro:config:setup` 시점에 굳으므로 주입 자체를
런타임에 뺄 수 없다. 대신 클라이언트가 스스로 설치를 포기한다.

남는 것은 이미 변환된 모듈에 박힌 `data-*` 속성뿐이다. 걷어내려면 모듈
그래프를 통째로 무효화하고 풀 리로드를 걸어야 하는데, 보이지도 않는 몇
바이트를 위해 큰 레버를 당기는 셈이라 하지 않는다.

### 실패 처리

세션 GET 이 실패하면 `disabled: false` 로 간주하고 정상 설치한다. 설정
로드가 기본값으로 떨어지는 것과 같은 방침이다. 반대로 막으면 엔드포인트가
한 번 딸꾹거릴 때 도구 전체가 죽는다.

이때 `mcpCommand` 를 모르므로 Copy MCP Prompt 는 복사 대신
`Unable to read MCP configuration` 토스트를 낸다.

### quit 클릭 순서

1. `POST /_astro-ai-locator/session` — 이후 모든 페이지 로드가 꺼진다.
2. `overlay.toast()` 로 되살리는 법을 알린다.
3. 1800ms 뒤 `cleanup()`. 토스트 애니메이션 길이와 맞춘다.

`cleanup()` 은 [`index.ts`](../../../src/client/index.ts)에 이미 있다.
리스너 아홉 개를 떼고 `settingsPanel.destroy()` 와 `overlay.destroy()` 를
부른다. 새로 짤 것이 없다.

POST 가 실패해도 로컬 철거는 그대로 한다. 다만 플래그가 서지 않았으므로
토스트 문구를 바꿔 새로고침하면 돌아온다고 알린다.

### 바뀌지 않는 것

- 전역 설정 파일과 스키마 v5는 그대로다.
- manifest, MCP 응답, DOM 속성 규약을 건드리지 않는다.
- 다른 탭은 새로고침할 때 반영된다. 실시간 broadcast 는 만들지 않는다.
  [FUTURE_WORK](../../FUTURE_WORK.md)가 명시한 방침이다.

## 2. Copy MCP Prompt

### 목적

MCP 등록을 사람이 손으로 하지 않게 한다. 버튼을 누르면 **AI 에이전트에
붙여넣을 프롬프트**가 복사된다. 붙여넣으면 에이전트가 자기 호스트를
판단해 설정까지 끝낸다. 호스트별 분기가 제품에서 사라진다.

### 서버가 주는 것

플러그인 초기화 때 한 번 계산해 재사용한다.

1. `<root>/node_modules/.bin/astro-inspector-mcp` 가 있으면 그 절대경로를
   `mcpCommand`, `["--project-root", root]` 를 `mcpArgs` 로 쓴다.
2. 없으면 `<workspaceRoot>/node_modules/.bin/` 을 같은 방식으로 본다.
   npm workspace 는 bin 을 루트로 끌어올리고 pnpm 은 패키지 안에 두므로
   두 곳을 모두 확인해야 한다.
3. 둘 다 없으면 `npx` 와 `["--no-install", "astro-inspector-mcp",
   "--project-root", root]` 로 떨어진다.

`workspaceRoot` 는 [`vite-plugin.ts`](../../../src/integration/vite-plugin.ts)가
이미 갖고 있다.

### 절대경로 노출

이 기능은 절대경로를 브라우저로 보낸다. 지금까지 이 레포는 그러지 않았다.
등록 응답의 `workspaceFile` 도 workspace 상대경로이고, 그마저 DOM·manifest·
MCP·설정 어디에도 저장하지 않는다.

의도한 예외로 둔다. dev 전용이고, 토큰 인증을 거치며, localhost 이고,
사용자 본인 프로젝트 경로다. 저장은 하지 않고 클릭 시점 클립보드로만
나간다.

### 프롬프트 조립

서버는 구조화된 값만 주고 문자열은 클라이언트가 만든다.
[`clipboard-payload.ts`](../../../src/client/clipboard-payload.ts)가 쓰는
패턴과 같아서 서버 없이 unit test 를 붙일 수 있다.

`src/client/mcp-prompt.ts` 에 `formatMcpSetupPrompt(state)` 를 둔다.
출력은 영문이다. 제품 언어를 따른다.

```text
Set up the astro-inspector MCP server for this project, then confirm it
responds.

Add this entry to the MCP config for whichever host you are running in.
Claude Code uses .mcp.json at the project root; Cursor uses
.cursor/mcp.json. Both take the same shape, so merge it into an existing
mcpServers object instead of replacing the file.

{
  "mcpServers": {
    "astro-inspector": {
      "command": "<mcpCommand>",
      "args": [<mcpArgs>]
    }
  }
}

Reconnect MCP servers afterwards. From then on, whenever I paste a value
starting with astro_hash_, call get_astro_element_by_hash to resolve it to a
source file, line, and column before editing anything.
```

"merge it into an existing mcpServers object instead of replacing the file"
는 빼지 않는다. 대부분 이미 다른 MCP 서버를 등록해 두었다.

### 복사 경로

[`index.ts`](../../../src/client/index.ts)의 `copyText()` 를 그대로 쓴다.
클립보드가 막히면 `window.prompt` 폴백까지 이미 있다.

## 3. UI

### 팝오버 푸터

기존 섹션 아래에 구분선을 긋고 버튼 두 개를 나란히 놓는다.

```text
├────────────────────────────────────┤
│ [ Copy MCP Prompt ] [Quit Extension]│
└────────────────────────────────────┘
```

`grid-template-columns: 1fr 1fr`. 라벨은 팝오버의 다른 라벨과 같이 Title
Case 로 쓴다.

`Copy MCP Prompt` 는 누르면 1800ms 동안 `Copied ✓` 로 바뀌었다가 돌아온다.
연결 상태가 아니라 클릭 피드백이다. MCP 가 실제로 붙었는지는 dev server 가
알 수 없다. MCP 서버는 호스트가 띄우는 별도 stdio 프로세스이고 manifest 를
읽기만 하므로 흔적이 남지 않는다.

### 우클릭 말풍선

여우 FAB 우클릭에 `Quit Extension` 하나짜리 말풍선을 띄운다. 팝오버와 같이
바깥 pointerdown 과 `Escape` 로 닫는다.

`src/client/fab-menu.ts` 로 뺀다.
[`settings-panel.ts`](../../../src/client/settings-panel.ts)가 이미 1152줄이라
여기에 더 붙이면 커진다.

### 주의 지점

- `settings-panel.ts` 의 shadow `contextmenu` 핸들러가 버튼 우클릭을
  `click()` 으로 넘긴다. launcher 는 예외로 빼야 우클릭이 quit 을 바로
  실행하지 않는다.
- `index.ts` 의 전역 `onContextMenu` 는 `selectTarget` 의 `isLocatorUiEvent`
  가드에 막혀 FAB 을 건드리지 않는다. 확인했고 수정하지 않는다.

## 4. 테스트

`tests/unit/session-handler.test.ts` — 토큰 거부, 405, GET 초기값, POST 후
GET 이 `disabled: true`.

`tests/unit/mcp-prompt.test.ts` — bin 경로 형태와 `npx` 폴백 형태 두 가지,
`mcpArgs` 가 JSON 배열로 정확히 직렬화되는지.

`tests/e2e/locator.spec.ts` — 우클릭 말풍선, quit 후 오버레이·FAB 소멸,
트리거 키 무반응, 새로고침 후에도 설치되지 않음, Copy MCP Prompt 클립보드
내용.

**E2E 는 세션 엔드포인트를 반드시 목킹한다.** Playwright `webServer` 가
fixture dev server 하나를 전 테스트가 공유하므로, 실제로 POST 가 나가면
플래그가 서서 이후 모든 테스트에서 로케이터가 죽는다. `mockSettingsEndpoint`
와 같은 방식으로 `page.route` 를 건다.

## 5. 범위 밖

- 되살리기 UI. dev server 재시작이 유일한 경로다
- 전역 설정 파일에 disabled 를 영속화하기
- 다른 탭 실시간 broadcast
- `mcp connected` 상태 분기. MCP 프로세스가 heartbeat 를 남겨야 가능하고,
  그것도 페이지 로드 시점 스냅샷이라 별도 스펙으로 뺀다
- Cursor 딥링크
- Vite 모듈 그래프를 무효화해 `data-*` 속성까지 걷어내기

## 6. 건드리는 파일

| 파일 | 변경 |
| --- | --- |
| `src/shared/contracts.ts` | 세션 엔드포인트 상수, `LocatorSessionState` |
| `src/integration/session-handler.ts` | 신규 |
| `src/integration/vite-plugin.ts` | 플래그, 미들웨어, bin 경로 해석 |
| `src/client/session-api.ts` | 신규 |
| `src/client/mcp-prompt.ts` | 신규 |
| `src/client/fab-menu.ts` | 신규 |
| `src/client/index.ts` | 병렬 로드, bail, 두 액션 배선 |
| `src/client/settings-panel.ts` | 푸터 버튼 두 개 |
| `tests/unit/session-handler.test.ts` | 신규 |
| `tests/unit/mcp-prompt.test.ts` | 신규 |
| `tests/e2e/locator.spec.ts` | 말풍선·quit·복사 |
| `README.md` | 푸터 버튼, quit 동작, MCP 등록 경로 |
