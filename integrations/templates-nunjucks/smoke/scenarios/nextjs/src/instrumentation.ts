export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Use dynamic imports to avoid bundling Node.js-only packages for edge runtime
    const { registerTemplatePlugin } = await import("braintrust");
    const { nunjucksPlugin } = await import(
      "@braintrust/templates-nunjucks-js"
    );
    registerTemplatePlugin(nunjucksPlugin);
  }
}
