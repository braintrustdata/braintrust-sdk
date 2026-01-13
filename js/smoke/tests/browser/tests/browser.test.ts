import { test, expect } from "@playwright/test";

test.describe("Braintrust SDK Browser Tests", () => {
  test("should run all browser tests (general + eval)", async ({
    page,
    baseURL,
  }) => {
    // Set up console logging
    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === "error") {
        console.error(`[Browser Console Error] ${text}`);
      } else {
        console.log(`[Browser Console ${type}] ${text}`);
      }
    });

    // Set up error handling
    page.on("pageerror", (error) => {
      console.error("[Browser Page Error]", error.message);
    });

    // Set up request/response logging for debugging
    page.on("requestfailed", (request) => {
      console.error(
        `[Request Failed] ${request.url()} - ${request.failure()?.errorText}`,
      );
    });

    // Navigate to the HTML page via the test server
    console.log(`Navigating to: ${baseURL}/pages/browser-tests.html`);
    const response = await page.goto(`${baseURL}/pages/browser-tests.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (!response || !response.ok()) {
      console.error(
        `Page load failed: ${response?.status()} ${response?.statusText()}`,
      );
      throw new Error(`Failed to load page: ${response?.status()}`);
    }

    console.log("Page loaded, waiting for all tests to complete...");

    // Wait for both test suites to complete
    try {
      await page.waitForFunction(
        () => {
          return (
            (window as any).testResults !== undefined &&
            (window as any).testResults.completed === true &&
            (window as any).evalTestResults !== undefined &&
            (window as any).evalTestResults.completed === true
          );
        },
        { timeout: 60000 },
      );
    } catch (error) {
      // Get current state for debugging
      const testState = await page.evaluate(() => {
        return {
          hasTestResults: (window as any).testResults !== undefined,
          testResults: (window as any).testResults,
          hasEvalTestResults: (window as any).evalTestResults !== undefined,
          evalTestResults: (window as any).evalTestResults,
          documentReady: document.readyState,
          bodyContent: document.body?.innerText?.substring(0, 500),
        };
      });
      console.error(
        "Test timeout - Current state:",
        JSON.stringify(testState, null, 2),
      );

      // Take a screenshot for debugging
      await page.screenshot({
        path: "test-timeout-browser.png",
        fullPage: true,
      });
      throw error;
    }

    // Get test results from the page
    const generalResults = await page.evaluate(
      () => (window as any).testResults,
    );
    const evalResults = await page.evaluate(
      () => (window as any).evalTestResults,
    );

    // Verify general tests
    expect(generalResults.completed).toBe(true);
    expect(generalResults.failed).toBe(0);
    expect(generalResults.passed).toBeGreaterThan(0);

    // Verify eval test
    expect(evalResults.completed).toBe(true);
    expect(evalResults.success).toBe(true);

    // Log test summary
    console.log(`General tests passed: ${generalResults.passed}`);
    console.log(`General tests failed: ${generalResults.failed}`);
    console.log(`Eval test success: ${evalResults.success}`);
    if (generalResults.errors && generalResults.errors.length > 0) {
      console.error("Test errors:", generalResults.errors);
    }
    if (evalResults.error) {
      console.error("Eval test error:", evalResults.error);
    }
  });
});
