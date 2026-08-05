import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { connect } from "node:net";
import { describe, expect, it } from "vitest";

const PORT = 45174;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) {
        return;
      }
    } catch {
      // 아직 리스닝 전이다.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Fixture dev server did not start");
}

/**
 * `astro dev --port` 는 강제가 아니라 희망 사항이라, 자리가 차 있으면 다음
 * 빈 포트로 조용히 넘어간다. 이전에 강제 종료된 실행이 이 포트를 여전히
 * 붙들고 있으면 이 테스트는 그 낡은 서버에 연결해 엉뚱한 프로세스를
 * 검증하게 된다 — 그러느니 시끄럽게 실패하는 게 낫다.
 */
async function assertPortIsFree(): Promise<void> {
  const occupied = await new Promise<boolean>((resolve) => {
    const socket = connect({ port: PORT, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
  if (occupied) {
    throw new Error(
      `Port ${PORT} is already occupied — a previous aborted run of this ` +
        `test likely left a dev server behind. Find and kill it (e.g. ` +
        `\`lsof -i :${PORT}\`) before rerunning this test.`
    );
  }
}

/** SIGTERM 발송은 종료를 요청할 뿐이라, 실제로 죽을 때까지 기다려야 다음 실행이 포트를 안전하게 재사용한다. */
async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await Promise.race([
    once(child, "exit"),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

describe("quit stops server-side instrumentation", () => {
  it("serves clean HTML after the session is quit", async () => {
    // Astro 의 dev 서버 플러그인은 `process.env.VITEST` 가 있으면 자체 라우트
    // 핸들러 연결을 건너뛴다(자기 자신의 vitest 스위트를 위한 배려). 이 프로세스가
    // vitest 아래서 돌고 있어 그 값이 상속되므로, 자식 astro dev 에는 지워서
    // 넘긴다 — 안 그러면 `/` 가 항상 404 를 뱉는다.
    await assertPortIsFree();
    const { VITEST: _vitest, ...envWithoutVitest } = process.env;
    const server = spawn(
      "npx",
      [
        "astro",
        "dev",
        "--root",
        "tests/fixtures/basic",
        "--host",
        "127.0.0.1",
        "--port",
        String(PORT)
      ],
      {
        env: { ...envWithoutVitest, ASTRO_DEV_BACKGROUND: "0" },
        stdio: "ignore",
        // npx 는 실제 astro 프로세스를 자식으로 띄우고 자신은 먼저 죽을 수 있다.
        // SIGTERM 을 npx 에만 보내면 astro 는 PPID 1 로 고아가 돼 포트에 남는다.
        // detached 로 새 프로세스 그룹을 만들고, 종료할 땐 그룹 전체(-pid)에
        // 신호를 보내 npx 든 astro 든 살아있는 건 다 잡는다.
        detached: true
      }
    );

    try {
      await waitForServer();

      const before = await (await fetch(BASE_URL)).text();
      expect(before).toContain("data-astro-ai-locator-file");

      const token = /sessionToken":"([^"]+)"/u.exec(before)?.[1];
      expect(token).toBeTruthy();

      const quit = await fetch(`${BASE_URL}/@astro-inspector/session`, {
        method: "POST",
        headers: { "x-astro-ai-locator-token": token ?? "" }
      });
      expect(quit.status).toBe(200);
      expect(((await quit.json()) as { disabled: boolean }).disabled).toBe(true);

      const afterResponse = await fetch(BASE_URL);
      expect(afterResponse.status).toBe(200);
      const after = await afterResponse.text();
      // quit 이 서빙 자체를 깨뜨린 게 아니라 진짜 페이지가 계속 나온다는 걸 먼저
      // 확인한다 — 500/에러 오버레이/빈 바디도 "locator 속성 없음"은 만족해버려서
      // 이 양성 마커 없이는 서버가 죽어도 테스트가 통과해버린다.
      expect(after).toContain("<html");
      expect(after).toContain("Locator fixture");
      expect(after).not.toContain("data-astro-ai-locator-file");

      const register = await fetch(`${BASE_URL}/@astro-inspector/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-astro-ai-locator-token": token ?? ""
        },
        body: JSON.stringify({
          sourceFile: "src/components/Card.astro",
          line: 5,
          column: 1,
          sourceTag: "article",
          domTag: "article"
        })
      });
      expect(register.status).toBe(410);

      // 설정 엔드포인트는 살려 둔다. 닫으면 클라이언트가 부팅할 때마다 경고를 찍는다.
      const settings = await fetch(`${BASE_URL}/@astro-inspector/settings`, {
        headers: { "x-astro-ai-locator-token": token ?? "" }
      });
      expect(settings.status).toBe(200);
    } finally {
      if (server.pid) {
        try {
          process.kill(-server.pid, "SIGTERM");
        } catch {
          // 이미 죽은 프로세스 그룹은 무시한다.
        }
        // 다음 실행이 포트를 안전하게 재사용하도록 실제로 죽을 때까지 기다린다.
        await waitForExit(server, 5000);
      }
    }
  }, 120_000);
});
