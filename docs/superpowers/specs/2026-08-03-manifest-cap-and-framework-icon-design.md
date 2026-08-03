# Manifest 상한 + 호버 라벨 프레임워크 아이콘 — 설계

> 2026-08-03 작성
>
> 독립된 두 변경을 한 문서로 묶는다. 서로 의존하지 않으므로 순서를 바꿔
> 구현해도 된다. 둘 다 manifest schema, MCP 응답, DOM 속성 규약을 바꾸지
> 않는다.

## 1. Manifest 엔트리 상한

### 문제

[`ManifestStore`](../../../src/manifest/store.ts)는 dev server 가 사는 동안
엔트리를 무한히 쌓는다. `reset()`은 서버 시작 때 한 번만 돌고, 이후에는
`removeByFile()`로 HMR·삭제된 파일만 지운다. 클릭을 오래 이어가는 세션에서는
manifest 파일이 계속 커지고, 매 클릭마다 전체를 직렬화해 다시 쓴다.

### 규칙

- 상한 100개. 파일에 기록되는 엔트리 수는 100을 넘지 않는다.
- 삽입 후 크기가 100을 넘으면 가장 오래된 50개를 지운다.
- 순서 기준은 `Map` 삽입 순서다. 별도 타임스탬프 필드를 두지 않는다.
- 같은 해시를 다시 등록하면 맨 뒤로 보낸다. 재클릭은 "아직 쓰는 중"이라는
  신호이므로 축출 대상에서 밀어낸다.

### 구현

`src/manifest/store.ts` 한 파일만 바꾼다.

```ts
const MAX_ENTRIES = 100;
const EVICT_COUNT = 50;
```

`upsert()` 순서:

1. 기존 해시 충돌 검사 — 지금 로직 그대로.
2. `this.entries.delete(hash)` 후 `this.entries.set(hash, entry)`.
   `Map.set()`은 이미 있는 키 위치를 바꾸지 않으므로 삭제를 먼저 해야
   맨 뒤로 간다.
3. `this.entries.size > MAX_ENTRIES`이면 앞에서 `EVICT_COUNT`개를 지운다.
4. `persist()`를 한 번 호출한다. 축출과 삽입을 합쳐 쓰기는 한 번이다.

두 상수는 `store.ts` 지역 상수로 두고 export 하지 않는다. 설정으로 노출하면
settings schema 를 v6 으로 올려야 하는데 그만한 값이 없다.

### 바뀌지 않는 것

- `LocatorManifestSchema`는 schemaVersion 1 그대로다.
- `resolveElementByHash()`와 MCP 도구 응답은 손대지 않는다.
- `reset()`, `removeByFile()`, `readSnapshot()` 동작은 그대로다.
- 축출된 해시를 조회하면 기존 `Unknown Astro element hash` 오류로 떨어진다.
  새 오류 경로를 만들지 않는다.

### 테스트

[`tests/unit/manifest-store.test.ts`](../../../tests/unit/manifest-store.test.ts)에
두 건을 더한다.

- 101개를 등록하면 스냅샷 엔트리가 51개로 줄고, 살아남은 엔트리가 나중에 넣은
  51개인지 확인한다.
- 오래된 해시를 중간에 다시 등록하면 축출 후에도 남아 있는지 확인한다.

해시는 `createElementHash()`에 line 값을 바꿔 넣어 만든다.

## 2. 호버 라벨 프레임워크 아이콘

### 목적

호버 라벨만 보고 이 요소가 `.astro` 템플릿에서 왔는지 React 아일랜드에서
왔는지 바로 알게 한다.

### 판별

판별에 쓸 데이터는 이미 DOM 에 있다. `data-astro-ai-locator-file` 속성이
확장자를 그대로 물고 있다. 새 속성도, 서버 왕복도 필요 없다.

| 확장자 | 결과 |
| --- | --- |
| `.astro` | `"astro"` |
| `.tsx`, `.jsx` | `"react"` |
| 그 밖 · 속성 없음 | `null` |

`null`이면 아이콘 자리를 통째로 감춘다. 빈 아이콘이나 앞 여백을 남기지
않는다.

### 새 모듈

`src/client/source-framework.ts`를 만든다.

```ts
export type SourceFramework = "astro" | "react";
export function frameworkFromFile(file: string): SourceFramework | null;
export const FRAMEWORK_ICON_SVG: Record<SourceFramework, string>;
```

확장자는 소문자로 맞춰 비교한다. DOM 없이 돌아가는 순수 함수라
[`trigger-key.ts`](../../../src/client/trigger-key.ts),
[`clipboard-payload.ts`](../../../src/client/clipboard-payload.ts)와 같은
결로 unit test 를 붙인다.

SVG 는 simple-icons 형식이다. 마크당 `<path>` 하나, `<defs>` 없음, `fill`
속성 없음. 색은 CSS 로 준다.

- Astro `#BC52EE`
- React `#61DAFB`

### 렌더링

[`overlay.ts`](../../../src/client/overlay.ts) shadow DOM 마크업에 두 SVG 를
모두 미리 넣고 CSS 로 하나만 보인다. 호버는 `requestAnimationFrame`마다
도는데 매 프레임 `innerHTML`을 쓰면 낭비다.

```text
<span class="label" data-framework="astro">
  <span class="label-icon"> svg.icon-astro  svg.icon-react </span>
  <span class="label-tag">…
```

`show()`에서 `label.dataset.framework`를 채우고, `null`이면 속성을 지운다.
빈 문자열도 `[data-framework]` 선택자에 걸리므로 `delete`를 써야 한다.

### 대비 처리

라벨 배경은 네 색상 프리셋 모두 어둡다. 아이콘 색을 그대로 두면 Astro 보라
마크가 세 프리셋에서 묻힌다. 아이콘 대비(WCAG 비텍스트 기준 3:1):

| 아이콘 | Neutral `#27272a` | Violet `#6d28d9` | Orange `#c2410c` | Sky `#0369a1` |
| --- | --- | --- | --- | --- |
| React `#61DAFB` | 9.2 | 4.4 | 3.2 | 3.7 |
| Astro `#BC52EE` | 4.0 | 1.9 | 1.4 | 1.6 |

프리셋마다 색을 갈아끼우는 대신 아이콘 뒤에 흰 원을 깐다. 두 마크 다 밝은
배경을 전제로 만든 마크라 제자리를 찾고, 네 프리셋 모두에서 브랜드
색을 유지한다. 프리셋 조건부 CSS 가 한 줄도 필요 없다.

- 원 지름 14px, `border-radius: 50%`, `background: #fff`
- 아이콘 10px
- 라벨 line-box 가 15.4px(`11px × 1.4`)이므로 라벨 높이는 그대로다

### 레이아웃 제약

`.label`은 `display: block`을 유지한다. flex 로 바꾸면
[`tests/e2e/locator.spec.ts`](../../../tests/e2e/locator.spec.ts)가 검사하는
`text-overflow: ellipsis`가 깨진다. 아이콘은 `inline-flex`에 `vertical-align`
로 붙인다.

기존 라벨 배치 로직(flip, clamp, 최대 너비)은 손대지 않는다. 아이콘 폭이
더해지면 계산은 지금 코드가 그대로 흡수한다.

### 테스트

`tests/unit/source-framework.test.ts` — 확장자 매핑, 대소문자 혼용,
알 수 없는 확장자, 빈 문자열.

`tests/e2e/locator.spec.ts` — `.astro` 대상에서 Astro 아이콘만, `.tsx`
대상에서 React 아이콘만 보이는지, 흰 원 배경이 적용됐는지.

기존 라벨 텍스트 단언은 깨지지 않는다. `toHaveText`는 `textContent`를 읽는데
SVG 는 텍스트 노드를 만들지 않는다.

## 3. 범위 밖

- 아이콘 표시 여부 설정
- 상한값·축출 개수 설정 노출
- Vue, Svelte 아이콘. 해당 프레임워크는 아직 source 추적 자체를 지원하지 않는다
- manifest entry 에 타임스탬프 필드를 넣는 schema v2

## 4. 건드리는 파일

| 파일 | 변경 |
| --- | --- |
| `src/manifest/store.ts` | 상한, LRU 재삽입 |
| `tests/unit/manifest-store.test.ts` | 축출·LRU 케이스 |
| `src/client/source-framework.ts` | 신규 |
| `tests/unit/source-framework.test.ts` | 신규 |
| `src/client/overlay.ts` | 라벨 아이콘 마크업·CSS·`show()` |
| `tests/e2e/locator.spec.ts` | 아이콘 표시·전환·미표시 |
| `README.md` | 라벨 형식, manifest 상한 |
