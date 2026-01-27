import { registerTemplatePlugin } from "braintrust";
import { nunjucksPlugin } from "@braintrust/templates-nunjucks-js";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    registerTemplatePlugin(nunjucksPlugin);
  }
}
