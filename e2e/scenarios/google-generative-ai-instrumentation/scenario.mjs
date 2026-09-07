import { createRequire } from "node:module";
import { runMain } from "../../helpers/provider-runtime.mjs";
import { runScenario } from "./scenario.impl.mjs";

runMain(async () => {
  const packageName = process.env.GOOGLE_GENERATIVE_AI_PACKAGE_NAME;
  const sdk =
    process.env.GOOGLE_GENERATIVE_AI_MODULE === "esm"
      ? await import(packageName)
      : createRequire(import.meta.url)(packageName);
  await runScenario(sdk, process.env.GOOGLE_GENERATIVE_AI_WRAP === "true");
});
