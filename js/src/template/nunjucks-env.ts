import { nunjucks } from "./nunjucks";
import type { Environment as NunjucksEnvironment } from "nunjucks";
import { SyncLazyValue } from "../util";

const createNunjucksEnv = (throwOnUndefined: boolean): NunjucksEnvironment => {
  // html autoescape is turned off
  const env = new nunjucks.Environment(null, {
    autoescape: false,
    throwOnUndefined,
  });

  // Add 'tojson' as an alias for 'dump' to match Python Jinja2
  env.addFilter("tojson", (value: unknown) => JSON.stringify(value));

  return env;
};

const nunjucksEnv = new SyncLazyValue<NunjucksEnvironment>(() =>
  createNunjucksEnv(false),
);

const nunjucksStrictEnv = new SyncLazyValue<NunjucksEnvironment>(() =>
  createNunjucksEnv(true),
);

export function getNunjucksEnv(options?: {
  strict?: boolean;
}): NunjucksEnvironment {
  const strict = options?.strict ?? false;
  return strict ? nunjucksStrictEnv.get() : nunjucksEnv.get();
}

export function renderNunjucksString(
  template: string,
  variables: Record<string, unknown>,
  strict = false,
): string {
  try {
    return getNunjucksEnv({ strict }).renderString(template, variables);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(
        "Code generation from strings disallowed for this context",
      )
    ) {
      throw new Error(
        `String template rendering. Disallowed in this environment for security reasons. Try a different template renderer. Original error: ${error.message}`,
      );
    }
    throw error;
  }
}
