import * as nunjucksNodeModule from "nunjucks";
import nunjucksBrowserModule from "../vendor/nunjucks.min.js";

type NunjucksModule = typeof import("nunjucks");

const resolveModule = (value: unknown): NunjucksModule | null => {
  if (!value) {
    return null;
  }
  if (typeof value === "object" || typeof value === "function") {
    const mod = value as { default?: unknown };
    const maybeDefault = mod.default;
    if (
      maybeDefault &&
      (typeof maybeDefault === "object" || typeof maybeDefault === "function")
    ) {
      return maybeDefault as NunjucksModule;
    }
  }
  return value as NunjucksModule;
};

const nodeModule =
  resolveModule(nunjucksNodeModule) ?? (nunjucksNodeModule as NunjucksModule);

const browserModule =
  resolveModule(nunjucksBrowserModule) ??
  (globalThis as { nunjucks?: NunjucksModule }).nunjucks ??
  null;

export const nunjucks: NunjucksModule =
  typeof window === "undefined" ? nodeModule : browserModule ?? nodeModule;

if (typeof window !== "undefined" && browserModule === null) {
  throw new Error("Failed to load nunjucks browser bundle.");
}
