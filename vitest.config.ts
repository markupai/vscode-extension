import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.{test,spec}.ts"],
    exclude: ["node_modules", "out", "dist", ".vscode-test"],
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 5000,
    hookTimeout: 5000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/test/**",
        "src/extension.ts",
        "src/webview/sidebarHost.ts",
        "**/*.d.ts",
        "**/node_modules/**",
        "**/out/**",
        "**/dist/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "./test/mocks/vscode.ts"),
    },
  },
});
