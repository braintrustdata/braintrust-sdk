import Mustache from "mustache";
import type { TemplateRendererPlugin } from "../registry";
import { lintTemplate as lintMustacheTemplate } from "../mustache-utils";

const jsonEscape = (v: unknown) =>
  typeof v === "string" ? v : JSON.stringify(v);

export const mustachePlugin: TemplateRendererPlugin = {
  name: "mustache",
  defaultOptions: { strict: true, escape: jsonEscape },
  createRenderer() {
    const opts = (this.defaultOptions ?? {}) as any;
    const escapeFn: (v: unknown) => string = opts?.escape ?? jsonEscape;
    const strictDefault: boolean =
      typeof opts?.strict === "boolean" ? opts.strict : true;

    return {
      render(template, variables, escape, strict) {
        const esc = escape ?? escapeFn;
        const strictMode = typeof strict === "boolean" ? strict : strictDefault;
        if (strictMode) lintMustacheTemplate(template, variables);
        return Mustache.render(template, variables, undefined, { escape: esc });
      },
      lint(template, variables) {
        lintMustacheTemplate(template, variables);
      },
    };
  },
};
