import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/{unit,integration}/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/manifest/**/*.ts",
        "src/integration/request-handler.ts",
        "src/mcp/resolve-element.ts"
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 65,
        statements: 80
      }
    }
  }
});
