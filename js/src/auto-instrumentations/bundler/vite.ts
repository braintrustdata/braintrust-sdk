/**
 * Vite plugin for auto-instrumentation.
 *
 * Usage:
 * ```typescript
 * import { vitePlugin } from '@braintrust/auto-instrumentations/bundler/vite';
 *
 * export default {
 *   plugins: [vitePlugin()],
 * };
 * ```
 *
 * This plugin uses @apm-js-collab/code-transformer to perform AST transformation
 * at build-time, injecting TracingChannel calls into AI SDK functions.
 *
 * For browser builds, the plugin automatically uses 'dc-browser' for diagnostics_channel polyfill.
 * The als-browser polyfill for AsyncLocalStorage is automatically included as a dependency.
 */

import { unplugin, type BundlerPluginOptions } from "./plugin";

export type VitePluginOptions = BundlerPluginOptions;

export const vitePlugin = unplugin.vite;
