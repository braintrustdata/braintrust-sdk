import { configureBrowser } from "./browser-config";

// Configure browser environment on import
configureBrowser();

// Re-export everything from braintrust
export * from "braintrust";
export * as default from "braintrust";
