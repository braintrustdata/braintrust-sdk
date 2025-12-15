import { configureBrowser } from "./browser-config";

configureBrowser();

// eslint-disable-next-line no-restricted-syntax -- already enforced in exports
export * from "./exports";
export * as default from "./exports";
