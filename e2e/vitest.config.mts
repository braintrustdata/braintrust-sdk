import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    hookTimeout: 20_000,
    include: ["scenarios/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
