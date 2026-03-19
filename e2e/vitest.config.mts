import * as path from "node:path";
import { defineConfig } from "vitest/config";
import { E2E_TAGS } from "./helpers/tags";

function resolveSnapshotPath(testPath: string, snapExtension: string): string {
  const snapshotPath = path.join(
    path.dirname(testPath),
    "__snapshots__",
    `${path.basename(testPath)}${snapExtension}`,
  );

  if (process.env.BRAINTRUST_E2E_MODE === "canary") {
    return path.join(
      process.cwd(),
      ".bt-tmp",
      "canary-snapshots",
      path.relative(process.cwd(), path.dirname(testPath)),
      `${path.basename(testPath)}${snapExtension}`,
    );
  }

  return snapshotPath;
}

export default defineConfig({
  test: {
    hookTimeout: 20_000,
    include: ["scenarios/**/*.test.ts"],
    resolveSnapshotPath,
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
