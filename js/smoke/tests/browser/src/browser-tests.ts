// Combined browser smoke tests.
// This file is the single entrypoint bundled by esbuild.

import * as braintrust from "braintrust/browser";
import {
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  runPromptTemplatingTests,
  withTestEnvironment,
} from "../../../shared/dist/index.mjs";
import { createBrowserHarness, type BrowserSmokeResults } from "./harness";

declare global {
  interface Window {
    __btBrowserSmokeResults?: BrowserSmokeResults;
  }
}

const output = document.getElementById("output");
if (!output) {
  throw new Error("Missing #output element");
}

const harness = createBrowserHarness(output);
window.__btBrowserSmokeResults = harness.results;

const SHARED_SECTION = "shared";
const EVAL_SECTION = "eval";
const PROMPT_SECTION = "prompt";

async function runAllTestSuites() {
  if (!braintrust._exportsForTestingOnly) {
    harness.fail(
      "runtime",
      "preflight",
      new Error("_exportsForTestingOnly not available"),
    );
    return;
  }

  // Create a single test environment for all test suites
  await withTestEnvironment(
    {
      initLogger: braintrust.initLogger,
      testingExports: braintrust._exportsForTestingOnly,
      canUseFileSystem: false,
      canUseCLI: false,
      environment: "browser",
    },
    async (adapters) => {
      // Run shared suites (import verification + basic logging)
      harness.log("=== Running shared suites ===");

      const importResults = await runImportVerificationTests(braintrust);
      for (const r of importResults) {
        if (r.success) harness.pass(SHARED_SECTION, r.testName, r.message);
        else harness.fail(SHARED_SECTION, r.testName, r.error, r.message);
      }

      const loggingResults = await runBasicLoggingTests(adapters);
      for (const r of loggingResults) {
        if (r.success) harness.pass(SHARED_SECTION, r.testName, r.message);
        else harness.fail(SHARED_SECTION, r.testName, r.error, r.message);
      }

      harness.completeSection(SHARED_SECTION);

      // Run eval suite
      harness.log("\n=== Running eval suite ===");

      const evalResult = await runEvalSmokeTest(adapters, braintrust);
      if (evalResult.success)
        harness.pass(EVAL_SECTION, evalResult.testName, evalResult.message);
      else
        harness.fail(
          EVAL_SECTION,
          evalResult.testName,
          evalResult.error,
          evalResult.message,
        );

      harness.completeSection(EVAL_SECTION);

      // Run prompt templating suite
      harness.log("\n=== Running prompt templating suite ===");

      const promptResults = await runPromptTemplatingTests(
        { Prompt: braintrust.Prompt },
        "browser",
      );
      for (const r of promptResults) {
        if (r.success) harness.pass(PROMPT_SECTION, r.testName, r.message);
        else harness.fail(PROMPT_SECTION, r.testName, r.error, r.message);
      }

      harness.completeSection(PROMPT_SECTION);
    },
  );
}

async function main() {
  // Hard timeout guard so Playwright never hangs indefinitely.
  const timeoutMs = 55_000;
  const timeout = window.setTimeout(() => {
    if (!harness.results.completed) {
      harness.fail(
        "runtime",
        "timeout",
        new Error("Timed out waiting for browser tests to finish"),
      );
      harness.completeAll();
    }
  }, timeoutMs);

  try {
    await runAllTestSuites();
  } catch (err) {
    harness.fail("runtime", "fatal", err);
  } finally {
    window.clearTimeout(timeout);
    harness.log("\n=== All browser suites complete ===");
    harness.completeAll();
  }
}

void main();
