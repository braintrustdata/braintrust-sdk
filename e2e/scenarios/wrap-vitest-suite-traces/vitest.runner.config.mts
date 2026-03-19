import { defineConfig } from "vitest-v2/config";

export default defineConfig({
  test: {
    include: ["runner.case.ts"],
    testTimeout: 20_000,
  },
});
