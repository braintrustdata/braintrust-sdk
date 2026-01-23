import Mustache from "mustache";

import { lintTemplate as lintMustacheTemplate } from "./mustache-utils";

export type TemplateFormat = "mustache" | "nunjucks" | "none";

export interface TemplateRenderer {
  render: (
    template: string,
    variables: Record<string, unknown>,
    escape: (v: unknown) => string,
    strict: boolean,
  ) => string;
  lint?: (template: string, variables: Record<string, unknown>) => void;
}

/**
 * A template renderer plugin that can be registered with Braintrust.
 *
 * Plugins provide support for different template engines (e.g., Nunjucks).
 * They use a factory pattern where the plugin is registered once, then activated with specific
 * configuration options when needed.
 *
 * @example
 * ```typescript
 * import type { TemplateRendererPlugin } from "braintrust";
 *
 * export const myPlugin: TemplateRendererPlugin = {
 *   name: "my-template-engine",
 *   version: "1.0.0",
 *   defaultOptions: { strict: false },
 *   createRenderer(options?: unknown) {
 *     const opts = options ?? this.defaultOptions;
 *     return {
 *       render(template, variables, escape, strict) {
 *         // Your rendering logic here
 *       }
 *     };
 *   }
 * };
 * ```
 */
export interface TemplateRendererPlugin {
  /**
   * Unique identifier for this plugin.
   * Must match the format string used in `templateFormat` option.
   */
  name: string;

  /**
   * Factory function that creates a renderer instance.
   * Called when `useTemplateRenderer()` is invoked.
   *
   * @param options - Configuration options passed to `useTemplateRenderer()`.
   *                  If not provided, `defaultOptions` is used.
   * @returns A configured TemplateRenderer instance
   */
  createRenderer: (options?: unknown) => TemplateRenderer;

  /**
   * Default configuration options for this plugin.
   * Used when `useTemplateRenderer()` is called without options.
   */
  defaultOptions?: unknown;
}

class TemplatePluginRegistry {
  private plugins = new Map<string, TemplateRendererPlugin>();
  private renderers = new Map<string, TemplateRenderer>();

  register(plugin: TemplateRendererPlugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(
        `Template plugin '${plugin.name}' already registered, overwriting`,
      );
    }
    this.plugins.set(plugin.name, plugin);
  }

  use(name: string, options?: unknown): void {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      const available = Array.from(this.plugins.keys()).join(", ");
      throw new Error(
        `Template plugin '${name}' not found. Available plugins: ${available || "none"}. Did you forget to import and register it?`,
      );
    }

    const opts = options ?? plugin.defaultOptions;
    this.renderers.set(name, plugin.createRenderer(opts));
  }

  get(name: string): TemplateRenderer | undefined {
    return this.renderers.get(name);
  }

  getAvailable(): string[] {
    return Array.from(this.plugins.keys());
  }

  getActive(): string[] {
    return Array.from(this.renderers.keys());
  }

  isRegistered(name: string): boolean {
    return this.plugins.has(name);
  }

  isActive(name: string): boolean {
    return this.renderers.has(name);
  }
}

export const templateRegistry = new TemplatePluginRegistry();

/**
 * Registers a template renderer plugin, making it available for activation.
 *
 * This is the first step in the two-phase plugin system. After registration,
 * use `useTemplateRenderer()` to activate the plugin with specific configuration.
 *
 * Registration does not instantiate the renderer - it only makes it available.
 * This allows for lazy instantiation and configuration at activation time.
 *
 * @param plugin - The template renderer plugin to register
 *
 * @example
 * ```typescript
 * import { registerTemplatePlugin } from "braintrust";
 * import { nunjucksPlugin } from "@braintrust/templates-nunjucks";
 *
 * // Register the plugin (does not instantiate)
 * registerTemplatePlugin(nunjucksPlugin);
 * ```
 */
export const registerTemplatePlugin =
  templateRegistry.register.bind(templateRegistry);

/**
 * Activates a registered template renderer plugin with optional configuration.
 *
 * This is the second step in the two-phase plugin system. The plugin must be
 * registered first using `registerTemplatePlugin()`.
 *
 * This function instantiates the renderer by calling the plugin's `createRenderer()`
 * factory function with the provided options (or default options if none provided).
 *
 * @param name - Name of the registered plugin to activate
 * @param options - Configuration options to pass to the renderer (optional)
 * @throws Error if the plugin is not registered
 *
 * @example
 * ```typescript
 * import { registerTemplatePlugin, useTemplateRenderer } from "braintrust";
 * import { nunjucksPlugin, type NunjucksOptions } from "@braintrust/templates-nunjucks";
 *
 * // Register the plugin
 * registerTemplatePlugin(nunjucksPlugin);
 *
 * // Activate with default options
 * useTemplateRenderer("nunjucks");
 *
 * // Or activate with custom options
 * useTemplateRenderer("nunjucks", {
 *   autoescape: false,
 *   throwOnUndefined: true
 * } as NunjucksOptions);
 * ```
 */
export const useTemplateRenderer = templateRegistry.use.bind(templateRegistry);

/**
 * Gets an active template renderer by name.
 *
 * Returns `undefined` if the renderer is not active (i.e., hasn't been activated
 * with `useTemplateRenderer()`). This is used internally by the Prompt system.
 *
 * @param name - Name of the renderer to retrieve
 * @returns The active renderer, or undefined if not activated
 *
 * @example
 * ```typescript
 * import { getTemplateRenderer } from "braintrust";
 *
 * const renderer = getTemplateRenderer("nunjucks");
 * if (renderer) {
 *   const output = renderer.render(template, variables, escape, strict);
 * }
 * ```
 */
export const getTemplateRenderer = templateRegistry.get.bind(templateRegistry);

// Built-in mustache plugin
const mustachePlugin: TemplateRendererPlugin = {
  name: "mustache",
  defaultOptions: {},
  createRenderer() {
    return {
      render(template, variables, escape) {
        return Mustache.render(template, variables, undefined, { escape });
      },
      lint(template, variables) {
        lintMustacheTemplate(template, variables);
      },
    };
  },
};

// Auto-register and activate mustache (built-in)
registerTemplatePlugin(mustachePlugin);
useTemplateRenderer("mustache");
