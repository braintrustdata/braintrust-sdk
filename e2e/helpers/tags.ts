export const E2E_TAGS = {
  externalApi: "external-api",
  hermetic: "hermetic",
} as const;

export type E2ETag = (typeof E2E_TAGS)[keyof typeof E2E_TAGS];
