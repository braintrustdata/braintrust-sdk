/**
 * Rollup plugin for auto-instrumentation.
 *
 * Usage:
 * ```typescript
 * import { rollupPlugin } from '@braintrust/auto-instrumentations/bundler/rollup';
 *
 * export default {
 *   plugins: [rollupPlugin()]
 * };
 * ```
 *
 * This plugin uses @apm-js-collab/code-transformer to perform AST transformation
 * at build-time, injecting TracingChannel calls into AI SDK functions.
 *
 * For browser builds, the plugin automatically uses 'dc-browser' for diagnostics_channel polyfill.
 * The als-browser polyfill for AsyncLocalStorage is automatically included as a dependency.
 */

import type { InstrumentationConfig } from "@apm-js-collab/code-transformer";
import rollupPluginBase from "@apm-js-collab/code-transformer-bundler-plugins/rollup";
import { openaiConfigs } from "../configs/openai";
import { anthropicConfigs } from "../configs/anthropic";
import { aiSDKConfigs } from "../configs/ai-sdk";
import { claudeAgentSDKConfigs } from "../configs/claude-agent-sdk";
import { googleGenAIConfigs } from "../configs/google-genai";

export interface RollupPluginOptions {
  /**
   * Enable debug logging
   */
  debug?: boolean;

  /**
   * Additional instrumentation configs to apply
   */
  instrumentations?: InstrumentationConfig[];

  /**
   * Whether to bundle for browser environments.
   *
   * When true, uses 'dc-browser' and 'als-browser' for browser-compatible
   * diagnostics_channel and AsyncLocalStorage polyfills.
   * When false, uses Node.js built-in 'diagnostics_channel' and 'async_hooks'.
   * Defaults to true (assumes browser build).
   */
  browser?: boolean;
}

export function rollupPlugin(
  options: RollupPluginOptions = {},
): ReturnType<typeof rollupPluginBase> {
  const allInstrumentations = [
    ...openaiConfigs,
    ...anthropicConfigs,
    ...aiSDKConfigs,
    ...claudeAgentSDKConfigs,
    ...googleGenAIConfigs,
    ...(options.instrumentations || []),
  ];

  // Default to browser build, use polyfill unless explicitly disabled
  const dcModule = options.browser === false ? undefined : "dc-browser";

  return rollupPluginBase({
    instrumentations: allInstrumentations,
    dcModule,
  });
}
