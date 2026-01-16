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

const renderers = new Map<Exclude<TemplateFormat, "none">, TemplateRenderer>();

renderers.set("mustache", {
  render(template, variables, escape) {
    return Mustache.render(template, variables, undefined, { escape });
  },
  lint(template, variables) {
    lintMustacheTemplate(template, variables);
  },
});

export function registerTemplateRenderer(
  format: Exclude<TemplateFormat, "none">,
  renderer: TemplateRenderer,
): void {
  renderers.set(format, renderer);
}

export function getTemplateRenderer(
  format: Exclude<TemplateFormat, "none">,
): TemplateRenderer | undefined {
  return renderers.get(format);
}
