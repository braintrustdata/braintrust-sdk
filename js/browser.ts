/**
 * Browser-compatible build of the Braintrust SDK.
 *
 * This build uses a noop isomorph that provides browser-safe implementations
 * for Node.js-specific features.
 *
 * For optimal browser support with AsyncLocalStorage polyfill, consider:
 *   npm install @braintrust/browser
 *   import * as braintrust from '@braintrust/browser';
 */

// Import browser-safe isomorph (not the full source with Node.js imports)
import browserIso from "./src/browser-isomorph";
import iso from "./src/isomorph";

// Configure isomorph for browser
Object.assign(iso, browserIso);

// Now export everything (will use browser isomorph)
export * from "./src/exports";
