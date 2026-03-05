import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    hookTimeout: 20_000,
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
