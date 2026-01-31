/**
 * Type declarations for @apm-js-collab packages
 */

import type { InstrumentationConfig } from "@apm-js-collab/code-transformer";

declare module "@apm-js-collab/tracing-hooks" {
  export class ModulePatch {
    constructor(instrumentations: InstrumentationConfig[]);
    patch(): void;
  }
}

interface PluginOptions {
  instrumentations: InstrumentationConfig[];
  dcModule?: string;
}

declare module "@apm-js-collab/code-transformer-bundler-plugins/vite" {
  export default function vite(options?: PluginOptions): any;
}

declare module "@apm-js-collab/code-transformer-bundler-plugins/webpack" {
  export default function webpack(options?: PluginOptions): any;
}

declare module "@apm-js-collab/code-transformer-bundler-plugins/esbuild" {
  export default function esbuild(options?: PluginOptions): any;
}

declare module "@apm-js-collab/code-transformer-bundler-plugins/rollup" {
  export default function rollup(options?: PluginOptions): any;
}
