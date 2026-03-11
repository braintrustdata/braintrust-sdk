import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["runner.case.ts"],
    testTimeout: 20_000,
  },
});
