import chalk from "chalk";
import {
  NOOP_SPAN,
  Experiment,
  ExperimentSummary,
  Span,
  init as _initExperiment,
  EvalCase,
  InitOptions,
  BaseMetadata,
  DefaultMetadataType,
} from "./logger";
import { Score, SpanTypeAttribute } from "@braintrust/core";
import { BarProgressReporter, ProgressReporter } from "./progress";
import pluralize from "pluralize";
import { isEmpty } from "./util";

export type BaseExperiment<
  Input,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType
> = {
  _type: "BaseExperiment";
  _phantom?: [Input, Expected, Metadata];
  name?: string;
};

/**
 * Use this to specify that the dataset should actually be the data from a previous (base) experiment.
 * If you do not specify a name, Braintrust will automatically figure out the best base experiment to
 * use based on your git history (or fall back to timestamps).
 *
 * @param options
 * @param options.name The name of the base experiment to use. If unspecified, Braintrust will automatically figure out the best base
 * using your git history (or fall back to timestamps).
 * @returns
 */
export function BaseExperiment<
  Input = unknown,
  Expected = unknown,
  Metadata extends BaseMetadata = DefaultMetadataType
>(
  options: {
    name?: string;
  } = {}
): BaseExperiment<Input, Expected, Metadata> {
  return { _type: "BaseExperiment", ...options };
}

export type EvalData<
  Input,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType
> =
  | EvalCase<Input, Expected, Metadata>[]
  | (() => EvalCase<Input, Expected, Metadata>[])
  | (() => Promise<EvalCase<Input, Expected, Metadata>[]>)
  | AsyncGenerator<EvalCase<Input, Expected, Metadata>>
  | AsyncIterable<EvalCase<Input, Expected, Metadata>>
  | BaseExperiment<Input, Expected, Metadata>
  | (() => BaseExperiment<Input, Expected, Metadata>);

export type EvalTask<Input, Output> =
  | ((input: Input, hooks: EvalHooks) => Promise<Output>)
  | ((input: Input, hooks: EvalHooks) => Output);

export interface EvalHooks {
  meta: (info: Record<string, unknown>) => void;
  span: Span;
}

// This happens to be compatible with ScorerArgs defined in @braintrust/core.
export type EvalScorerArgs<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType
> = EvalCase<Input, Expected, Metadata> & {
  output: Output;
};

export type EvalScorer<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType
> = (
  args: EvalScorerArgs<Input, Output, Expected, Metadata>
) => Score | Promise<Score>;

export interface Evaluator<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType
> {
  /**
   * A function that returns a list of inputs, expected outputs, and metadata.
   */
  data: EvalData<Input, Expected, Metadata>;

  /**
   * A function that takes an input and returns an output.
   */
  task: EvalTask<Input, Output>;

  /**
   * A set of functions that take an input, output, and expected value and return a score.
   */
  scores: EvalScorer<Input, Output, Expected, Metadata>[];

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
  metadata?: Record<string, unknown>;

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

export type EvaluatorDef<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType
> = {
  projectName: string;
  evalName: string;
} & Evaluator<Input, Output, Expected, Metadata>;

export type EvaluatorFile = {
  [evalName: string]: EvaluatorDef<any, any, any, any>;
};

function initExperiment<IsOpen extends boolean = false>(
  projectName: string,
  options: Readonly<InitOptions<IsOpen>> = {}
) {
  return _initExperiment(projectName, {
    ...options,
    setCurrent: false,
  });
}

declare global {
  var _evals: EvaluatorFile;
  var _lazy_load: boolean;
}

globalThis._evals = {};

export async function Eval<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType
>(
  name: string,
  evaluator: Evaluator<Input, Output, Expected, Metadata>
): Promise<ExperimentSummary> {
  let evalName = makeEvalName(name, evaluator.experimentName);
  if (_evals[evalName]) {
    evalName = `${evalName}_${Object.keys(_evals).length}`;
  }
  if (globalThis._lazy_load) {
    _evals[evalName] = { evalName, projectName: name, ...evaluator };
    // Better to return this empty object than have an annoying-to-use signature
    return {
      projectName: "_lazy_load",
      experimentName: "_lazy_load",
      projectUrl: "",
      experimentUrl: "",
      comparisonExperimentName: "",
      scores: {},
      metrics: {},
    };
  }

  const progressReporter = new BarProgressReporter();
  try {
    const experiment = initExperiment(name, {
      experiment: evaluator.experimentName,
      metadata: evaluator.metadata,
      isPublic: evaluator.isPublic,
    });
    try {
      const ret = await runEvaluator(
        experiment,
        {
          evalName,
          projectName: name,
          ...(evaluator as Evaluator<unknown, unknown, unknown, any>),
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

function scorerName(
  scorer: EvalScorer<any, any, any, any>,
  scorer_idx: number
) {
  return scorer.name || `scorer_${scorer_idx}`;
}

export async function runEvaluator(
  experiment: Experiment | null,
  evaluator: EvaluatorDef<any, any, any | void, any | void>,
  progressReporter: ProgressReporter,
  filters: Filter[]
) {
  if (typeof evaluator.data === "string") {
    throw new Error("Unimplemented: string data paths");
  }
  let dataResult =
    typeof evaluator.data === "function" ? evaluator.data() : evaluator.data;

  if ("_type" in dataResult) {
    if (dataResult._type !== "BaseExperiment") {
      // For some reason, the typesystem won't let me check if dataResult._type === "BaseExperiment"
      throw new Error("Invalid _type");
    }
    if (!experiment) {
      throw new Error(
        "Cannot use BaseExperiment() without connecting to Braintrust (you most likely set --no-send-logs)"
      );
    }
    let name = dataResult.name;
    if (isEmpty(name)) {
      const baseExperiment = await experiment.fetchBaseExperiment();
      if (!baseExperiment) {
        throw new Error("BaseExperiment() failed to fetch base experiment");
      }
      name = baseExperiment.name;
    }
    dataResult = initExperiment(evaluator.projectName, {
      experiment: name,
      open: true,
    }).asDataset();
  }

  let data: EvalCase<any, any, any>[] = [];
  if (dataResult instanceof Promise) {
    data = await dataResult;
  } else if (Symbol.asyncIterator in dataResult) {
    // TODO: Eventually, we may want to support pushing the async generator logic
    // down into the evaluator, so we can avoid materializing large datasets
    data = [];
    for await (const d of dataResult) {
      data.push(d);
    }
  } else {
    data = dataResult;
  }

  data = data
    .filter((d) => filters.every((f) => evaluateFilter(d, f)))
    .flatMap((datum) =>
      [...Array(evaluator.trialCount ?? 1).keys()].map(() => datum)
    );

  progressReporter.start(evaluator.evalName, data.length);

  const evals = data.map(async (datum) => {
    const callback = async (rootSpan: Span) => {
      let metadata: Record<string, unknown> = {
        ...("metadata" in datum ? datum.metadata : {}),
      };
      let output: any = undefined;
      let error: unknown | undefined = undefined;
      let scores: Record<string, number | null> = {};
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
            span.log({ output });
          },
          {
            name: "task",
            spanAttributes: { type: SpanTypeAttribute.TASK },
            event: { input: datum.input },
          }
        );
        rootSpan.log({ output });

        const scoringArgs = { ...datum, metadata, output };
        const scorerNames = evaluator.scores.map(scorerName);
        const scoreResults = await Promise.all(
          evaluator.scores.map(async (score, score_idx) => {
            try {
              const result = await rootSpan.traced(
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
                  name: scorerNames[score_idx],
                  spanAttributes: {
                    type: SpanTypeAttribute.SCORE,
                  },
                  event: { input: scoringArgs },
                }
              );
              return { kind: "score", value: result } as const;
            } catch (e) {
              return { kind: "error", value: e } as const;
            }
          })
        );
        // Resolve each promise on its own so that we can separate the passing
        // from the failing ones.
        const passingScorersAndResults: { name: string; score: Score }[] = [];
        const failingScorersAndResults: { name: string; error: unknown }[] = [];
        scoreResults.forEach((result, i) => {
          const name = scorerNames[i];
          if (result.kind === "score") {
            passingScorersAndResults.push({ name, score: result.value });
          } else {
            failingScorersAndResults.push({ name, error: result.value });
          }
        });

        const scoreMetadata: Record<string, unknown> = {};
        for (const { score: scoreResult } of passingScorersAndResults) {
          scores[scoreResult.name] = scoreResult.score;
          const metadata = {
            ...scoreResult.metadata,
          };
          if (Object.keys(metadata).length > 0) {
            scoreMetadata[scoreResult.name] = metadata;
          }
        }

        if (Object.keys(scoreMetadata).length > 0) {
          meta({ scores: scoreMetadata });
        }

        rootSpan.log({ scores, metadata: metadata });

        if (failingScorersAndResults.length) {
          const scorerErrors = Object.fromEntries(
            failingScorersAndResults.map(({ name, error }) => [
              name,
              error instanceof Error ? error.stack : `${error}`,
            ])
          );
          metadata["scorer_errors"] = scorerErrors;
          const names = Object.keys(scorerErrors).join(", ");
          const errors = failingScorersAndResults.map((item) => item.error);
          throw new AggregateError(
            errors,
            `Found exceptions for the following scorers: ${names}`
          );
        }
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
        spanAttributes: {
          type: SpanTypeAttribute.EVAL,
        },
        event: {
          input: datum.input,
          expected: "expected" in datum ? datum.expected : undefined,
          tags: datum.tags,
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
    results: { scores: Record<string, number | null>; error: unknown }[];
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
  }
  if (summary) {
    console.log(jsonl ? JSON.stringify(summary) : summary);
  } else {
    const scoresByName: { [name: string]: { total: number; count: number } } =
      {};
    for (const result of results) {
      for (const [name, score] of Object.entries(result.scores)) {
        const { total, count } = scoresByName[name] || { total: 0, count: 0 };
        if (score === null) {
          continue;
        }
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
