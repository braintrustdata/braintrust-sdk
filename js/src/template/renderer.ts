import Mustache from "mustache";
import { lintTemplate as lintMustacheTemplate } from "./mustache-utils";
import iso from "../isomorph";

export type TemplateFormat = "mustache" | "nunjucks" | "none";

export function isTemplateFormat(v: unknown): v is TemplateFormat {
  return v === "mustache" || v === "nunjucks" || v === "none";
}

export function parseTemplateFormat(
  value: unknown,
  defaultFormat: TemplateFormat = "mustache",
): TemplateFormat {
  return isTemplateFormat(value) ? value : defaultFormat;
}

export function renderTemplateContent(
  template: string,
  variables: Record<string, unknown>,
  escape: (v: unknown) => string,
  options: { strict?: boolean; templateFormat?: TemplateFormat },
): string {
  const strict = !!options.strict;
  const templateFormat = parseTemplateFormat(options.templateFormat);
  if (templateFormat === "nunjucks") {
    if (strict) {
      iso.lintNunjucksTemplate(template, variables);
    }
    return iso.renderNunjucksString(template, variables, strict);
  } else if (templateFormat === "mustache") {
    if (strict) {
      lintMustacheTemplate(template, variables);
    }
    return Mustache.render(template, variables, undefined, {
      escape,
    });
  }
  return template;
}
