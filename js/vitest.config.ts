import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    deps: {
      inline: ["nunjucks"],
    },
  },
  resolve: {
    alias: {},
  },
});
