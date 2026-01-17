import { test, expect } from "@playwright/test";

test.describe("Braintrust SDK Browser Tests", () => {
  test("should run all browser tests (shared + eval + prompt)", async ({
    page,
    baseURL,
  }) => {
    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === "error") {
        console.error(`[Browser Console Error] ${text}`);
      } else {
        console.log(`[Browser Console ${type}] ${text}`);
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

    console.log("\n=== Browser Test Results ===");
    console.log(`Overall completed: ${smoke.completed}`);
    console.log(`Unhandled errors: ${smoke.unhandledErrors?.length ?? 0}`);

    expect(smoke).toBeTruthy();
    expect(smoke.completed).toBe(true);
    expect(smoke.unhandledErrors?.length ?? 0).toBe(0);

    expect(smoke.sections.shared.completed).toBe(true);
    expect(smoke.sections.shared.failed).toBe(0);
    expect(smoke.sections.shared.passed).toBeGreaterThanOrEqual(17);
    console.log(
      `\nShared suite: ${smoke.sections.shared.passed} passed, ${smoke.sections.shared.failed} failed`,
    );

    expect(smoke.sections.eval.completed).toBe(true);
    expect(smoke.sections.eval.failed).toBe(0);
    expect(smoke.sections.eval.passed).toBe(1);
    console.log(
      `Eval suite: ${smoke.sections.eval.passed} passed, ${smoke.sections.eval.failed} failed`,
    );

    expect(smoke.sections.prompt.completed).toBe(true);
    expect(smoke.sections.prompt.failed).toBe(0);
    expect(smoke.sections.prompt.passed).toBe(2);
    console.log(
      `Prompt suite: ${smoke.sections.prompt.passed} passed, ${smoke.sections.prompt.failed} failed`,
    );
  });
});
