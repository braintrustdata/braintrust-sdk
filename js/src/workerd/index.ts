/**
 * Cloudflare Workers (workerd) build of the Braintrust SDK.
 *
 * This build is optimized for Cloudflare Workers and other workerd-based
 * runtime environments.
 */

import { configureWorkerd } from "./config";

configureWorkerd();

// eslint-disable-next-line no-restricted-syntax
export * from "../exports";
export * as default from "../exports";
