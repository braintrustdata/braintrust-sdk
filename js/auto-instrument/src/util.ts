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

export function checkVersion(actual: string, required: string): boolean {
  try {
    const [aMajor, aMinor] = actual.split(".").map(Number);
    const [rMajor, rMinor] = required.split(".").map(Number);

    return aMajor === rMajor && aMinor >= rMinor;
  } catch {
    return false;
  }
}

export function getPackageVersion(packageName: string): string | null {
  try {
    const pkg = require(`${packageName}/package.json`);
    return pkg.version || null;
  } catch {
    return null;
  }
}
