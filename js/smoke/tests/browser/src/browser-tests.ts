// Combined browser smoke tests.
// This file is the single entrypoint bundled by esbuild.

import * as braintrust from "braintrust/browser";
import {
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
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

async function runSharedSuites() {
  harness.log("=== Running shared suites ===");

  if (!braintrust._exportsForTestingOnly) {
    harness.fail(
      SHARED_SECTION,
      "preflight",
      new Error("_exportsForTestingOnly not available"),
    );
    harness.completeSection(SHARED_SECTION);
    return;
  }

  await withTestEnvironment(
    {
      initLogger: braintrust.initLogger,
      testingExports: braintrust._exportsForTestingOnly,
      canUseFileSystem: false,
      canUseCLI: false,
      environment: "browser",
    },
    async (adapters) => {
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
    },
  );

  harness.completeSection(SHARED_SECTION);
}

async function runEvalSuite() {
  harness.log("\n=== Running eval suite ===");

  if (!braintrust._exportsForTestingOnly) {
    harness.fail(
      EVAL_SECTION,
      "preflight",
      new Error("_exportsForTestingOnly not available"),
    );
    harness.completeSection(EVAL_SECTION);
    return;
  }

  await withTestEnvironment(
    {
      initLogger: braintrust.initLogger,
      testingExports: braintrust._exportsForTestingOnly,
      canUseFileSystem: false,
      canUseCLI: false,
      environment: "browser",
    },
    async (adapters) => {
      const r = await runEvalSmokeTest(adapters, braintrust);
      if (r.success) harness.pass(EVAL_SECTION, r.testName, r.message);
      else harness.fail(EVAL_SECTION, r.testName, r.error, r.message);
    },
  );

  harness.completeSection(EVAL_SECTION);
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
    await runSharedSuites();
    await runEvalSuite();
  } catch (err) {
    harness.fail("runtime", "fatal", err);
  } finally {
    window.clearTimeout(timeout);
    harness.log("\n=== All browser suites complete ===");
    harness.completeAll();
  }
}

void main();
