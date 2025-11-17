// ESM-specific nunjucks loader - nunjucks is not bundled, must be installed separately
import { nunjucks as browserNunjucks } from "./nunjucks-browser";

type NunjucksModule = typeof import("nunjucks");

// In ESM builds, nunjucks is external and not available
// Users need to install it separately if they want to use nunjucks templates
const moduleForPlatform: NunjucksModule | undefined =
  typeof window === "undefined" ? undefined : browserNunjucks;

export const nunjucks = moduleForPlatform;
