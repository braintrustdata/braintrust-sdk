import { nunjucks } from "./nunjucks";
import type {
  Environment as NunjucksEnvironment,
  ConfigureOptions,
} from "nunjucks";
import { SyncLazyValue } from "../util";

const createNunjucksEnv = (throwOnUndefined: boolean): NunjucksEnvironment => {
  const env = new nunjucks.Environment(null, {
    autoescape: false,
    throwOnUndefined,
  });
  return env;
};

const nunjucksEnv = new SyncLazyValue<NunjucksEnvironment>(() =>
  createNunjucksEnv(false),
);

const nunjucksStrictEnv = new SyncLazyValue<NunjucksEnvironment>(() =>
  createNunjucksEnv(true),
);

export function getNunjucksEnv(strict = false): NunjucksEnvironment {
  return strict ? nunjucksStrictEnv.get() : nunjucksEnv.get();
}

export function renderNunjucksString(
  template: string,
  variables: Record<string, unknown>,
  strict = false,
): string {
  // Preprocess variables to match Mustache escape function behavior
  const processedVariables = Object.fromEntries(
    Object.entries(variables).map(([key, val]) => {
      if (val === undefined) {
        throw new Error("Missing!");
      } else if (typeof val === "string") {
        return [key, val];
      } else {
        // For non-strings (objects, numbers, booleans, etc.), stringify
        return [key, JSON.stringify(val)];
      }
    }),
  );

  try {
    return getNunjucksEnv(strict).renderString(template, processedVariables);
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
