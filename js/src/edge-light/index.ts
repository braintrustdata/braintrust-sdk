/**
 * Edge Light runtime build of the Braintrust SDK.
 *
 * This build is optimized for edge runtime environments like Vercel Edge Runtime,
 * Next.js Edge Runtime, and other edge platforms that support AsyncLocalStorage.
 */

import { configureEdgeLight } from "./config";

configureEdgeLight();

// eslint-disable-next-line no-restricted-syntax
export * from "../exports";
export * as default from "../exports";
