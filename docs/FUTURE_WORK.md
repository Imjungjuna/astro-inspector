# Astro AI Locator — Future Work

> 2026-07-28 기록 · 다음 작업 세션의 기준 문서
>
> 현재 기준선: 개발 서버에서 Astro/React DOM을 추적하고, 트리거 키를
> 누른 채 호버하면 전체 요소·가장 가까운 메타데이터 조상·현재 요소를
> 구분해 표시한다. 클릭 시 locator hash를 복사하고 MCP가 manifest
> entry를 조회한다. 마지막 `npm run verify`에서 unit 62개, MCP integration
> 1개, E2E 13개, production output 1개와 TypeScript build가 통과했다.

## 다음 구현 후보

### 1. UI 색상 프리셋

팝오버의 `Overlay Color` 칩을 실제 설정 컨트롤로 만든다.

- 칩 클릭 시 선택한 색상을 전역 설정에 저장한다.
- 선택된 트리거 행의 keycap 또는 SVG `fill`에 선택 색상을 적용한다.
- locator의 현재 요소 테두리·채움과 부모 테두리에 같은 색상 계열을
  적용한다.
- 행 hover 배경도 선택 색상에서 파생하되, 텍스트 대비와 현재의
  반투명 dark popover 분위기는 유지한다.
- 고정 preset부터 시작하고 자유 색상 선택기는 나중으로 미룬다.

결정이 필요한 것:

- 색상이 적용될 정확한 대상: keycap만인지, fox SVG도 포함하는지.
- 부모 경계는 현재 요소와 같은 hue만 공유할지, 별도 neutral color로
  둘지.
- preset 목록과 각 preset의 border/fill/hover 알파값.

### 2. 표시할 메타데이터 조상 개수

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

### 3. 더 짧은 locator token

현재 공개 형식은 `astro_hash_` + 24자리 hex다. 복사·붙여넣기용 표현을
더 짧게 만든다.

주의:

- 충돌 범위는 “현재 화면의 요소 수”가 아니라 manifest 전체 entry다.
- 여러 프로젝트 manifest를 한 MCP가 다루거나 이전 manifest가 남는
  경우까지 고려해야 한다.
- `a#...`는 채팅에 붙여넣기는 편하지만 shell에서는 `#`가 주석으로
  해석될 수 있다.

권장 방향:

1. 내부 stable hash는 당분간 유지한다.
2. 64-bit 이상을 base64url 또는 base36으로 표현한 짧은 public alias를
   추가한다.
3. MCP는 마이그레이션 기간 동안 기존 hash와 새 alias를 모두 받는다.
4. manifest schema version을 올리고 alias collision을 생성 시점에
   검증한다.
5. 충분히 검증한 뒤 clipboard 기본값만 새 alias로 바꾼다.

결정이 필요한 것:

- prefix: `a#`, `a:`, `a_` 중 하나.
- 목표 길이와 허용 가능한 충돌 확률.
- 기존 hash 지원 기간과 manifest migration 방식.

### 4. 복사할 정보 선택

팝오버에 `Copy As` 설정을 추가한다.

후보:

- `Locator token` — 기본값. MCP가 entry를 정확히 찾는다.
- `Module` — source component/tag 이름을 복사한다.
- `File` — 파일명 또는 프로젝트 상대 경로를 복사한다.
- `Location` — `relative/path/File.tsx:line:column`을 복사한다.

결정이 필요한 것:

- “모듈명”을 source tag, 파일 stem, import specifier 중 무엇으로 볼지.
- `File`이 basename인지 프로젝트 상대 경로인지.
- hash가 아닌 값을 붙여넣었을 때 MCP도 직접 resolve해야 하는지, 아니면
  AI에게 읽기 쉬운 문자열만 제공할지.

권장 기본값은 계속 `Locator token`이다. 파일명만 복사하면 같은 이름의
파일이나 한 파일 안의 반복 요소를 구분할 수 없기 때문이다.

### 5. 클릭 토스트 디자인

현재 기능 토스트를 짧고 명확한 “pop” 모션으로 바꾼다.

- 등장: 작은 scale/translate와 opacity를 조합해 빠르게 튀어나오는 느낌.
- 짧은 overshoot 후 정착하고, 잠시 유지한 뒤 부드럽게 퇴장한다.
- 복사 모드와 실제 복사값 일부를 표시한다.
- FAB·팝오버와 겹치지 않도록 위치를 계산한다.
- `prefers-reduced-motion`에서는 scale/overshoot를 제거한다.
- 연속 클릭 시 이전 timer와 animation을 안전하게 재시작한다.

### 6. 호버 라벨 viewport clipping 방지

현재 요소 라벨이 화면 가장자리에서 잘리지 않도록 배치 로직을 보강한다.

- 기본 위치는 현재처럼 요소 위.
- 상단 공간이 부족하면 요소 아래로 flip.
- 좌우는 viewport padding 안으로 clamp.
- 최대 너비와 ellipsis는 유지.
- 현재 요소에 라벨 하나만 표시하는 원칙은 유지.
- scroll, resize, 아주 작은 viewport, 긴 경로, 화면 네 모서리를
  회귀 테스트한다.
- hit resolver, hash, clipboard, MCP에는 손대지 않는다.

### 7. Locator 비활성화

우클릭만으로 제거하는 UI는 권장하지 않는다. 발견하기 어렵고 keyboard
접근성이 없으며 브라우저 기본 context menu와 충돌한다.

권장 UI:

- 팝오버 `Preferences`에 명시적인 `Locator Enabled` toggle을 둔다.
- FAB 우클릭은 같은 동작의 보조 shortcut으로만 고려한다.
- 상태와 다시 켜는 방법을 toast 또는 행 설명으로 알려준다.

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

1. 전역 settings schema를 versioning하고 `colorPreset`,
   `parentLevels`, `copyMode`, `enabledMode` 확장 경로를 만든다.
2. 라벨 viewport flip/clamp와 toast animation을 각각 독립 작업으로
   처리한다.
3. 색상 preset UI와 overlay theme 적용을 구현한다.
4. `Parent Levels`와 다중 parent box pool을 구현한다.
5. `Copy As` UI와 clipboard payload를 구현한다.
6. compact token alias와 MCP backward compatibility를 구현한다.
7. `Pause`를 먼저 구현하고, true zero-load disable은 integration
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

## ⚠️ 현재 미검토·위험

- 실제 소비 프로젝트에서 오늘의 마지막 `│` 라벨 변경 이후 수동 QA는
  아직 이 문서 작성 시점에 기록되지 않았다.
- package directory는 `/Users/jungjun`의 상위 Git 저장소에서 전체가
  untracked 상태다. 현재 변경을 되돌릴 commit 기준점이 없으므로 npm
  공식 배포 전에 독립 Git 저장소 생성 또는 정상 저장소 편입이 필요하다.
- compact token의 충돌 확률과 multi-project MCP 범위는 아직 설계·측정하지
  않았다.
- true zero-load disable은 현재 runtime toggle의 작은 개선이 아니라
  Astro integration의 transform/injection lifecycle 변경이다.

## 다음 세션 시작점

1. 이 문서를 읽는다.
2. `src/shared/contracts.ts`, settings endpoint, `src/client/settings-panel.ts`,
   `src/client/overlay.ts`의 현재 책임을 다시 확인한다.
3. 한 번에 모든 설정을 구현하지 않는다.
4. 첫 작업은 settings schema versioning 설계 또는 라벨 viewport
   clipping 회귀 테스트 중 하나로 제한한다.
