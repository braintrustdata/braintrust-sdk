import * as nunjucks from "nunjucks";

import type { TemplateRendererPlugin } from "braintrust";

/**
 * Configuration options for the Nunjucks template renderer.
 *
 * @example
 * ```typescript
 * import { registerTemplatePlugin, useTemplateRenderer } from "braintrust";
 * import { nunjucksPlugin, type NunjucksOptions } from "@braintrust/templates-nunjucks-js";
 *
 * registerTemplatePlugin(nunjucksPlugin);
 * useTemplateRenderer("nunjucks", {
 *   autoescape: true,
 *   throwOnUndefined: false
 * } as NunjucksOptions);
 * ```
 */
export interface NunjucksOptions {
  /**
   * Controls whether HTML escaping is enabled for template variables.
   *
   * When `true` (default), variables are automatically HTML-escaped to prevent XSS attacks.
   * When `false`, variables are rendered as-is without escaping.
   *
   * @default true
   * @example
   * ```typescript
   * // With autoescape enabled (default)
   * useTemplateRenderer("nunjucks", { autoescape: true });
   * // Template: "{{ html }}"
   * // Variables: { html: "<div>Test</div>" }
   * // Output: "&lt;div&gt;Test&lt;/div&gt;"
   *
   * // With autoescape disabled
   * useTemplateRenderer("nunjucks", { autoescape: false });
   * // Output: "<div>Test</div>"
   * ```
   */
  autoescape?: boolean;

  /**
   * Controls whether undefined variables throw errors.
   *
   * When `true`, accessing undefined variables throws an error, making it easier to catch typos.
   * When `false` (default), undefined variables render as empty strings.
   *
   * Note: When using `prompt.build()` with `strict: true`, this is always enabled for linting.
   *
   * @default false
   * @example
   * ```typescript
   * // Lenient mode (default) - typos render as empty
   * useTemplateRenderer("nunjucks", { throwOnUndefined: false });
   * // Template: "Hello {{ userName }}"
   * // Variables: { userName: "Alice" }
   * // Output: "Hello Alice"
   *
   * // Strict mode - typos throw errors
   * useTemplateRenderer("nunjucks", { throwOnUndefined: true });
   * // Output: Error: Variable 'userName' is undefined
   * ```
   */
  throwOnUndefined?: boolean;
}

/**
 * Nunjucks template renderer plugin for Braintrust.
 *
 * Provides support for Nunjucks/Jinja2-style templating in Braintrust prompts,
 * including loops, conditionals, filters, and more.
 *
 * @example
 * ```typescript
 * import { registerTemplatePlugin, useTemplateRenderer, Prompt } from "braintrust";
 * import { nunjucksPlugin } from "@braintrust/templates-nunjucks-js";
 *
 * // Register and activate the plugin
 * registerTemplatePlugin(nunjucksPlugin);
 * useTemplateRenderer("nunjucks");
 *
 * // Use in prompts
 * const prompt = new Prompt({
 *   name: "example",
 *   slug: "example",
 *   prompt_data: {
 *     prompt: {
 *       type: "chat",
 *       messages: [{
 *         role: "user",
 *         content: "{% for item in items %}{{ item }}{% if not loop.last %}, {% endif %}{% endfor %}"
 *       }]
 *     },
 *     options: { model: "gpt-4" }
 *   }
 * }, {}, false);
 *
 * const result = prompt.build(
 *   { items: ["apple", "banana", "cherry"] },
 *   { templateFormat: "nunjucks" }
 * );
 * // Output: "apple, banana, cherry"
 * ```
 */
export const nunjucksPlugin: TemplateRendererPlugin = {
  name: "nunjucks",
  defaultOptions: {
    autoescape: true,
    throwOnUndefined: false,
  } as NunjucksOptions,
  createRenderer() {
    const opts = (this.defaultOptions ?? {}) as NunjucksOptions;
    const autoescape = opts.autoescape ?? true;
    const throwOnUndefined = opts.throwOnUndefined ?? false;

    const env = new nunjucks.Environment(null, {
      autoescape,
      throwOnUndefined,
    });

    const strictEnv = new nunjucks.Environment(null, {
      autoescape: true,
      throwOnUndefined: true,
    });

    return {
      render(
        template: string,
        variables: Record<string, unknown>,
        _escape: (v: unknown) => string,
        strict: boolean,
      ) {
        return (strict ? strictEnv : env).renderString(template, variables);
      },
      lint(template: string, variables: Record<string, unknown>) {
        strictEnv.renderString(template, variables);
      },
    };
  },
};
