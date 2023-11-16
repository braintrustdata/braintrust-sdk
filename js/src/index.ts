/**
 * An isomorphic JS library for logging data to Braintrust. `braintrust` is distributed as a [library on NPM](https://www.npmjs.com/package/braintrust).
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
 * import * as braintrust from "braintrust";
 *
 * const experiment = await braintrust.init("NodeTest", {apiKey: "YOUR_API_KEY"});
 * experiment.log({
 *   inputs: {test: 1},
 *   output: "foo",
 *   expected: "bar",
 *   scores: {
 *     n: 0.5,
 *   },
 *   metadata: {
 *     id: 1,
 *   },
 * });
 * console.log(await experiment.summarize());
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
