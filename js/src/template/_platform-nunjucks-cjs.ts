// CJS-specific nunjucks loader - only used in CommonJS builds
import { nunjucks as browserNunjucks } from "./nunjucks-browser";

type NunjucksModule = typeof import("nunjucks");

const resolveModule = (value: unknown): NunjucksModule => {
  if (value && (typeof value === "object" || typeof value === "function")) {
    const { default: maybeDefault } = value as { default?: unknown };
    if (
      maybeDefault &&
      (typeof maybeDefault === "object" || typeof maybeDefault === "function")
    ) {
      return maybeDefault as NunjucksModule;
    }
  }
  return value as NunjucksModule;
};

const loadNodeModule = (): NunjucksModule => {
  if (typeof require === "function") {
    return resolveModule(require("nunjucks"));
  }
  throw new Error("Failed to load nunjucks in a non-browser environment.");
};

const moduleForPlatform: NunjucksModule =
  typeof window === "undefined" ? loadNodeModule() : browserNunjucks;

export const nunjucks = moduleForPlatform;
