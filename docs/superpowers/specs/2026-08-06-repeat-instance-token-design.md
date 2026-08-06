# 반복 인스턴스 식별 — 설계

> 2026-08-06 · brainstorming 세션 결과. 대상 릴리스 0.7.0.

## 목적

목록처럼 한 호출부가 여러 DOM 인스턴스를 찍는 자리에서, 집은 것이 **몇 번째 항목인지**를
토큰과 복사 payload 가 구분하게 만든다.

## 배경 — 지금은 왜 못 하나

토큰 신원은 `file + line + column + sourceTag` 네 값뿐이다(`manifest/store.ts` `identityOf`).
등록 payload 에도 그 네 값과 `domTag` 만 실린다(`client/index.ts`).

```
{items.map((item) => <Link href={item.href}>{item.name}</Link>)}
```

이 한 줄이 카드 20개를 찍으면, 20개 `<a>` 가 모두 같은 좌표를 들고 있다. 3번째를 집든
17번째를 집든 서버에 도착하는 값이 같으므로 같은 토큰이 나오고, MCP 응답도 같은 한 줄을
가리킨다. Context 복사 문자열에도 항목을 특정할 정보가 없다.

소스에서 서로 다른 요소(카드의 제목·전화·뱃지)는 지금도 좌표가 달라 구분된다. 못 하는 것은
**같은 요소의 반복 인스턴스**뿐이다.

## 결정 사항

### 1. 반복일 때만 동작한다

문서 안에 `file + loc + sourceTag` 가 같은 요소가 **2개 이상**일 때만 인스턴스 정보를 붙인다.
단일 요소는 라벨·토큰·Context·MCP 응답이 지금과 완전히 같다. 반복이 아닌 자리에 `#1` 같은
군더더기를 남기지 않기 위해서다.

### 2. 두 값을 클라이언트가 만든다

| 값 | 산정 | 쓰임 |
| --- | --- | --- |
| `instance` | 같은 좌표를 가진 요소들의 **문서 순서 1-based** | 토큰 신원에 포함 |
| `instanceLabel` | 자기 `textContent`, 비어 있으면 가장 가까운 **반복 경계 조상**의 텍스트. 공백을 하나로 접고 앞 40자 | 호버 라벨·Context·MCP 응답 |

"반복 경계 조상"은 클릭한 요소에서 위로 올라가며 만나는, 그 자신도 반복 인스턴스인 첫
조상이다. 카드 안 아이콘 버튼을 집어도 카드 제목이 잡히도록 하는 장치다.

`instance` 만 신원에 넣는다. 텍스트는 데이터가 바뀌면 따라 변하므로 신원에 넣으면 같은 자리의
토큰이 이유 없이 갈린다.

### 3. 서버는 인스턴스를 검증할 수 없다

등록 핸들러는 `line:column` 이 실제로 그 `sourceTag` 를 가리키는지 소스를 열어 재검증한다.
`instance` 와 `instanceLabel` 에는 그런 대조군이 없다 — 클라이언트의 주장이다.

받아들이는 이유: dev 전용이고 세션 토큰으로 인증된 요청이며, 값이 틀려도 결과는 "힌트가
어긋난 토큰" 하나다. 대신 zod 로 형태만 좁힌다 — `instance` 는 양의 정수, `instanceLabel` 은
길이 상한이 있는 문자열. 둘은 함께 오거나 함께 없어야 한다.

### 4. 표기 — 사람에겐 텍스트, 기계에겐 둘 다

```
라벨      <Link→a>│list.astro│42:7│강남 A병원
Context   <Link→a> | /src/pages/list.astro:42:7 | 강남 A병원
Hash      #a7k9        (카드마다 다른 토큰)
MCP 응답  { ..., instance: 3, instanceLabel: "강남 A병원", excerpt: ... }
```

화면에 순번을 노출하지 않는 이유: 목록 정렬이 바뀌면 순번은 다른 항목을 가리키는데, 라벨에
`#3` 이 찍혀 있으면 그 값이 항목의 성질처럼 읽힌다. 에이전트는 `instance` 와
`instanceLabel` 을 함께 받으므로 어긋남을 스스로 판단할 수 있다.

Context 는 `contextFields` 설정과 무관하게 반복일 때 자동으로 붙인다. 토글을 늘리지 않는다.

### 5. 수집은 트리거 키를 누를 때 한 번

호버마다 `querySelectorAll` 로 세지 않는다. 트리거 키를 누르는 시점에 문서를 한 번 훑어
좌표별 그룹을 만들고 `Map<Element, {instance, total}>` 로 들고 있다가, 키를 떼면 버린다.
호버와 클릭은 이 캐시만 읽는다.

## 변경 범위

| 파일 | 변경 |
| --- | --- |
| `src/shared/contracts.ts` | `RegisterElementRequest`·`LocatorManifestEntry` 에 선택 필드 2개, `LocatorManifest.schemaVersion` 2 → 3 |
| `src/manifest/schema.ts` | 두 필드의 zod 검증, 함께 오거나 함께 없음 |
| `src/manifest/store.ts` | `identityOf` 에 `instance` 포함 |
| `src/integration/request-handler.ts` | 새 필드를 엔트리에 전달 |
| `src/client/repeat-instances.ts` (신규) | 수집·순번·라벨 텍스트 추출 |
| `src/client/index.ts` | 트리거 키 시점 수집, payload 에 두 필드 |
| `src/client/overlay.ts` | 라벨 우측 세그먼트 |
| `src/client/clipboard-payload.ts` | Context 에 항목 텍스트 |
| `src/mcp/resolve-element.ts` | 응답에 두 필드 |
| `README.md`, MCP 툴 설명 | 동작 문서화 |

## 테스트

| 층 | 내용 |
| --- | --- |
| unit | 순번 산정(문서 순서), 텍스트 추출(자기 텍스트 / 조상 폴백 / 40자 절단 / 공백 접기), 단일 요소면 두 값 모두 `undefined` |
| unit | `identityOf` 가 instance 로 갈린다, 같은 인스턴스 재클릭은 같은 토큰 |
| unit | zod: 한쪽만 오면 거부, 음수·0 거부, 과한 길이 거부 |
| unit | MCP 응답에 두 필드가 실린다 / 없으면 빠진다 |
| e2e | 목록의 1번째와 3번째 카드가 **다른 토큰**을 준다 |
| e2e | 라벨 우측에 항목 텍스트가 보이고, 반복 아닌 요소엔 안 보인다 |
| e2e | Context 복사에 항목 텍스트가 붙는다 |

픽스처에는 같은 호출부에서 카드 3개를 찍는 목록과, 카드 안에 텍스트 없는 아이콘 버튼을
하나 넣는다. 조상 폴백은 이 버튼으로 검증한다.

## 범위 밖

- 화면에 순번 노출
- 목록 정렬 변경 추적 — 순번은 클릭 시점의 문서 순서일 뿐이다
- Context 필드 토글 추가
- 인스턴스 정보의 서버 측 진위 검증
