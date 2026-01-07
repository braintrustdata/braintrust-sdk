import { register } from "node:module";
import { setupAutoInstrumentation } from "./index";

// Ensure braintrust is loaded first to register global wrappers
import "braintrust";

// @ts-ignore - import.meta.url is only used in ESM context
register("import-in-the-middle/hook.mjs", import.meta.url);

setupAutoInstrumentation();
