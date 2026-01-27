/**
 * Browser-compatible build of the Braintrust SDK for edge runtime environments.
 *
 * This build uses a noop isomorph that provides browser-safe implementations
 * for Node.js-specific features.
 *
 * Edge runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy) have native
 * AsyncLocalStorage support. For optimal support with built-in polyfill, consider:
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
