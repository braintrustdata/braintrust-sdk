declare module "nunjucks" {
  export class Environment {
    constructor(
      loader?: unknown,
      opts?: { autoescape?: boolean; throwOnUndefined?: boolean },
    );
    renderString(template: string, context?: unknown): string;
  }
  const nunjucks: {
    Environment: typeof Environment;
  };
  export default nunjucks;
}
