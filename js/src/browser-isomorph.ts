// Browser-safe isomorph that noops Node.js features
// This file is ONLY used for the /browser, /edge-light, /workerd exports
// It provides browser-compatible implementations without importing Node.js modules

// Show one-time informational message
let messageShown = false;
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

export default {
  buildType: "browser" as const,

  getEnv: (name: string) => {
    if (typeof process === "undefined" || typeof process.env === "undefined") {
      return undefined;
    }
    return process.env[name];
  },

  getRepoInfo: () => ({ commit: null, branch: null, tag: null, dirty: false }),
  getCallerLocation: () => undefined,

  // Browser-compatible hash function (simple hash algorithm, not cryptographic)
  hash: (data: string): string => {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    // Convert to hex string and make it look like a SHA-256 hash length
    const hashHex = (hash >>> 0).toString(16).padStart(8, "0");
    return hashHex.repeat(8).substring(0, 64);
  },
};
