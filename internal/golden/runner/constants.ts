export const APP_URL =
  (process.env.BRAINTRUST_APP_URL || "").trim() || "http://localhost:3000";

export const DEFAULT_GLOB_PATTERN = "**/*.ts";

export const TEST_FUNCTION_PREFIX = "test";

export const PROJECT_NAME = "golden-test-runner";
export const PROJECT_ID = "test-project-id";

export const OUTPUT_MODES = {
  FILES: "files",
  PRINT: "print",
} as const;

export type OutputMode = (typeof OUTPUT_MODES)[keyof typeof OUTPUT_MODES];
