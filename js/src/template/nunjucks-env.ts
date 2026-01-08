import { nunjucks } from "./nunjucks";
import type {
  Environment as NunjucksEnvironment,
  ConfigureOptions,
} from "nunjucks";
import { SyncLazyValue } from "../util";

function wrapObjectWithStringify(obj: object): object {
  return new Proxy(obj, {
    get(target, prop) {
      if (prop === "toString" || prop === "valueOf") {
        return () => JSON.stringify(target);
      }
      if (prop === Symbol.toPrimitive) {
        return () => JSON.stringify(target);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = (target as any)[prop];
      if (typeof value === "object" && value !== null) {
        if (Array.isArray(value)) {
          // Wrap objects inside arrays so {% for item in array %} works
          return value.map((item) =>
            typeof item === "object" && item !== null && !Array.isArray(item)
              ? wrapObjectWithStringify(item)
              : item,
          );
        } else {
          // Recursively wrap nested objects
          return wrapObjectWithStringify(value);
        }
      }
      return value;
    },
  });
}

const createNunjucksEnv = (throwOnUndefined: boolean): NunjucksEnvironment => {
  const env = new nunjucks.Environment(null, {
    autoescape: false,
    throwOnUndefined,
  });

  // Intercept renderString to wrap objects with custom toString
  const originalRenderString = env.renderString.bind(env);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (env as any).renderString = function (template: string, context: any) {
    // Wrap context values with custom toString
    const wrappedContext: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(context || {})) {
      if (typeof val === "object" && val !== null) {
        if (Array.isArray(val)) {
          // Wrap objects inside arrays so {% for item in array %} {{ item }} works
          wrappedContext[key] = val.map((item) =>
            typeof item === "object" && item !== null && !Array.isArray(item)
              ? wrapObjectWithStringify(item)
              : item,
          );
        } else {
          // Wrap objects with custom toString to prevent [object Object]
          wrappedContext[key] = wrapObjectWithStringify(val);
        }
      } else {
        wrappedContext[key] = val;
      }
    }
    return originalRenderString(template, wrappedContext);
  };

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
  try {
    return getNunjucksEnv(strict).renderString(template, variables);
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
