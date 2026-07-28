# Release Checklist — npm publish 전 필수 작업

> 2026-07-28 기록 · GitHub 공개 저장소 등록 직후 작성
>
> 저장소: https://github.com/Imjungjuna/astro-ai-locator (Public)
>
> 이 문서는 "공개 저장소에 올라갔지만 아직 남의 손에서 동작하지 않는 것"만
> 다룬다. 기능 로드맵은 [FUTURE_WORK.md](./FUTURE_WORK.md) 참조.

## 🔴 P0 — 지금 clone하면 깨지는 것

### 1. `package.json` devDependencies 자기 참조 절대경로

```json
"astro-ai-locator": "file:/Users/jungjun/astro-ai-locator"
```

**증상.** 다른 사람이 clone 후 `npm install`을 실행하면 해당 경로가 존재하지
않아 설치가 실패한다. CI에서도 동일하게 실패한다.

**왜 이렇게 됐나.** 테스트 fixture가 빌드된 패키지를 실제 소비자처럼
import하기 위해 로컬 링크가 필요했고, 개발 중에는 절대경로가 동작했다.

**수정 후보.**

| 방법 | 내용 | 주의 |
| --- | --- | --- |
| `"file:."` | 저장소 루트를 상대경로로 자기 참조 | npm이 자기 자신을 `node_modules/astro-ai-locator`로 심볼릭 링크. 가장 간단 |
| devDependency 제거 | fixture가 `dist/`를 직접 상대경로 import | `tests/fixtures/basic/astro.config.mjs`의 import 경로 수정 필요 |
| npm workspaces | fixture를 workspace로 승격 | 구조 변경 폭이 가장 큼 |

권장은 `"file:."`. 다만 변경 후 반드시 아래를 확인한다.

- `rm -rf node_modules package-lock.json && npm install`이 통과하는지
- `npm run verify` 전체(unit 62 / MCP integration 1 / E2E 13 / production
  output 1 / build)가 여전히 통과하는지
- fixture의 `astro-ai-locator` import가 여전히 `dist/`를 가리키는지

### 2. npm에 미발행

```
npm view astro-ai-locator  →  E404 Not Found
```

**증상.** README가 `npm install --save-dev astro-ai-locator`를 안내하는데
패키지가 레지스트리에 없다. 저장소를 방문한 사람이 첫 명령에서 막힌다.

**순서.**

1. P0-1을 먼저 고친다. `prepublishOnly`가 `npm run verify`를 실행하므로
   설치가 깨진 상태로는 publish 자체가 실패한다.
2. 이름을 확정한다. FUTURE_WORK.md의 "0. 패키지·폴더 이름 변경"에서
   `vite-astro-locator`로의 rename을 검토 중이다. **publish 후 rename은
   비용이 훨씬 크므로 publish 전에 결정한다.**
3. `npm publish --dry-run`으로 `files: ["dist", "README.md"]`가 의도대로
   묶이는지 확인한다.
4. 첫 배포는 `0.1.0` 그대로 두되, breaking change 여지를 남기려면
   `--tag next`로 올리는 것도 방법이다.

## 🟡 P1 — 공개 저장소로서 빠진 것

### 3. LICENSE 파일 없음

`package.json`은 `"license": "ISC"`를 선언하고 README에도 ISC라고 적었지만
저장소 루트에 LICENSE 파일이 없다. 그 결과:

- `gh repo view --json licenseInfo` → `null`
- GitHub 사이드바에 라이선스가 표시되지 않는다
- 기업 사용자의 라이선스 스캐너가 "라이선스 불명"으로 분류한다

**수정.** 루트에 `LICENSE` 파일 추가. ISC 전문 + `Copyright (c) 2026 Lim
Jungjun`. GitHub UI의 `Add file → Create new file → LICENSE` 를 쓰면
템플릿이 자동 제공된다.

**같이 결정할 것.** ISC를 유지할지, 생태계에서 더 흔한 MIT로 바꿀지.
둘은 실질적으로 동등하지만 MIT가 인지도가 높다. 바꾼다면 `package.json`,
README, LICENSE 세 곳을 동시에 바꾼다.

### 4. lockfile 두 개 공존

`package-lock.json`과 `pnpm-lock.yaml`이 모두 커밋되어 있다.

**문제.** 두 lockfile이 서로 다른 의존성 트리를 고정할 수 있고, 기여자나
CI가 어느 패키지 매니저를 써야 하는지 알 수 없다. 시간이 지나면 두
파일이 갈라져서 "내 로컬에서는 되는데" 류의 재현 불가 버그가 생긴다.

**수정.** 하나만 남기고 나머지는 삭제 + `.gitignore` 추가. 결정했으면
`package.json`에 명시한다.

```json
"packageManager": "npm@10.x"
```

`.pnpm-store/`는 이미 `.gitignore`에 추가되어 있다.

## 🟢 P2 — 알려지기 위해 필요한 것

### 5. 데모 미디어

README의 Demo 섹션은 주석 처리된 embed 블록만 있다. [docs/media/](./media/)
에 파일을 넣고 `README.md`의 해당 블록을 해제한다.

| 파일 | 담을 내용 |
| --- | --- |
| `demo.gif` | 트리거 키 → 호버 → 클릭 → 클립보드 복사 |
| `overlay.png` | 3계층 오버레이(전체 / 메타데이터 조상 / 현재 요소) |
| `popover.png` | FAB + 트리거 키 설정 팝오버 |
| `agent.png` | MCP 연결된 채팅에서 해시가 소스로 해석되는 장면 |

GIF가 10MB를 넘으면 GitHub이 렌더링하지 않는다. 폭 800px / 15fps 정도로
줄인다.

### 6. 저장소 메타데이터

- **Topics** — `astro`, `mcp`, `model-context-protocol`, `vite-plugin`,
  `developer-tools`, `ai`. GitHub 탐색과 검색 유입 경로다.
- **About** — 설명은 등록됨. 홈페이지 URL은 npm 발행 후 채운다.
- **CONTRIBUTING.md / 이슈 템플릿** — 외부 기여를 받기 시작하면 추가.
- **CI** — `npm run verify`를 돌리는 GitHub Actions 워크플로. Playwright
  E2E가 포함되어 있어 `microsoft/playwright-github-action` 또는 브라우저
  설치 스텝이 필요하다.

## 권장 실행 순서

1. P0-1 절대경로 수정 → `npm install` 재현성 확인 → `npm run verify` 통과
2. 패키지 이름 최종 결정 (`astro-ai-locator` 유지 vs `vite-astro-locator`)
3. LICENSE 추가, lockfile 정리
4. `npm publish --dry-run` → 실제 publish
5. 데모 미디어 촬영 후 README Demo 섹션 해제
6. Topics 등록, CI 워크플로 추가
