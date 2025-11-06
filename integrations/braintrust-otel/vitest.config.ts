import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  ssr: {
    noExternal: [],
  },
  resolve: {
    preserveSymlinks: false,
  },
});

