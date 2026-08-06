# 창닫기 옵션 2종 — 설계

> 2026-08-05 · brainstorming 세션 결과. 대상 릴리스 0.6.0.

## 목적

locator 를 닫는 방법을 두 갈래로 나눈다.

- **Hide** — 이 탭에서 여우 버튼만 치운다. Alt 호버·클릭 복사는 계속 쓴다. 새로고침하면 돌아온다.
- **Quit** — 이 dev 서버에서 끝낸다. 클라이언트뿐 아니라 **서버 계측까지** 멈춘다. `astro dev` 재시작이 복구 경로다.

## 배경 — 지금은 둘 중 어느 쪽도 아니다

현재 `Quit Extension` 하나뿐이고 동작은 이렇다.

| 층 | 현재 |
| --- | --- |
| 클라이언트 | 리스너·오버레이·FAB 제거 (`client/index.ts` `cleanup`) |
| dev 서버 | 메모리 플래그 `disabled = true` (`integration/session-handler.ts`) |
| 새로고침 | 세션 조회에서 `disabled` 를 보고 즉시 cleanup → 돌아오지 않는다 |
| 서버 계측 | **계속 돈다.** `.astro`/`.tsx` 주입, 엔드포인트, watcher 전부 살아 있다 |

새로고침으로 되돌릴 가벼운 종료가 없고, 무거운 종료는 서버 부하를 그대로 남긴다.
FUTURE_WORK §7 이 미완으로 적어 둔 `true zero-load disable` 이 이 절반에 해당한다.

## 결정 사항

### 1. 세션 상태를 공유 모듈로 끌어올린다

`disabled` 플래그가 `createSessionHandler` 지역 변수라 Vite 플러그인이 볼 수 없다.
작은 상태 객체로 분리해 양쪽이 같은 값을 본다.

```
createSessionState() → { isDisabled(), disable() }
   ├─ session-handler : POST → disable(), GET → 현재 값
   └─ vite-plugin     : load() · 미들웨어 · watcher 가 이 값을 읽는다
```

Hide 는 **서버에 아무것도 보내지 않는다.** 클라이언트 메모리에만 있으므로 탭 단위이고,
새로고침이 유일한 복구 경로다. 영속화하지 않는다.

### 2. Quit 이 끄는 범위

| 층 | Quit 후 |
| --- | --- |
| `load()` 주입 | 건너뛴다. `.astro`/`.tsx` 를 원본 그대로 서빙 |
| 이미 변환된 모듈 | 모듈 그래프에서 무효화하되 **HMR 업데이트는 보내지 않는다** |
| `/register` | `410 Gone`. 등록은 살아 있는 locator 만 부른다 |
| `/settings`, `/session` | 계속 응답한다 |
| watcher `unlink` 리스너 | 해제 |
| head-inline 스크립트 | 회수 불가. 아래 참조 |

2026-08-05 실측: 무효화만으로는 HMR 메시지가 나가지 않는다(스파이크 확인). 설계대로 간다.

무효화는 하되 리로드를 밀지 않는 이유: 버튼을 눌렀다고 페이지가 통째로 새로고침되면
폼 입력과 스크롤이 날아간다. 현재 탭은 그대로 두고 다음 네비게이션부터 깨끗해진다.

`/session` 은 새 탭이 닫힌 상태를 알아야 하므로 남긴다. `/settings` 도 함께 남긴다.
닫아 버리면 클라이언트가 부팅할 때마다 설정 조회에 실패해 콘솔 경고를 찍는데
(`settings-api.ts` 는 실패 시 기본값으로 폴백하며 `console.warn` 한다),
얻는 것 없이 소음만 는다.

**head-inline 스크립트는 뗄 수 없다.** Astro integration 이 기동 시 심는 것이라
dev 실행 중에 회수할 방법이 없다. Quit 후에도 페이지마다 클라이언트 에셋 요청 1개와
세션 조회 1개가 남고, 클라이언트가 `disabled` 를 보고 즉시 self-cleanup 한다.
따라서 이 작업의 결과는 "0 부하"가 아니라 **"요청당 스크립트 2개만 남는 정지"** 다.
완전한 0 은 재시작뿐이며, README 에 그대로 적는다.

### 3. UI — 푸터에 아이콘 한 칸

```
footer: grid-template-columns 28px 1fr 1fr

[eye-off]  [Quit]  [MCP Prompt]
```

- 아이콘은 eye-off SVG. `client/fox-mark.ts` 옆에 `client/hide-mark.ts` 로 둔다.
- 28×28, 텍스트 버튼과 같은 표면·테두리·hover.
- `aria-label` 과 `title` 은 `Hide the button until reload`.
- 클릭하면 팝오버를 닫고 FAB 을 제거한 뒤 토스트를 띄운다:
  `Button hidden. Reload the page to bring it back.`
- **리스너와 오버레이는 유지한다.** Alt 호버·클릭 복사가 그대로 동작한다.

Quit 토스트 문구(`Locator closed. Restart the dev server to bring it back.`)는 그대로 둔다.
서버까지 멈춘다는 사실은 토스트가 아니라 README 에 적는다.

### 4. 구현 순서

1. **스파이크 — 모듈 무효화의 실제 효과 확인.** `.astro` 모듈을 무효화했을 때 Astro 가
   자체 판단으로 full reload 를 밀어 버리는지 픽스처 dev 서버에서 실측한다.
   full reload 가 관측되면 무효화를 생략하고 "조용한 정지"(다음 요청부터 주입 skip)로
   폴백한다. 이 결과가 §2 의 무효화 행을 확정한다.
2. 세션 상태 모듈 분리 + `load()`·핸들러·watcher 배선.
3. Hide 아이콘과 클라이언트 동작.
4. README 갱신.

### 5. 테스트

| 층 | 내용 |
| --- | --- |
| unit | 세션 상태(초기 `false`, `disable()` 후 `true`), `load()` 가 disabled 면 `null`, 핸들러 410 |
| e2e | Hide → FAB 0개인데 Alt 호버 오버레이는 뜬다 / 새로고침하면 FAB 복귀 |
| e2e | Quit → FAB 0개, 새로고침해도 0개 (기존 테스트 유지) |
| integration | Quit 이후 받은 HTML 에 `data-astro-ai-locator-` 가 없다 |

기존 e2e 는 하나의 픽스처 dev 서버를 공유하므로 세션 엔드포인트를 목킹한다.
서버 계측 정지는 목킹으로 검증할 수 없고, 진짜 Quit 을 보내면 이후 테스트가 전부 죽는다.
따라서 마지막 항목만 **전용 dev 서버를 띄우는 통합 테스트**로 분리한다.

## 범위 밖

- Hide 를 새로고침 없이 되돌리는 단축키
- Hide 상태 영속화
- 프로젝트별 override
- `astro dev` 프로세스 자체 종료
- head-inline 스크립트까지 없애는 완전한 zero-load 모드 (integration lifecycle 별건)
