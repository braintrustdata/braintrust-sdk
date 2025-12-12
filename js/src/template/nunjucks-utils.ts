import * as nunjucks from "nunjucks";

export function lintTemplate(template: string, context: any): void {
  const env = new nunjucks.Environment(null, {
    autoescape: true,
    throwOnUndefined: true,
  });
  env.renderString(template, context);
}
