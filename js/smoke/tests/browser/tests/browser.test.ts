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

    // Wait for browser bundle to finish
    try {
      await page.waitForFunction(
        () => {
          return (window as any).__btBrowserSmokeResults?.completed === true;
        },
        { timeout: 60000 },
      );
    } catch (error) {
      // Get current state for debugging
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

      // Take a screenshot for debugging
      await page.screenshot({
        path: "test-timeout-browser.png",
        fullPage: true,
      });
      throw error;
    }

    // Get smoke results from the page
    const smoke = await page.evaluate(
      () => (window as any).__btBrowserSmokeResults,
    );

    expect(smoke).toBeTruthy();
    expect(smoke.completed).toBe(true);
    expect(smoke.unhandledErrors?.length ?? 0).toBe(0);

    // Sections should exist and be clean
    expect(smoke.sections.shared.completed).toBe(true);
    expect(smoke.sections.shared.failed).toBe(0);
    expect(smoke.sections.shared.passed).toBeGreaterThan(0);

    expect(smoke.sections.eval.completed).toBe(true);
    expect(smoke.sections.eval.failed).toBe(0);
    expect(smoke.sections.eval.passed).toBeGreaterThan(0);

    // Log test summary
    console.log(
      `Shared suite: ${smoke.sections.shared.passed} passed, ${smoke.sections.shared.failed} failed`,
    );
    console.log(
      `Eval suite: ${smoke.sections.eval.passed} passed, ${smoke.sections.eval.failed} failed`,
    );
  });
});
