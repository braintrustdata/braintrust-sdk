import chalk from "chalk";
import {
  NOOP_SPAN,
  Experiment,
  ExperimentSummary,
  Metadata,
  Span,
  currentSpan,
  init,
  withCurrent,
} from "./logger";
import { Score } from "@braintrust/core";
import { BarProgressReporter, ProgressReporter } from "./progress";
import pluralize from "pluralize";

export interface EvalCase<Input, Expected> {
  input: Input;
  expected?: Expected;
  metadata?: Metadata;
}

export type EvalData<Input, Expected> =
  | (() => EvalCase<Input, Expected>[])
  | (() => Promise<EvalCase<Input, Expected>[]>);

export type EvalTask<Input, Output> =
  | ((input: Input, hooks: EvalHooks) => Promise<Output>)
  | ((input: Input, hooks: EvalHooks) => Output);

export interface EvalHooks {
  meta: (info: Record<string, unknown>) => void;
  span: Span;
}

// This happens to be compatible with ScorerArgs defined in @braintrust/core.
export type EvalScorerArgs<Input, Output, Expected> = EvalCase<
  Input,
  Expected
> & {
  output: Output;
};

export type EvalScorer<Input, Output, Expected> = (
  args: EvalScorerArgs<Input, Output, Expected>
) => Score | Promise<Score>;

/**
 * An evaluator is a collection of functions that can be used to evaluate a model.
 * It consists of:
 * - `data`, a function that returns a list of inputs, expected outputs, and metadata
 * - `task`, a function that takes an input and returns an output
 * - `scores`, a set of functions that take an input, output, and expected value and return a score
 * - `experimentName`, an optional name for the experiment.
 * - `trialCount`, the number of times to run the evaluator per input. This is useful for evaluating applications that
 *   have non-deterministic behavior and gives you both a stronger aggregate measure and a sense of the
 *   variance in the results.
 * - `metadata`, optional additional metadata for the experiment.
 */
export interface Evaluator<Input, Output, Expected> {
  data: EvalData<Input, Expected>;
  task: EvalTask<Input, Output>;
  scores: EvalScorer<Input, Output, Expected>[];
  experimentName?: string;
  trialCount?: number;
  metadata?: Metadata;
}

function makeEvalName(projectName: string, experimentName?: string) {
  let out = projectName;
  if (experimentName) {
    out += ` [experimentName=${experimentName}]`;
  }
  return out;
}

export type EvaluatorDef<Input, Output, Expected> = {
  projectName: string;
  evalName: string;
} & Evaluator<Input, Output, Expected>;

export type EvaluatorFile = {
  [evalName: string]: EvaluatorDef<any, any, any>;
};

declare global {
  var _evals: EvaluatorFile;
  var _lazy_load: boolean;
}

globalThis._evals = {};

export async function Eval<Input, Output, Expected>(
  name: string,
  evaluator: Evaluator<Input, Output, Expected>
): Promise<void | ExperimentSummary> {
  const evalName = makeEvalName(name, evaluator.experimentName);
  if (_evals[evalName]) {
    throw new Error(`Evaluator ${evalName} already exists`);
  }
  if (globalThis._lazy_load) {
    _evals[evalName] = { evalName, projectName: name, ...evaluator };
    return;
  }

  const progressReporter = new BarProgressReporter();
  try {
    const experiment = await init(name, {
      experiment: evaluator.experimentName,
      metadata: evaluator.metadata,
    });
    try {
      const ret = await runEvaluator(
        experiment,
        {
          evalName,
          projectName: name,
          ...(evaluator as Evaluator<unknown, unknown, unknown>),
        },
        progressReporter,
        []
      );
      reportEvaluatorResult(name, ret, true);
      return ret.summary!;
    } finally {
      experiment.flush();
    }
  } finally {
    progressReporter.stop();
  }
}

export function getLoadedEvals() {
  return _evals;
}

export interface Filter {
  path: string[];
  pattern: RegExp;
}

export function serializeJSONWithPlainString(v: any) {
  if (typeof v === "string") {
    return v;
  } else {
    return JSON.stringify(v);
  }
}

export function deserializePlainStringAsJSON(s: string) {
  try {
    return { value: JSON.parse(s), error: undefined };
  } catch (e) {
    return { value: s, error: e };
  }
}

export function parseFilters(filters: string[]): Filter[] {
  const result: Filter[] = [];
  for (const f of filters) {
    const equalsIdx = f.indexOf("=");
    if (equalsIdx === -1) {
      throw new Error(`Invalid filter ${f}`);
    }
    const [path, value] = [f.slice(0, equalsIdx), f.slice(equalsIdx + 1)];
    let deserializedValue = deserializePlainStringAsJSON(value).value;
    if (typeof deserializedValue !== "string") {
      deserializedValue = value; // Just fall back to the original input
    }
    result.push({
      path: path.split("."),
      pattern: new RegExp(deserializedValue),
    });
  }
  return result;
}

function evaluateFilter(object: any, filter: Filter) {
  const { path, pattern } = filter;
  const key = path.reduce((acc, p) => acc?.[p], object);
  if (key === undefined) {
    return false;
  }
  return pattern.test(serializeJSONWithPlainString(key));
}

export async function runEvaluator(
  experiment: Experiment | null,
  evaluator: EvaluatorDef<unknown, unknown, unknown>,
  progressReporter: ProgressReporter,
  filters: Filter[]
) {
  if (typeof evaluator.data === "string") {
    throw new Error("Unimplemented: string data paths");
  }
  const dataResult = evaluator.data();
  let data = null;
  if (dataResult instanceof Promise) {
    data = await dataResult;
  } else {
    data = dataResult;
  }

  data = data.filter((d) => filters.every((f) => evaluateFilter(d, f)));

  progressReporter.start(evaluator.evalName, data.length);

  const evals = data
    .flatMap((datum) =>
      [...Array(evaluator.trialCount ?? 1).keys()].map(() => datum)
    )
    .map(async (datum) => {
      let metadata: Metadata = { ...datum.metadata };
      let output: any = undefined;
      let error: unknown | undefined = undefined;
      let scores: Record<string, number> = {};
      const callback = async () => {
        try {
          const meta = (o: Record<string, unknown>) =>
            (metadata = { ...metadata, ...o });

          await currentSpan().traced("task", async () => {
            const outputResult = evaluator.task(datum.input, {
              meta,
              span: currentSpan(),
            });
            if (outputResult instanceof Promise) {
              output = await outputResult;
            } else {
              output = outputResult;
            }
            currentSpan().log({ input: datum.input, output });
          });
          currentSpan().log({ output });

          const scoringArgs = { ...datum, metadata, output };
          const scoreResults = await Promise.all(
            evaluator.scores.map(async (score, score_idx) => {
              return currentSpan().traced(
                score.name || `scorer_${score_idx}`,
                async () => {
                  const scoreResult = score(scoringArgs);
                  const result =
                    scoreResult instanceof Promise
                      ? await scoreResult
                      : scoreResult;
                  const {
                    metadata: resultMetadata,
                    name: _,
                    ...resultRest
                  } = result;
                  currentSpan().log({
                    output: resultRest,
                    metadata: resultMetadata,
                  });
                  return result;
                },
                {
                  event: { input: scoringArgs },
                }
              );
            })
          );

          const scoreMetadata: Record<string, unknown> = {};
          for (const scoreResult of scoreResults) {
            scores[scoreResult.name] = scoreResult.score;
            const metadata = {
              ...scoreResult.metadata,
            };
            if (scoreResult.error !== undefined) {
              metadata.error = scoreResult.error;
            }
            if (Object.keys(metadata).length > 0) {
              scoreMetadata[scoreResult.name] = metadata;
            }
          }

          if (Object.keys(scoreMetadata).length > 0) {
            meta({ scores: scoreMetadata });
          }

          currentSpan().log({ scores, metadata });
        } catch (e) {
          error = e;
        } finally {
          progressReporter.increment(evaluator.evalName);
        }

        return {
          output,
          metadata,
          scores,
          error,
        };
      };

      const rootSpan: Span = experiment
        ? experiment.startSpan({
            name: "eval",
            event: {
              input: datum.input,
              expected: datum.expected,
            },
          })
        : NOOP_SPAN;
      try {
        return await withCurrent(rootSpan, callback);
      } finally {
        rootSpan.end();
      }
    });
  const results = await Promise.all(evals);
  const summary = experiment ? await experiment.summarize() : null;
  return {
    results,
    summary,
  };
}

export const error = chalk.bold.red;
export const warning = chalk.hex("#FFA500"); // Orange color

export function logError(e: unknown, verbose: boolean) {
  if (!verbose) {
    console.error(`${e}`);
  } else {
    console.error(e);
  }
}

export function reportEvaluatorResult(
  evaluatorName: string | number,
  evaluatorResult: {
    results: { scores: Record<string, number>; error: unknown }[];
    summary: unknown;
  },
  verbose: boolean
) {
  const { results, summary } = evaluatorResult;
  const failingResults = results.filter(
    (r: { error: unknown }) => r.error !== undefined
  );

  if (failingResults.length > 0) {
    // TODO: We may want to support a non-strict mode (and make this the "strict" behavior), so that
    // users can still log imperfect evaluations. In the meantime, they should handle these cases inside
    // of their tasks.
    console.warn(
      warning(
        `Evaluator ${evaluatorName} failed with ${pluralize(
          "error",
          failingResults.length,
          true
        )}. This evaluation ("${evaluatorName}") will not be fully logged.`
      )
    );
    for (const result of failingResults) {
      logError(result.error, verbose);
    }
    if (!verbose) {
      console.warn(warning("Add --verbose to see full stack traces."));
    }
  } else if (summary) {
    console.log(summary);
  } else {
    const scoresByName: { [name: string]: { total: number; count: number } } =
      {};
    for (const result of results) {
      for (const [name, score] of Object.entries(result.scores)) {
        const { total, count } = scoresByName[name] || { total: 0, count: 0 };
        scoresByName[name] = { total: total + score, count: count + 1 };
      }
    }

    const summary = {
      scores: Object.fromEntries(
        Object.entries(scoresByName).map(([name, { total, count }]) => [
          name,
          {
            name,
            score: total / count,
          },
        ])
      ),
    };

    console.log(summary);
  }
}
