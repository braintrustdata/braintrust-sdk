/**
 * esbuild plugin for auto-instrumentation.
 *
 * Usage:
 * ```typescript
 * import { esbuildPlugin } from '@braintrust/auto-instrumentations/bundler/esbuild';
 *
 * await esbuild.build({
 *   plugins: [esbuildPlugin()],
 * });
 * ```
 *
 * This plugin uses @apm-js-collab/code-transformer to perform AST transformation
 * at build-time, injecting TracingChannel calls into AI SDK functions.
 *
 * For browser builds, the plugin automatically uses 'dc-browser' for diagnostics_channel polyfill.
 * The als-browser polyfill for AsyncLocalStorage is automatically included as a dependency.
 */

import type { InstrumentationConfig } from "@apm-js-collab/code-transformer";
import esbuildPluginBase from "@apm-js-collab/code-transformer-bundler-plugins/esbuild";
import { openaiConfigs } from "../configs/openai";
import { anthropicConfigs } from "../configs/anthropic";
import { aiSDKConfigs } from "../configs/ai-sdk";
import { claudeAgentSDKConfigs } from "../configs/claude-agent-sdk";
import { googleGenAIConfigs } from "../configs/google-genai";

export interface EsbuildPluginOptions {
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

export function esbuildPlugin(
  options: EsbuildPluginOptions = {},
): ReturnType<typeof esbuildPluginBase> {
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

  return esbuildPluginBase({
    instrumentations: allInstrumentations,
    dcModule,
  });
}
