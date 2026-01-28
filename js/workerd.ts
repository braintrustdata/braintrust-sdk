/**
 * Browser-compatible build of the Braintrust SDK for Cloudflare Workers (workerd runtime).
 *
 * This build uses a noop isomorph that provides browser-safe implementations
 * for Node.js-specific features.
 *
 * Cloudflare Workers have native AsyncLocalStorage support. For optimal support
 * with built-in polyfill, consider:
 *   npm install @braintrust/browser
 *   import * as braintrust from '@braintrust/browser';
 */

import { configureBrowserIsomorph } from "./src/browser-isomorph";

configureBrowserIsomorph();

export * from "./src/exports";
