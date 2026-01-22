import * as braintrust from "braintrust";
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  testMustacheTemplate,
  testNunjucksTemplate,
} from "../../../shared";
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

  const adapters = await setupTestEnvironment({
    initLogger: braintrust.initLogger,
    testingExports: braintrust._exportsForTestingOnly,
    canUseFileSystem: false,
    canUseCLI: false,
    environment: "browser",
  });

  try {
    harness.log("=== Running shared suites ===");

    const importResults = await runImportVerificationTests(braintrust, {
      expectedBuild: "browser",
      expectedFormat: "esm",
    });
    for (const r of importResults) {
      if (r.status === "pass") harness.pass(SHARED_SECTION, r.name, r.message);
      else
        harness.fail(
          SHARED_SECTION,
          r.name,
          r.error || new Error("Test failed"),
          r.message,
        );
    }

    const loggingResults = await runBasicLoggingTests(adapters, braintrust);
    for (const r of loggingResults) {
      if (r.status === "pass") harness.pass(SHARED_SECTION, r.name, r.message);
      else
        harness.fail(
          SHARED_SECTION,
          r.name,
          r.error || new Error("Test failed"),
          r.message,
        );
    }

    harness.completeSection(SHARED_SECTION);

    harness.log("\n=== Running eval suite ===");

    const evalResult = await runEvalSmokeTest(adapters, braintrust);
    if (evalResult.status === "pass")
      harness.pass(EVAL_SECTION, evalResult.name, evalResult.message);
    else
      harness.fail(
        EVAL_SECTION,
        evalResult.name,
        evalResult.error || new Error("Test failed"),
        evalResult.message,
      );

    harness.completeSection(EVAL_SECTION);

    harness.log("\n=== Running prompt templating suite ===");

    const mustacheResult = await testMustacheTemplate({
      Prompt: braintrust.Prompt,
    });
    if (mustacheResult.status === "pass")
      harness.pass(PROMPT_SECTION, mustacheResult.name, mustacheResult.message);
    else
      harness.fail(
        PROMPT_SECTION,
        mustacheResult.name,
        mustacheResult.error || new Error("Test failed"),
        mustacheResult.message,
      );

    const nunjucksResult = await testNunjucksTemplate({
      Prompt: braintrust.Prompt,
    });
    if (
      nunjucksResult.status === "fail" &&
      nunjucksResult.error?.message.includes(
        "Nunjucks templating is not supported",
      )
    ) {
      harness.pass(
        PROMPT_SECTION,
        nunjucksResult.name,
        "Expected failure: Nunjucks not supported in browser build",
      );
    } else if (nunjucksResult.status === "pass") {
      harness.pass(PROMPT_SECTION, nunjucksResult.name, nunjucksResult.message);
    } else {
      harness.fail(
        PROMPT_SECTION,
        nunjucksResult.name,
        nunjucksResult.error || new Error("Test failed"),
        nunjucksResult.message,
      );
    }

    harness.completeSection(PROMPT_SECTION);
  } catch (err) {
    harness.fail("runtime", "fatal", err);
  } finally {
    await cleanupTestEnvironment(adapters);
  }
}

async function main() {
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
