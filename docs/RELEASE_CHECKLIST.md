# Release Checklist — npm publish 전 필수 작업

> 2026-07-28 기록 · GitHub 공개 저장소 등록 직후 작성
>
> 저장소: https://github.com/Imjungjuna/astro-inspector (Public)
>
> 이 문서는 "공개 저장소에 올라갔지만 아직 남의 손에서 동작하지 않는 것"만
> 다룬다. 기능 로드맵은 [FUTURE_WORK.md](./FUTURE_WORK.md) 참조.

## 🔴 P0 — 지금 clone하면 깨지는 것

### 1. `package.json` devDependencies 자기 참조 절대경로 ✅ 해결

자기 참조 devDependency를 제거하고 fixture는 기존처럼 `dist/`를 직접
사용하도록 유지했다.

새 환경에서 `npm install`과 전체 `npm run verify`로 재현성을 검증한다.

### 2. npm에 미발행 ✅ 해결

```
npm view astro-inspector  →  0.1.0
```

`astro-inspector@0.1.0`을 `latest`로 public 배포했다. 레지스트리에서 새
임시 Astro 프로젝트에 설치한 뒤 root/client exports, MCP CLI, production
build까지 확인했다.

## 🟡 P1 — 공개 저장소로서 빠진 것

### 3. LICENSE 파일 없음 ✅ 해결

루트에 ISC 전문과 `Copyright (c) 2026 Jungjun Lim`을 추가했다.

### 4. lockfile 두 개 공존 ✅ 해결

`package-lock.json`만 유지하고 `pnpm-lock.yaml`은 제거·ignore했다.
`package.json`의 `packageManager`는 `npm@11.6.2`로 고정했다.

```json
"packageManager": "npm@11.6.2"
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
  `developer-tools`, `inspector`. GitHub 탐색과 검색 유입 경로다.
- **About** — 설명과 npm 홈페이지 URL을 등록했다.
- **CONTRIBUTING.md / 이슈 템플릿** — 외부 기여를 받기 시작하면 추가.
- **CI** — `npm run verify`를 돌리는 GitHub Actions 워크플로. Playwright
  E2E가 포함되어 있어 `microsoft/playwright-github-action` 또는 브라우저
  설치 스텝이 필요하다.

## 권장 실행 순서

1. ~~P0-1 절대경로 수정과 npm 재설치~~ 완료
2. ~~패키지 이름을 `astro-inspector`로 확정~~ 완료
3. ~~ISC LICENSE 추가~~ 완료
4. ~~`npm publish --dry-run` → `astro-inspector@0.1.0` 실제 publish~~ 완료
5. 데모 미디어 촬영 후 README Demo 섹션 해제
6. Topics 등록, CI 워크플로 추가
