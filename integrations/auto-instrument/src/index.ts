import { registerHooks } from "./loader";
import { loadConfig, type Config } from "./config";
import { detectAndSetupOtel } from "./util";

export type { Config };
export { loadConfig };

let isSetup = false;

export function setupAutoInstrumentation(config?: Partial<Config>): void {
  if (isSetup) {
    console.warn("[braintrust] Auto-instrumentation already setup, skipping");
    return;
  }

  const finalConfig = loadConfig(config);

  if (!finalConfig.enabled) {
    if (finalConfig.debug) {
      console.log("[braintrust] Auto-instrumentation is disabled");
    }
    return;
  }

  try {
    // Auto-detect and setup OpenTelemetry compatibility if available
    detectAndSetupOtel(finalConfig);

    registerHooks(finalConfig);
    isSetup = true;
  } catch (error) {
    console.warn(
      "[braintrust] Failed to setup auto-instrumentation:",
      error instanceof Error ? error.message : String(error),
    );
    if (finalConfig.debug && error instanceof Error) {
      console.error(error.stack);
    }
  }
}

if (process.env.BRAINTRUST_AUTO_INSTRUMENT === "1") {
  setupAutoInstrumentation();
}
