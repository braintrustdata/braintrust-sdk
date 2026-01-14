import type { Config } from "./config";

export function log(
  config: Config,
  level: "info" | "warn" | "error",
  message: string,
  ...args: unknown[]
): void {
  const prefix = "[braintrust]";

  if (level === "warn" || level === "error") {
    console[level](`${prefix} ${message}`, ...args);
  } else if (config.debug) {
    console.log(`${prefix} ${message}`, ...args);
  }
}

export function detectAndSetupOtel(config: Config): boolean {
  // Check if @braintrust/otel has registered its setup function on globalThis
  // This follows the same pattern as the wrapper functions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setupOtelCompat = (globalThis as any).__braintrust_setup_otel_compat;

  if (typeof setupOtelCompat === "function") {
    log(config, "info", "Detected @braintrust/otel");
    log(config, "info", "Enabling OpenTelemetry compatibility");
    setupOtelCompat();
    return true;
  }

  // Not installed - this is expected and fine
  if (config.debug) {
    log(config, "info", "@braintrust/otel not found (optional integration)");
  }
  return false;
}
