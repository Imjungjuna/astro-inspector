# astro-ai-locator

Astro 개발 페이지에서 UI 요소를 선택해 해시를 복사하고, 그 해시를 MCP로
실제 `.astro`, `.tsx`, `.jsx` 소스 코드에 연결합니다.

브라우저 확장 프로그램이나 에디터 전용 딥링크는 필요하지 않습니다.

## Install

Node.js 22.12 이상과 Astro 7이 필요합니다.

```bash
npm install --save-dev astro-ai-locator
```

## Astro setup

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import { astroAiLocator } from "astro-ai-locator";

export default defineConfig({
  integrations: [astroAiLocator()]
});
```

`astro dev`를 실행한 뒤:

1. 현재 트리거 키를 누른 채 요소 위로 이동합니다. 최초 기본값은
   `Alt`(macOS에서는 `Option`)입니다.
2. 희미한 회색 전체 경계, 낮은 명도의 보라색 실선 부모 경계, 현재 대상의 보라색
   실선 오버레이를 확인합니다.
3. 요소를 클릭합니다.
4. `astro_hash_0123456789abcdef01234567` 형태의 값이 클립보드에
   복사됩니다.
5. MCP가 연결된 CLI나 ACP 채팅에 해시를 붙여 넣고 변경을 요청합니다.

개발 페이지의 좌측 하단에는 반투명 회색 원형 여우 버튼이 항상
표시됩니다. 버튼을 클릭하면 배경 블러가 적용된 반투명 회색 고밀도 설정
팝오버가 열리고, 28px 높이의 세로 목록에서 트리거를 `Control`,
`Option / Alt`, `Command / Meta` 중 하나로 바꿀 수 있습니다. 현재
선택된 키는 작은 보라색 키캡으로 구분되고, 포인터가 올라간 행은 밝은
회색으로 표시됩니다. 트리거 키를 누르거나 놓는 동작은 팝오버를 열거나
닫지 않습니다. 다른 modifier가 함께 눌린 조합은 로케이터가 가로채지
않습니다.

여우 버튼을 드래그하면 팝오버와 함께 이동하며 위치가 브라우저에
저장됩니다. 팝오버는 바깥 영역을 클릭하거나 `Escape`를 눌러 닫을 수
있고, 페이지를 다시 불러오면 닫힌 상태로 시작합니다. `Preferences`의
`Overlay Color` 칩은 향후 테마 기능을 위한 미리보기이며 아직 클릭 동작은
없습니다.

모든 경계를 표시하지 않으려면 현재 대상 오버레이만 사용할 수 있습니다.

```js
integrations: [astroAiLocator({ showAllBoundaries: false })]
```

## MCP setup

MCP 호스트에 프로젝트 로컬 stdio 명령을 등록합니다. `project-root`는
Astro 프로젝트의 절대 경로여야 합니다.

```json
{
  "command": "npx",
  "args": [
    "--no-install",
    "astro-ai-locator-mcp",
    "--project-root",
    "/absolute/path/to/your/astro-project"
  ]
}
```

호스트가 Astro 프로젝트 밖에서 명령을 실행한다면 `command`에
`/absolute/path/to/your/astro-project/node_modules/.bin/astro-ai-locator-mcp`
를 직접 지정할 수 있습니다.

프롬프트에 `astro_hash_` 값이 포함되면 모델은
`get_astro_element_by_hash` 도구를 호출해 다음 정보를 가져올 수
있습니다.

- 프로젝트 기준 파일 경로와 검증된 절대 경로
- 줄, 열, 소스 태그와 렌더된 DOM 태그
- 선택 위치 주변 코드

전체 소스는 MCP 응답에 포함하지 않습니다. 연결된 로컬 CLI나 ACP가
필요할 때 검증된 파일 경로에서 필요한 범위만 읽도록 합니다.

## How it works

개발 모드에서 Astro Integration은 Vite 플러그인과 작은 브라우저
클라이언트를 설치합니다. 플러그인은 Astro/React 컴파일 전에 프로젝트
루트 안의 `.astro`, `.tsx`, `.jsx` 태그에 소스 위치를 주입합니다.
React island가 hydrate된 뒤에도 이 `data-*` 속성은 실제 DOM에 남습니다.
브라우저가 선택된 위치를 로컬 개발 endpoint에 보내면 서버는 결정적
해시를 만들고 매니페스트에 기록합니다. 독립적인 stdio MCP 서버는 그
매니페스트를 읽어 해시를 소스 코드로 되돌립니다.

브라우저에서는 `document.elementsFromPoint()`로 포인터 위치의 DOM
스택을 얻고 메타데이터 후보를 중복 제거합니다. 포인터를 포함하는 실제
렌더링 박스의 면적, DOM 깊이, 브라우저 stack 순으로 비교해 가장 구체적인
요소를 선택합니다. Locator 활성화 중에는 `::before`와 `::after`가 hit
testing을 가로채지 않게 하며, 브라우저 hit stack에서 제외되는
`pointer-events: none` 요소도 활성화 시 한 번 수집해 같은 후보 평가에
포함합니다. 따라서 실제 DOM overlay나 stretched link 뒤의 요소와
중첩된 React JSX 자식도 정확한 소스 위치로 선택할 수 있습니다.

Locator가 활성화되면 추적 가능한 전체 요소는 희미한 회색 점선으로
표시됩니다. 현재 요소에서 메타데이터가 있는 가장 가까운 조상은 채움과
라벨 없는 40% 명도의 2px 보라색 실선으로 표시되며, 현재 경계에 가려지지 않도록 조상
박스 바깥 2px에 그려집니다. 현재 요소는 10% 채움과 2px 보라색 실선으로
구분됩니다. 호버 라벨은 현재 요소에만
`<소스태그→DOM태그> │ 파일명 │ 줄:열` 형태로 표시합니다. 파일명은
확장자를 포함하고 두 태그가 같으면 화살표를 생략합니다. 전체 프로젝트
상대 경로는 DOM 메타데이터와 매니페스트 및 MCP 결과에 그대로 유지됩니다.

같은 `.astro` 태그가 반복 렌더링된 경우 DOM 인스턴스들은 같은 해시를
공유합니다. 해당 파일이 HMR로 변경되거나 삭제되면 기존 해시는
무효화됩니다.

## Runtime files

프로젝트별 선택 매니페스트는 다음 위치에 생성됩니다.

```text
.astro-ai-locator/manifest.json
```

소비하는 프로젝트의 `.gitignore`에 아래 경로를 추가하세요.

```gitignore
.astro-ai-locator/
```

트리거 키는 프로젝트 밖의 사용자 전역 설정에 저장되므로 모든 저장소와
worktree가 같은 값을 사용합니다.

```text
~/.astro-ai-locator/settings.json
```

브라우저가 이 파일에 직접 접근하지는 않습니다. 페이지 로드 시 인증된
로컬 Vite endpoint를 한 번 호출하고, Vite 프로세스가 파일을 읽거나
원자적으로 저장합니다. 현재 페이지의 변경은 즉시 적용되고, 이미 열려
있는 다른 페이지는 새로고침할 때 최신 값을 읽습니다. 파일이 없거나
손상되었으면 `Option/Alt`로 복구하며, 실제 설정 변경 전에는 파일을
만들지 않습니다.

## Scope

- 개발 모드 전용입니다. 프로덕션 빌드에는 클라이언트, endpoint,
  소스 메타데이터를 주입하지 않습니다.
- `.astro` 템플릿과 프로젝트 루트 안의 React `.tsx`, `.jsx`를
  지원합니다. `client:load`, `client:only="react"` 같은 hydrated island
  내부의 중첩 JSX 요소도 개별적으로 선택할 수 있습니다.
- Astro/React 컴포넌트 호출부에도 메타데이터를 넣습니다. 컴포넌트가
  받은 `data-*` props를 실제 DOM 루트로 전달하면 호출부를 선택할 수
  있습니다.
- 프로젝트 루트 밖의 모노레포 UI 패키지 소스는 직접 변환하지 않습니다.
  이 경우 앱 내부 호출부의 `data-*` props를 DOM으로 전달하는
  컴포넌트만 호출부 기준으로 선택됩니다.
- Vue, Svelte 등 다른 framework island 내부의 세부 소스 추적은 아직
  지원하지 않습니다.
- 클립보드 권한이 거부되면 수동 복사를 위한 브라우저 prompt로
  대체합니다.
- `Command/Meta`의 OS 예약 단축키와 같이 브라우저 페이지가 전달받지
  못하는 키 조합은 로케이터도 가로챌 수 없습니다.
- 프로젝트 디렉터리마다 Astro 개발 서버 하나를 사용하는 것을
  전제로 합니다.

## Security

개발 endpoint들은 프로세스마다 새로 생성되는 토큰을 요구합니다. 요소
등록 endpoint는 요청 본문과 소스 파일 크기를 제한하고, 프로젝트 루트
내부의 실제 `.astro` 또는 `.tsx`, `.jsx` 파일과 유효한 줄·열만
받습니다. 설정 endpoint는 세 가지 허용된 modifier만 읽고 씁니다.

MCP 서버도 매니페스트와 소스 경로를 `realpath`로 정규화해 traversal과
심볼릭 링크 탈출을 차단합니다. stdio의 `stdout`은 MCP 프로토콜에만
사용하고 진단 메시지는 `stderr`에 기록합니다.

## Current limitations

- 해시는 파일 경로, 줄, 열, DOM 태그로 만들어지므로 해당 태그의 위치나
  렌더된 DOM 종류가 바뀌면 새 해시가 생성됩니다.
- Astro의 컴파일러 AST 구조가 바뀌는 메이저 버전은 별도 호환성 검증이
  필요합니다.
- MCP SDK 1.29의 HTTP 보조 의존성에는 Windows `serve-static` 경로에
  관한 moderate advisory가 있습니다. 이 패키지는 해당 HTTP 서버를
  노출하지 않고 로컬 stdio transport만 사용합니다.
- 이 버전은 소스 조회만 제공합니다. 파일 수정 권한과 실제 코드 변경은
  연결된 AI 호스트가 담당합니다.
