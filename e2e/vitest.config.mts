import { defineConfig } from "vitest/config";
import { E2E_TAGS } from "./helpers/tags";

const hasGoogleGenAICredentials = Boolean(
  process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
);

export default defineConfig({
  test: {
    fileParallelism: !hasGoogleGenAICredentials,
    hookTimeout: 20_000,
    include: ["scenarios/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    tags: [
      {
        name: E2E_TAGS.externalApi,
        description:
          "Tests that call real external APIs and require provider credentials.",
        retry: 1,
      },
      {
        name: E2E_TAGS.hermetic,
        description:
          "Tests that run entirely against local mocks and fixtures.",
      },
    ],
    testTimeout: 20_000,
  },
});
