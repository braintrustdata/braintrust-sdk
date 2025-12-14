import { configureBrowser } from "./browser-config";

configureBrowser();

// eslint-disable-next-line no-restricted-syntax -- already enforced in exports-browser
export * from "./exports-browser";
export * as default from "./exports-browser";
