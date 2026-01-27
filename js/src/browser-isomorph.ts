// Browser-safe isomorph that noops Node.js features
// This file is only used for the /browser, /edge-light, /workerd exports

import iso from "./isomorph";

let messageShown = false;
let browserConfigured = false;

/**
 * Configure the isomorph for browser environments.
 */
export function configureBrowserIsomorph(): void {
  if (browserConfigured) {
    return;
  }

  // Show informational message once
  if (!messageShown && typeof console !== "undefined") {
    console.info(
      "Braintrust SDK Browser Build\n" +
        "You are using a browser-compatible build from the main package.\n" +
        "For optimal browser support consider:\n" +
        "  npm install @braintrust/browser\n" +
        '  import * as braintrust from "@braintrust/browser"\n\n',
    );
    messageShown = true;
  }

  // Configure browser-safe implementations
  iso.buildType = "browser";

  iso.getEnv = (name: string) => {
    if (typeof process === "undefined" || typeof process.env === "undefined") {
      return undefined;
    }
    return process.env[name];
  };

  iso.getRepoInfo = async () => ({
    commit: null,
    branch: null,
    tag: null,
    dirty: false,
  });

  iso.getCallerLocation = () => undefined;

  // Browser-compatible hash function (simple hash algorithm, not cryptographic)
  iso.hash = (data: string): string => {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    // Convert to hex string and make it look like a SHA-256 hash length
    const hashHex = (hash >>> 0).toString(16).padStart(8, "0");
    return hashHex.repeat(8).substring(0, 64);
  };

  browserConfigured = true;
}
