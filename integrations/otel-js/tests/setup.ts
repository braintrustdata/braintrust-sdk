// Set OTEL compat mode before any modules load
process.env.BRAINTRUST_OTEL_COMPAT = "true";

import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { beforeAll } from "vitest";

// Register AsyncLocalStorage context manager with OpenTelemetry API
// This is required for context propagation to work in tests
const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

beforeAll(() => {
  if ((process.env.UPDATE || "") === "") {
    process.env.BRAINTRUST_API_KEY = "braintrust-api-key";
    process.env.BRAINTRUST_APP_URL = "http://braintrust.local";
    process.env.OPENAI_API_KEY = "openai-api-key";
  }
});
