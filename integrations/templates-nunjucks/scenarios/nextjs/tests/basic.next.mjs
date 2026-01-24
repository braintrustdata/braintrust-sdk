import { runNunjucksTests, reportAndExit } from "../shared/run-tests.mjs";

(async () => {
  const results = await runNunjucksTests();
  reportAndExit(results);
})();
