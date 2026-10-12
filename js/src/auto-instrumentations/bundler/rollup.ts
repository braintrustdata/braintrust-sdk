import type { RollupPlugin } from "unplugin";
import { BundlerPluginOptions, unplugin } from "./plugin";

export function braintrustRollupPlugin(
  options: BundlerPluginOptions = {},
): RollupPlugin | RollupPlugin[] {
  return unplugin.rollup(options);
}

export type RollupPluginOptions = BundlerPluginOptions;

/**
 * @deprecated Use {@link braintrustRollupPlugin} instead.
 */
export const rollupPlugin = unplugin.rollup;
