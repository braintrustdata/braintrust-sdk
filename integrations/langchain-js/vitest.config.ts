import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/test/setup.ts"],
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
