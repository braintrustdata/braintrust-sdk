/**
 * An isomorphic JS library for logging data to Braintrust. `braintrust` is distributed as a [library on NPM](https://www.npmjs.com/package/braintrust).
 * It is also open source and available on [GitHub](https://github.com/braintrustdata/braintrust-sdk/tree/main/js).
 *
 * ### Quickstart
 *
 * Install the library with npm (or yarn).
 *
 * ```bash
 * npm install braintrust
 * ```
 *
 * Then, run a simple experiment with the following code (replace `YOUR_API_KEY` with
 * your Braintrust API key):
 *
 * ```javascript
 * import { Eval } from "braintrust";
 *
 * function isEqual({ output, expected }: { output: string; expected?: string }) {
 *   return { name: "is_equal", score: output === expected ? 1 : 0 };
 * }
 *
 * Eval("Say Hi Bot", {
 *   data: () => {
 *     return [
 *       {
 *         input: "Foo",
 *         expected: "Hi Foo",
 *       },
 *       {
 *         input: "Bar",
 *         expected: "Hello Bar",
 *       },
 *     ]; // Replace with your eval dataset
 *   },
 *   task: (input: string) => {
 *     return "Hi " + input; // Replace with your LLM call
 *   },
 *   scores: [isEqual],
 * });
 * ```
 *
 * @module braintrust
 */

import { configureNode } from "./node";

configureNode();

export * from "./logger";
export {
  Evaluator,
  EvalTask,
  Eval,
  EvalMetadata,
  EvalScorerArgs,
} from "./framework";

export * from "./oai";
