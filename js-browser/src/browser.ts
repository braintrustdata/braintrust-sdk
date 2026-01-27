import { configureBrowser } from "./browser-config";

configureBrowser();

// eslint-disable-next-line no-restricted-syntax -- already enforced in exports
export * from "../../js/src/exports";
export * as default from "../../js/src/exports";
