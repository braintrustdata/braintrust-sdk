import chalk from "chalk";
import {
  NOOP_SPAN,
  Experiment,
  ExperimentSummary,
  Metadata,
  Span,
  init,
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

export interface Evaluator<Input, Output, Expected> {
  /**
   * A function that returns a list of inputs, expected outputs, and metadata.
   */
  data: EvalData<Input, Expected>;

  /**
   * A function that takes an input and returns an output.
   */
  task: EvalTask<Input, Output>;

  /**
   * A set of functions that take an input, output, and expected value and return a score.
   */
  scores: EvalScorer<Input, Output, Expected>[];

  /**
   * An optional name for the experiment.
   */
  experimentName?: string;

  /**
   * The number of times to run the evaluator per input. This is useful for evaluating applications that
   * have non-deterministic behavior and gives you both a stronger aggregate measure and a sense of the
   * variance in the results.
   */
  trialCount?: number;

  /**
   * Optional additional metadata for the experiment.
   */
  metadata?: Metadata;

  /**
   * Whether the experiment should be public. Defaults to false.
   */
  isPublic?: boolean;
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
    const experiment = init(name, {
      experiment: evaluator.experimentName,
      metadata: evaluator.metadata,
      isPublic: evaluator.isPublic,
      setCurrent: false,
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
      reportEvaluatorResult(name, ret, { verbose: true, jsonl: false });
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
      const callback = async (rootSpan: Span) => {
        try {
          const meta = (o: Record<string, unknown>) =>
            (metadata = { ...metadata, ...o });

          await rootSpan.traced(
            async (span: Span) => {
              const outputResult = evaluator.task(datum.input, { meta, span });
              if (outputResult instanceof Promise) {
                output = await outputResult;
              } else {
                output = outputResult;
              }
              span.log({ input: datum.input, output });
            },
            { name: "task" }
          );
          rootSpan.log({ output });

          const scoringArgs = { ...datum, metadata, output };
          const scoreResults = await Promise.all(
            evaluator.scores.map(async (score, score_idx) => {
              return rootSpan.traced(
                async (span: Span) => {
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
                  span.log({
                    output: resultRest,
                    metadata: resultMetadata,
                  });
                  return result;
                },
                {
                  name: score.name || `scorer_${score_idx}`,
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

          rootSpan.log({ scores, metadata });
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

      if (!experiment) {
        return await callback(NOOP_SPAN);
      } else {
        return await experiment.traced(callback, {
          name: "eval",
          event: {
            input: datum.input,
            expected: datum.expected,
          },
        });
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
  {
    verbose,
    jsonl,
  }: {
    verbose: boolean;
    jsonl: boolean;
  }
) {
  const { results, summary } = evaluatorResult;
  const failingResults = results.filter(
    (r: { error: unknown }) => r.error !== undefined
  );

  if (failingResults.length > 0) {
    // TODO: We may want to support a non-strict mode (and make this the "strict" behavior), so that
    // users can still log imperfect evaluations. In the meantime, they should handle these cases inside
    // of their tasks.
    console.error(
      warning(
        `Evaluator ${evaluatorName} failed with ${pluralize(
          "error",
          failingResults.length,
          true
        )}. This evaluation ("${evaluatorName}") will not be fully logged.`
      )
    );
    if (jsonl) {
      console.log(
        JSON.stringify({
          evaluatorName,
          errors: failingResults.map(
            (r) => `${r.error instanceof Error ? r.error.stack : r.error}`
          ),
        })
      );
    } else {
      for (const result of failingResults) {
        logError(result.error, verbose);
      }
    }
    if (!verbose && !jsonl) {
      console.error(warning("Add --verbose to see full stack traces."));
    }
  } else if (summary) {
    console.log(jsonl ? JSON.stringify(summary) : summary);
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

    console.log(jsonl ? JSON.stringify(summary) : summary);
  }
}
