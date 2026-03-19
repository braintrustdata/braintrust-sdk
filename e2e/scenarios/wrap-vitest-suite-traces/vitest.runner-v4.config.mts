import { defineConfig } from "vitest-v4/config";

export default defineConfig({
  test: {
    include: ["runner.case.ts"],
    testTimeout: 20_000,
  },
});
