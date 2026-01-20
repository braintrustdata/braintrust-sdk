import { test, expect } from "@playwright/test";
import {
  displayTestResults,
  type TestResult,
} from "../../../shared/dist/index.mjs";

test.describe("Braintrust SDK Browser Tests", () => {
  test("should run all browser tests (shared + eval + prompt)", async ({
    page,
    baseURL,
  }) => {
    const results: TestResult[] = [];

    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === "error") {
        console.error(`[Browser Console Error] ${text}`);
      }
    });

    page.on("pageerror", (error) => {
      console.error("[Browser Page Error]", error.message);
    });

    page.on("requestfailed", (request) => {
      console.error(
        `[Request Failed] ${request.url()} - ${request.failure()?.errorText}`,
      );
    });

    const response = await page.goto(`${baseURL}/pages/browser-tests.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (!response || !response.ok()) {
      throw new Error(`Failed to load page: ${response?.status()}`);
    }

    try {
      await page.waitForFunction(
        () => {
          return (window as any).__btBrowserSmokeResults?.completed === true;
        },
        { timeout: 60000 },
      );
    } catch (error) {
      const testState = await page.evaluate(() => {
        return {
          smoke: (window as any).__btBrowserSmokeResults,
          documentReady: document.readyState,
          bodyContent: document.body?.innerText?.substring(0, 500),
        };
      });
      console.error(
        "Test timeout - Current state:",
        JSON.stringify(testState, null, 2),
      );

      await page.screenshot({
        path: "test-timeout-browser.png",
        fullPage: true,
      });
      throw error;
    }

    const smoke = await page.evaluate(
      () => (window as any).__btBrowserSmokeResults,
    );

    // Test 1: Overall completion
    if (smoke && smoke.completed) {
      results.push({
        status: "pass",
        name: "Browser tests completed",
      });
    } else {
      results.push({
        status: "fail",
        name: "Browser tests completed",
        error: { message: "Tests did not complete" },
      });
    }

    // Test 2: No unhandled errors
    if ((smoke.unhandledErrors?.length ?? 0) === 0) {
      results.push({
        status: "pass",
        name: "No unhandled errors",
      });
    } else {
      results.push({
        status: "fail",
        name: "No unhandled errors",
        error: {
          message: `Found ${smoke.unhandledErrors.length} unhandled errors`,
        },
      });
    }

    // Test 3: Shared suite
    if (
      smoke.sections.shared.completed &&
      smoke.sections.shared.failed === 0 &&
      smoke.sections.shared.passed >= 17
    ) {
      results.push({
        status: "pass",
        name: `Shared suite (${smoke.sections.shared.passed} tests)`,
      });
    } else {
      results.push({
        status: "fail",
        name: "Shared suite",
        error: {
          message: `Completed: ${smoke.sections.shared.completed}, Passed: ${smoke.sections.shared.passed}, Failed: ${smoke.sections.shared.failed}`,
        },
      });
    }

    // Test 4: Eval suite
    if (
      smoke.sections.eval.completed &&
      smoke.sections.eval.failed === 0 &&
      smoke.sections.eval.passed === 1
    ) {
      results.push({
        status: "pass",
        name: "Eval suite (1 test)",
      });
    } else {
      results.push({
        status: "fail",
        name: "Eval suite",
        error: {
          message: `Completed: ${smoke.sections.eval.completed}, Passed: ${smoke.sections.eval.passed}, Failed: ${smoke.sections.eval.failed}`,
        },
      });
    }

    // Test 5: Prompt suite
    if (
      smoke.sections.prompt.completed &&
      smoke.sections.prompt.failed === 0 &&
      smoke.sections.prompt.passed === 2
    ) {
      results.push({
        status: "pass",
        name: "Prompt suite (2 tests)",
      });
    } else {
      results.push({
        status: "fail",
        name: "Prompt suite",
        error: {
          message: `Completed: ${smoke.sections.prompt.completed}, Passed: ${smoke.sections.prompt.passed}, Failed: ${smoke.sections.prompt.failed}`,
        },
      });
    }

    displayTestResults({
      scenarioName: "Playwright Browser Test Results",
      results,
    });

    // Fail the Playwright test if any results failed
    expect(smoke).toBeTruthy();
    expect(smoke.completed).toBe(true);
    expect(smoke.unhandledErrors?.length ?? 0).toBe(0);
    expect(smoke.sections.shared.completed).toBe(true);
    expect(smoke.sections.shared.failed).toBe(0);
    expect(smoke.sections.shared.passed).toBeGreaterThanOrEqual(17);
    expect(smoke.sections.eval.completed).toBe(true);
    expect(smoke.sections.eval.failed).toBe(0);
    expect(smoke.sections.eval.passed).toBe(1);
    expect(smoke.sections.prompt.completed).toBe(true);
    expect(smoke.sections.prompt.failed).toBe(0);
    expect(smoke.sections.prompt.passed).toBe(2);
  });
});
