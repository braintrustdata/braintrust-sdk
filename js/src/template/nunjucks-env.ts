import { nunjucks } from "./nunjucks";
import type { Environment as NunjucksEnvironment } from "nunjucks";
import { SyncLazyValue } from "../util";

type UnknownRecord = Record<PropertyKey, unknown>;

const isObject = (v: unknown): v is object =>
  typeof v === "object" && v !== null;
const isPlainObject = (v: unknown): v is UnknownRecord =>
  isObject(v) && !Array.isArray(v);

const toJsonString = (target: object) => () => JSON.stringify(target);

function wrapObjectWithStringify<T extends object>(obj: T): T {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      if (
        prop === "toString" ||
        prop === "valueOf" ||
        prop === Symbol.toPrimitive
      ) {
        return toJsonString(target);
      }

      const value = Reflect.get(target as UnknownRecord, prop, receiver);

      if (Array.isArray(value)) {
        return value.map((item) =>
          isPlainObject(item) ? wrapObjectWithStringify(item) : item,
        );
      }

      return isPlainObject(value) ? wrapObjectWithStringify(value) : value;
    },
  });
}

function wrapContextValues(
  context: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      isPlainObject(value)
        ? wrapObjectWithStringify(value)
        : Array.isArray(value)
          ? value.map((item) =>
              isPlainObject(item) ? wrapObjectWithStringify(item) : item,
            )
          : value,
    ]),
  );
}

const createNunjucksEnv = (throwOnUndefined: boolean): NunjucksEnvironment => {
  // html autoescape is turned off
  const env = new nunjucks.Environment(null, {
    autoescape: false,
    throwOnUndefined,
  });

  return new Proxy(env, {
    get(target, prop, receiver) {
      if (prop === "renderString") {
        return (template: string, context: Record<string, unknown> = {}) =>
          Reflect.get(target, prop, receiver).call(
            target,
            template,
            wrapContextValues(context),
          );
      }
      return Reflect.get(target as unknown as UnknownRecord, prop, receiver);
    },
  });
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
