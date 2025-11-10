// @ts-nocheck
import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";

async function main() {
  const buildDir = Deno.env.get("BRAINTRUST_BUILD_DIR");
  if (!buildDir) {
    throw new Error("BRAINTRUST_BUILD_DIR environment variable must be set");
  }

  const moduleUrl = toFileUrl(join(buildDir, "dist", "browser.mjs"));
  const { initLogger, _exportsForTestingOnly } = await import(moduleUrl.href);

  _exportsForTestingOnly.setInitialTestState();
  await _exportsForTestingOnly.simulateLoginForTests();

  const backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();

  const logger = initLogger({
    projectName: "deno-browser-logger",
    asyncFlush: false,
  });

  const span = logger.startSpan({ name: "browser.logger.deno" });
  span.log({
    input: "What is the capital of France?",
    output: "Paris",
    expected: "Paris",
    metadata: { transport: "browser" },
  });
  span.end();

  await logger.flush();

  const events = await backgroundLogger.drain();
  try {
    assertEquals(events.length, 1, "Exactly one span should be captured");
    const event = events[0];

    assertEquals(event.input, "What is the capital of France?");
    assertEquals(event.output, "Paris");
    assertEquals(event.expected, "Paris");
  } finally {
    _exportsForTestingOnly.clearTestBackgroundLogger();
    _exportsForTestingOnly.simulateLogoutForTests();
  }

  console.log("Deno browser logger smoke test passed");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Deno browser logger smoke test failed:", error);
    Deno.exit(1);
  });
}
