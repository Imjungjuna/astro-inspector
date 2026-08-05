# Astro Inspector — Future Work

> 2026-07-28 기록 · 다음 작업 세션의 기준 문서
>
> 현재 기준선: 개발 서버에서 Astro/React DOM을 추적하고, 트리거 키를
> 누른 채 호버하면 전체 요소·가장 가까운 메타데이터 조상·현재 요소를
> 구분해 표시한다. 클릭 시 locator hash를 복사하고 MCP가 manifest
> entry를 조회한다. 마지막 `npm run verify`에서 unit 92개, MCP integration
> 1개, E2E 31개, production output 1개와 TypeScript build가 통과했다.

## 다음 구현 후보

### 0. 패키지·폴더 이름 변경 ✅ 2026-07-30 완료

패키지가 직접 AI 기능을 실행하는 것처럼 보이지 않도록 공개 이름을
`astro-inspector`로 변경했다.

확정한 이름:

- npm package: `astro-inspector`
- repository/folder: `astro-inspector`
- 사용자 노출 제품명: `Astro Inspector`

변경 범위:

- `package.json`의 `name`, exports, bin 및 관련 package metadata.
- integration import, CLI/MCP 등록 명령, local `file:` 설치 예시.
- README, fixture, 테스트, 문서와 오류 메시지의 사용자 노출 이름.
- MCP server 이름과 Claude/Codex 등록 예시.
- npm publish 전에 package name 사용 가능 여부 확인.

기존 `data-astro-ai-locator-*`, `astro_hash_*`, `.astro-ai-locator` 저장
경로는 protocol compatibility를 위해 유지한다. 기존 `astroAiLocator()`
export도 deprecated alias로 남기고, 새 기본 예시는 `astroInspector()`를
사용한다.

### 1. UI 색상 프리셋 ✅ 2026-07-29 완료

팝오버의 `Overlay Color` 칩을 실제 설정 컨트롤로 만들었다.

- `Neutral`, `Violet`, `Orange`, `Sky` 네 preset을 제공한다.
- 기본값은 `Violet`이며 schema v1도 기존 trigger를 보존해 이 값으로
  migration한다.
- 현재 요소 테두리·채움, 부모 테두리, 라벨, 선택된 keycap과 chip ring에
  같은 색상 계열을 적용한다.
- trigger 행 hover, FAB, popover surface는 neutral grey를 유지한다.
- 설정은 `Copy As Location`이 추가된 현재 전역 settings schema v5에서도
  그대로 유지한다.

자유 색상 선택기는 현재 범위에 포함하지 않는다.

### 2. 표시할 메타데이터 조상 개수 — 완료

팝오버에 `Parent Levels` 선택 그룹을 추가한다.

- 선택값: `0`, `1`, `2`, `3`.
- 기본값: `1`.
- 실제 `parentElement` 수가 아니라 source-file과 source-location
  메타데이터를 모두 가진 가장 가까운 조상부터 센다.
- `0`은 부모 경계를 표시하지 않는다.
- 각 부모에는 채움과 라벨을 표시하지 않는다.
- hit resolver와 현재 hover 대상 판별은 변경하지 않는다.

구현 메모:

- 단일 `.parent-box`를 최대 3개까지 재사용하는 overlay box pool로
  바꾸는 편이 단순하다.
- 매 프레임 새 DOM을 만들지 않고, 활성화 중 필요한 box만 보이게 한다.
- 중복 rect, 0×0 rect, `display: contents` 조상은 별도 회귀 테스트가
  필요하다.

### 3. 더 짧은 locator token ✅ 2026-08-05 완료

`#a` + base36 3자리(5자 고정)의 서버 순번 발급으로 구현했다. manifest cap(100)과
기동 시 리셋으로 충돌 모집단 전제가 사라져, alias 이중 지원 없이 포맷을
교체했다. 랜덤 시작점(세션 솔트)과 MCP 해석 시 태그 재검증이 교차 오인을
막는다. 상세는 specs/2026-08-05-compact-token-design.md.

### 4. 복사할 정보 선택 ✅ 2026-07-30 완료

팝오버의 `Copy As`를 Hash와 Context의 상호 배타적인 모드로 구현했다.

- 기본값 `Hash`는 기존 MCP lookup token만 복사한다.
- `Context`는 Tag, Location, Line 조합을 선택한다.
- 출력 순서는 설정 클릭 순서와 무관하게 Tag → Location으로 고정한다.
- Line은 Location이 선택된 동안에만 활성화되며, Location을 끄면 함께
  해제된다.
- Location은 Vite workspace root 기준 `/` 시작 Path 또는 확장자를 포함한
  Module name 중 하나로 표시한다.
- workspace Path는 인증된 click-time registration 응답에서만 전달하고
  DOM, manifest, MCP, settings에는 저장하지 않는다.
- Context 전체 행이 disclosure click target이다. Hash에서 Context를
  선택하면 자동으로 열리고, Hash로 돌아가도 disclosure 상태는 유지된다.
  페이지 로드 시에는 닫힌 상태로 시작한다.
- 기존 단일 registration pipeline을 유지해 두 모드 모두 manifest
  freshness와 source validation을 공유한다.

### 5. 클릭 토스트 디자인 ✅ 2026-07-30 완료

복사 성공 feedback을 viewport 하단 중앙의 짧고 명확한 “pop” toast로
구현했다.

- Hash와 Context 중 실제 복사한 모드를 확인해 준다.
- 44px 이상 높이, safe-area inset, 좁은 viewport에서의 최대 너비를
  적용한다.
- 작은 translate/scale과 opacity로 등장하고 짧은 overshoot 뒤 정착한
  다음 부드럽게 퇴장한다.
- `prefers-reduced-motion`에서는 scale/overshoot 없이 fade만 사용한다.
- 연속 클릭은 이전 timer와 animation을 취소한 뒤 새 toast를 처음부터
  안전하게 재생한다.

### 6. 호버 라벨 viewport clipping 방지 ✅ 2026-07-30 완료

현재 요소 라벨이 화면 가장자리에서 잘리지 않도록 viewport-safe 배치를
구현했다.

- 기본 위치는 현재처럼 요소 위다.
- 위에 들어가지 않고 아래에는 들어가면 아래로 flip한다.
- 어느 쪽에도 들어가지 않으면 가용 공간이 더 큰 쪽을 선택한 뒤
  viewport 안으로 clamp한다.
- 좌우와 상하는 8px viewport padding 안으로 clamp한다.
- 최대 너비와 ellipsis, 현재 요소에 라벨 하나만 표시하는 원칙을 유지한다.
- 긴 source tag를 포함한 좌상단·우하단 회귀 테스트로 flip/clamp를
  검증한다.
- hit resolver, hash, clipboard payload, MCP는 변경하지 않았다.

### 7. Locator 비활성화 ✅ 2026-08-03 완료

팝오버 푸터의 `Quit Extension` 버튼으로 구현했다. 아래 Pause/Disable 2단계
모델 대신 단일 동작으로 끝냈다.

- 누르면 토스트로 되살리는 법을 알린 뒤 리스너·오버레이·FAB을 모두 없앤다.
- dev server 프로세스가 메모리에 플래그를 들고 있어 새로고침해도 돌아오지
  않는다. `astro dev` 재시작이 유일한 복구 경로다.
- 파일에 쓰지 않는다. 영속화하면 되돌려야 할 재시작을 살아남는다.
- 이미 열려 있는 다른 탭은 새로고침할 때 반영된다.

우클릭 진입점은 한 번 넣었다가 제거했다. 팝오버 버튼 하나로 충분하고,
FAB 우클릭은 원래대로 팝오버를 연다.

2026-08-05: Quit이 source instrumentation까지 멈추도록 확장했다(0.6.0). `load()` 주입 skip,
`/register` 410, watcher 해제, 모듈 그래프 무효화까지 간다. 남은 잔여 부하는 head-inline
스크립트 태그 하나뿐이며, 이것은 integration이 기동 시 심는 것이라 dev 실행 중 회수할 수 없다.
완전한 zero-load는 여전히 재시작이 필요하다. 아래 Pause/Disable 2단계 모델은 폐기한다 —
Hide(이 탭만)와 Quit(서버까지)의 두 갈래로 대체됐다.

성능상 중요한 구분:

#### Pause

- 고빈도 pointer/keyboard/click listener를 해제한다.
- boundary style, overlay, resolver 상태를 제거한다.
- 다시 켜기 위한 FAB와 최소 listener는 남는다.
- 체감 부하는 거의 없지만 정확히 0은 아니다.

#### Disable on next dev-server start

- 전역 설정에 disabled 상태를 저장한다.
- 다음 dev server 시작 시 integration이 설정을 먼저 읽고 source
  instrumentation과 client script 주입을 모두 건너뛴다.
- 이 모드는 브라우저 런타임 부하를 0으로 만들 수 있다.
- 다시 켜려면 설정 변경 후 dev server를 재시작해야 한다.

UI에서 즉시 다시 켤 수 있는 코드가 남아 있는 상태와 “완전한 0 runtime
overhead”는 동시에 만족할 수 없다. 따라서 `Pause`와 `Disable on next
start`를 분리하는 2단계 모델이 가장 명확하다.

결정이 필요한 것:

- disabled가 manifest 생성과 MCP 조회까지 끌지, 브라우저 runtime만
  끌지.
- global disable만 제공할지, 프로젝트별 override도 허용할지.
- UI 문구와 재활성화 경로.

## 권장 구현 순서

각 항목을 독립적인 RED → GREEN 작업으로 나눈다.

1. ~~package, repository/folder, public branding을 `astro-inspector`
   기준으로 변경한다.~~ 완료.
2. 전역 settings schema에 pending `enabledMode` 확장 경로와 lifecycle을
   설계한다.
3. ~~라벨 viewport flip/clamp와 toast animation을 각각 독립 작업으로
   처리한다.~~ 완료.
4. ~~색상 preset UI와 overlay theme 적용을 구현한다.~~ 완료.
5. ~~`Parent Levels`와 다중 parent box pool을 구현한다.~~ 완료.
6. ~~`Copy As` UI와 clipboard payload를 구현한다.~~ 완료.
7. ~~compact token alias와 MCP backward compatibility를 구현한다.~~ 완료 — 서버 순번 발급으로 alias 없이 교체.
8. `Pause`를 먼저 구현하고, true zero-load disable은 integration
   lifecycle을 별도 설계한 뒤 구현한다.

## 공통 회귀 기준

- locator 활성화 중에만 hit resolution이 실행된다.
- hover resolution은 `requestAnimationFrame`당 최대 한 번이다.
- pseudo-element, real overlay, `pointer-events:none`, SVG, React island,
  `display: contents`, 반복 목록 회귀를 유지한다.
- hash/alias가 가리키는 file, source tag, DOM tag, line/column이
  manifest와 MCP에서 일치한다.
- 설정은 프로젝트와 worktree에 관계없이 전역으로 공유하되, 실행 중인
  모든 dev server에 실시간 broadcast하는 기능은 만들지 않는다.
- 설정 변경 후 새로 시작한 dev server에서 값이 반영되면 충분하다.
- production output에는 locator metadata와 client UI가 남지 않는다.
- 모든 motion은 `prefers-reduced-motion`을 존중한다.

### 8. leaf·호출부 동시 보고 (`data-astro-ai-locator-origin-*`) — 보류

래퍼 hash 붕괴(2026-08-04)를 고치면서 검토했다가 접은 안이다. 컴포넌트 태그에는
`origin-*` 이름으로 따로 주입하면 leaf 정의 위치와 호출부를 **둘 다** 들고 갈 수
있다. manifest·MCP 응답·오버레이 복사가 두 지점을 함께 돌려주는 그림이다.

지금 넣지 않은 이유:

- 실제 버그는 "호출부가 사라진다" 였고, 그건 주입 위치 교정만으로 끝난다.
- primary 속성의 의미가 호출부에서 leaf 로 뒤집힌다. `sourceTag→domTag` 라벨이
  이미 "호출부 컴포넌트 → 렌더된 태그" 를 표현하도록 설계돼 있어 계약이 흔들린다.
- 루트 밖 래퍼는 leaf 가 주입되지 않아 `origin-*` 만 남는다. 선택 selector·라벨·
  등록 payload·manifest schemaVersion·MCP 툴 설명이 전부 따라 움직여야 한다.

leaf 정의 위치를 실제로 요구하는 사용례가 생기면 그때 비파괴적으로 얹는다.

### 9. 중복 속성 바이트 — 측정 후 판단

forwarding 래퍼 한 단계마다 무시되는 `data-astro-ai-locator-*` 3개가 dev HTML 에
남는다. spread 는 런타임에 풀리므로 컴파일 타임 dedup 은 불가능하고, 클라이언트
dedup 은 이미 파서가 버린 값이라 의미가 없다. dev 전용이고 production 에는
남지 않으므로 현재는 방치한다. 실제 페이지에서 문제될 만한 크기가 관측되면
그때 다룬다.

## ⚠️ 현재 미검토·위험

- 실사용 레포 수동 QA 는 2026-08-03 기준 **아직 수행하지 않았다.** 0.2.0 에서 나온 세 건(클라이언트 격리,
  프록시 경유 엔드포인트, 하이드레이션 경고)을 픽스처가 모두 놓쳤으므로, 0.3.0 배포 전에 실제 소비 레포에서
  세 항목을 눈으로 확인해야 한다. 앞으로 실사용 경로에서만 재현되는 회귀는 픽스처에 합성 재현을 먼저 심는다.
- multi-project MCP 범위는 여전히 범위 밖이다. 순번 토큰의 교차 오인은 랜덤
  시작점과 태그 재검증으로 완화했지만 구조적 격리는 아니다.
- true zero-load disable은 현재 runtime toggle의 작은 개선이 아니라
  Astro integration의 transform/injection lifecycle 변경이다.

## 다음 세션 시작점

1. 이 문서를 읽는다.
2. `src/shared/contracts.ts`, settings endpoint, `src/client/settings-panel.ts`,
   `src/client/overlay.ts`의 현재 책임을 다시 확인한다.
3. 한 번에 모든 설정을 구현하지 않는다.
4. npm package name 사용 가능 여부를 확인하고 public rename 범위를 먼저
   확정한다.
5. 그다음 작업은 `Pause`/disable lifecycle 설계로 제한한다.
