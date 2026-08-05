import { spawn } from "node:child_process";
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

describe("quit stops server-side instrumentation", () => {
  it("serves clean HTML after the session is quit", async () => {
    // Astro 의 dev 서버 플러그인은 `process.env.VITEST` 가 있으면 자체 라우트
    // 핸들러 연결을 건너뛴다(자기 자신의 vitest 스위트를 위한 배려). 이 프로세스가
    // vitest 아래서 돌고 있어 그 값이 상속되므로, 자식 astro dev 에는 지워서
    // 넘긴다 — 안 그러면 `/` 가 항상 404 를 뱉는다.
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
      { env: { ...envWithoutVitest, ASTRO_DEV_BACKGROUND: "0" }, stdio: "ignore" }
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

      const after = await (await fetch(BASE_URL)).text();
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
      server.kill("SIGTERM");
    }
  }, 120_000);
});
