import * as nunjucks from "nunjucks";

import { registerTemplateRenderer } from "braintrust";

const createEnv = (throwOnUndefined: boolean) =>
  new nunjucks.Environment(null, {
    autoescape: true,
    throwOnUndefined,
  });

const env = createEnv(false);
const strictEnv = createEnv(true);

registerTemplateRenderer("nunjucks", {
  render(template, variables, _escape, strict) {
    return (strict ? strictEnv : env).renderString(template, variables);
  },
  lint(template, variables) {
    strictEnv.renderString(template, variables);
  },
});
