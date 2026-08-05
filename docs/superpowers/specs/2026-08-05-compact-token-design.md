# Compact Locator Token — 설계

> 2026-08-05 · brainstorming 세션 결과. 대상 릴리스 0.4.0.

## 목적

클릭 시 클립보드에 들어가는 locator 토큰을 `astro_hash_` + 24 hex(35자)에서 5자로 줄인다.
동기는 채팅창 시각 노이즈다. 35자 토큰은 문장 안에서 줄바꿈을 깨고 눈에 거슬린다.

## 배경 — 왜 해시가 더 이상 필요 없는가

원래 해시(내용에서 결정론적 유도)의 이득은 "dev 서버를 재기동해도 같은 요소면 같은
토큰"이다. 현재 코드는 이 이득을 이미 버렸다:

- `store.reset()`이 dev 서버 기동마다 manifest를 비운다 (`vite-plugin.ts`).
- `handleHotUpdate` → `removeByFile`이 파일 저장마다 그 파일 엔트리를 지운다.

즉 재기동·저장 후에는 해시든 번호든 복사해둔 토큰이 똑같이 죽는다(`Unknown token`).
토큰의 실수명은 "클릭 → 그 파일 저장 또는 서버 재기동까지"로 몇 분이다.

또한 manifest는 `MAX_ENTRIES = 100`으로 캡되어 있어(2026-08-03 manifest cap 커밋)
충돌 모집단이 "동시에 살아있는 100개"뿐이다. FUTURE_WORK #3이 전제한
"충돌 범위는 manifest 전체 entry, 여러 프로젝트·이전 manifest까지 고려"는 무효다.
따라서 alias 이중 지원·마이그레이션 기간 없이 포맷을 교체한다.

서버가 이미 `Map`으로 전체 엔트리를 들고 있으므로, 내용 해시 대신 서버가 번호를
발급하면 중복이 구조적으로 불가능하다. 충돌 확률 계산 자체가 사라지고, 길이를
정하는 것은 엔트로피가 아니라 "한 세션의 클릭 수"가 된다.

## 결정 사항

### 1. 토큰 포맷

`#a` + base36 소문자 3자리 = **5자 고정**. 예: `#a7k9`, `#a03m`.

- 정규식: `^#a[0-9a-z]{3}$`
- 세션당 용량: 36³ = 46,656 (수동 클릭으로 도달 불가능한 수준)
- `#`는 CommonMark ATX 제목 규칙상 뒤에 공백이 없으면 제목이 되지 않으므로
  마크다운 채팅에서 안전하다. 유일한 주의점은 셸 주석 — README에 명시한다.
- `astro_hash_` 접두사, sha256, `createElementHash`는 삭제한다.
  `hash.ts`에서 `normalizeRelativeFile`/`toProjectRelativeFile`만 남긴다.

### 2. 발급 규칙 — 서버 순번 + 랜덤 시작점

- dev 서버 기동 시 `nextIndex`를 `[0, 46656)`에서 랜덤으로 정한다.
- 발급마다 +1, 46655 다음은 0으로 랩한다.
- 한 세션에서 46,656개를 모두 발급하면 명확한 에러를 던진다
  (재시작 안내 포함). 랩 후 번호 재사용으로 조용히 덮어쓰지 않는다.
- 같은 요소(동일 identity)를 재클릭하면 새 번호를 소비하지 않고 기존 토큰을
  돌려준다.

랜덤 시작점이 세션 솔트 역할을 한다. 워크트리 A·B가 각각 최대 100개를 쓸 때
B의 토큰이 A에서도 우연히 유효할 확률은 약 100/46656 ≈ 0.2%다. 전용 솔트
문자 1자리(1/36 ≈ 2.8%)보다 낮고 글자를 소비하지 않는다.

### 3. ManifestStore 변경

```
issue(entry: LocatorManifestEntry): Promise<string>   // 기존 upsert 대체
private tokensByIdentity: Map<string, string>          // identity → token 역인덱스
private nextIndex: number                              // [0, 46656), 랜덤 시작
private issuedCount: number                            // 고갈 감지용
```

- identity = `file\0line\0column\0domTag` — 기존 해시 입력과 같은 튜플.
- `issue`: 역인덱스에 있으면 기존 토큰 반환(+ LRU 갱신). 없으면 다음 번호로
  토큰을 만들어 entries·역인덱스에 넣는다.
- **evict와 `removeByFile`은 역인덱스에서도 같이 지운다.** 지우지 않으면 manifest
  에서 사라진 죽은 토큰을 계속 돌려준다.
- 기존 해시 충돌 throw(`Locator hash collision`)는 발급 주체가 서버라 불가능해
  지므로 삭제한다.

### 4. 교차 오인 2차 방어 — MCP 태그 검증

순번 토큰은 전역 유일성이 없다. 다른 프로젝트의 `#a7k9`를 던지면 에러 대신
엉뚱한 요소로 해석될 수 있다(조용한 오답). 완화:

- `resolve-element.ts`에 등록 시와 같은 검증을 추가한다: manifest 엔트리의
  `line:column` 위치가 실제 소스에서 `<sourceTag`로 시작하고 그 뒤가
  `[\s/>]` 경계인지 확인. 불일치 시 throw.
- `request-handler.ts:76`의 등록 시 검사와 동일 로직 — 지금 빠져 있던 등록/해석
  간 대칭성도 메운다.
- 남는 위험: 랜덤 시작점(0.2%)과 태그 검증을 모두 뚫는 경우뿐이다.

### 5. 이름 변경 — hash → token

해시가 아닌 것을 hash라 부르지 않는다.

- MCP 툴명: `get_astro_element_by_hash` → `get_astro_element_by_token`
- 응답·요청 필드 `hash` → `token` (`RegisterElementResponse`, resolve 결과)
- `HASH_PREFIX` → `TOKEN_PREFIX = "#a"`
- 토큰 정규식 3곳 교체: `schema.ts`, `resolve-element.ts`, `client/index.ts`
- `mcp-prompt.ts`·`server.ts`의 모델 유도 문구를 새 포맷으로
  ("`#a` 뒤 base36 3자리 토큰이 보이면 이 툴을 호출")

외부 소비자는 없다. 툴명은 MCP 클라이언트가 런타임에 발견하고, 클라이언트·
서버·MCP가 같은 설치본에서 나온다.

### 6. 프로토콜·호환

- manifest `schemaVersion`: 1 → **2**. 키 형식이 바뀌므로 올린다. 구버전
  manifest를 신버전 MCP가 읽으면 regex 불일치의 모호한 에러 대신 schema
  버전 불일치로 명확히 죽는다.
- `data-astro-ai-locator-*` DOM 속성, `.astro-ai-locator/` 디렉토리 경로는
  변경하지 않는다 (1층 — 이번 작업 범위 밖).
- 마이그레이션 없음. dev 전용이고 manifest는 기동마다 리셋된다.
- 릴리스: **0.4.0**. 0.3.0(실사용 버그픽스)은 main에 머지 완료된 상태에서
  분리 릴리스한다.

### 7. 테스트

- `manifest-store`: 같은 entry 재발급 시 동일 토큰 / 서로 다른 entry는 서로
  다른 토큰 / evict 후 번호 재사용 없음 / `removeByFile`이 역인덱스도 비움 /
  46,656 고갈 시 에러 / 토큰 포맷 `^#a[0-9a-z]{3}$`
- `resolve-element`: 태그 불일치 manifest 엔트리에서 throw (신규)
- 기존 `astro_hash_` 리터럴·정규식 단언 전량 교체 (unit 5파일, e2e 9곳,
  integration 1곳)
- README: 예시 토큰 교체 + "`#`로 시작하므로 셸에 붙여넣으면 주석 처리된다"
  1줄 추가

## 범위 밖 (하지 않는 것)

- 1층(DOM 속성)에 짧은 번호를 미리 박는 것 — manifest가 페이지 전 요소로
  폭발하고, 편집 시 번호가 밀려 조용한 오답을 만든다. 현행 "클릭 시 발급"이
  스테일을 자동 무효화하는 구조라 유지한다.
- 여러 프로젝트를 한 MCP로 다루는 멀티 루트 지원.
- Copy As Context 모드 변경 — 위치 문자열 복사는 그대로 둔다.
