import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    // Native database startup and archive compression contend with short-lease E2E cases.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    sequence: {
      concurrent: false
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"]
    }
  }
});
