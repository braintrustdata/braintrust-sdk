import { getNunjucksEnv } from "./nunjucks-env";

export function lintTemplate(template: string, context: any): void {
  const env = getNunjucksEnv({ strict: true });
  env.renderString(template, context);
}
