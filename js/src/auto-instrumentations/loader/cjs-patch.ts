/**
 * CJS module patcher for auto-instrumentation.
 * Patches Module.prototype._compile to transform CommonJS modules at load time.
 */

import {
  create,
  type InstrumentationConfig,
} from "@apm-js-collab/code-transformer";
import * as Module from "node:module";
import { sep } from "node:path";
import moduleDetailsFromPath from "module-details-from-path";
import { getPackageVersion } from "./get-package-version.js";

export class ModulePatch {
  private packages: Set<string>;
  private instrumentator: any;
  private originalCompile: any;

  constructor({
    instrumentations = [],
  }: { instrumentations?: InstrumentationConfig[] } = {}) {
    this.packages = new Set(instrumentations.map((i) => i.module.name));
    this.instrumentator = create(instrumentations);
    this.originalCompile = (Module.prototype as any)._compile;
  }

  /**
   * Patches the Node.js module class method that is responsible for compiling code.
   * If a module is found that has an instrumentator, it will transform the code before compiling it
   * with tracing channel methods.
   */
  patch() {
    const self = this;
    (Module.prototype as any)._compile = function wrappedCompile(
      ...args: any[]
    ) {
      const [content, filename] = args;

      // Normalize path to platform-specific separator for module-details-from-path
      const normalizedForPlatform = filename.split("/").join(sep);

      const resolvedModule = moduleDetailsFromPath(normalizedForPlatform);

      if (resolvedModule && self.packages.has(resolvedModule.name)) {
        const version = getPackageVersion(resolvedModule.basedir);

        // Normalize module path for WASM transformer (expects forward slashes)
        const normalizedModulePath = resolvedModule.path.replace(/\\/g, "/");

        const transformer = self.instrumentator.getTransformer(
          resolvedModule.name,
          version,
          normalizedModulePath,
        );

        if (transformer) {
          try {
            const transformedCode = transformer.transform(content, "unknown");
            args[0] = transformedCode?.code;
          } catch (error) {
            console.warn(`Error transforming module ${filename}:`, error);
          } finally {
            transformer.free();
          }
        }
      }

      return self.originalCompile.apply(this, args);
    };
  }

  /**
   * Restores the original Module.prototype._compile method
   * **Note**: This is intended to be used in testing only.
   */
  unpatch() {
    (Module.prototype as any)._compile = this.originalCompile;
  }
}
