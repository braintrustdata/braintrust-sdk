import { nunjucks } from "./nunjucks";
import type { Environment as NunjucksEnvironment } from "nunjucks";
import { SyncLazyValue } from "../util";

const createNunjucksEnv = (throwOnUndefined: boolean): NunjucksEnvironment => {
  return new nunjucks.Environment(null, {
    autoescape: true,
    throwOnUndefined,
  });
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
    throw error;
  }
}
