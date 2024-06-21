import chalk from "chalk";
import {
  NOOP_SPAN,
  Experiment,
  ExperimentSummary,
  Span,
  init as _initExperiment,
  EvalCase,
  BaseMetadata,
  DefaultMetadataType,
  ScoreSummary,
  MetricSummary,
  currentSpan,
  FullInitOptions,
  BraintrustState,
} from "./logger";
import { Score, SpanTypeAttribute, mergeDicts } from "@braintrust/core";
import { BarProgressReporter, ProgressReporter } from "./progress";
import pluralize from "pluralize";
import { isEmpty } from "./util";

export type BaseExperiment<
  Input,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType,
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
  Metadata extends BaseMetadata = DefaultMetadataType,
>(
  options: {
    name?: string;
  } = {},
): BaseExperiment<Input, Expected, Metadata> {
  return { _type: "BaseExperiment", ...options };
}

export type EvalData<
  Input,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType,
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
  Metadata extends BaseMetadata = DefaultMetadataType,
> = EvalCase<Input, Expected, Metadata> & {
  output: Output;
};

type OneOrMoreScores = Score | number | null | Array<Score>;

export type EvalScorer<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType,
> = (
  args: EvalScorerArgs<Input, Output, Expected, Metadata>,
) => OneOrMoreScores | Promise<OneOrMoreScores>;

export type EvalResult<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType,
> = EvalCase<Input, Expected, Metadata> & {
  output: Output;
  scores: Record<string, number | null>;
  error: unknown;
};

export interface Evaluator<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType,
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

  /**
   * Whether to update an existing experiment with `experiment_name` if one exists. Defaults to false.
   */
  update?: boolean;

  /**
   * The duration, in milliseconds, after which to time out the evaluation.
   * Defaults to None, in which case there is no timeout.
   */
  timeout?: number;

  /**
   * If specified, uses the given project ID instead of the evaluator's name to identify the project.
   */
  projectId?: string;

  /**
   * If specified, uses the logger state to initialize Braintrust objects. If unspecified, falls back
   * to the global state (initialized using your API key).
   */
  state?: BraintrustState;
}

export type EvalResultWithSummary<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType,
> = {
  summary: ExperimentSummary;
  results: EvalResult<Input, Output, Expected, Metadata>[];
};

export interface ReporterOpts {
  verbose: boolean;
  jsonl: boolean;
}

export interface ReporterBody<EvalReport> {
  /**
   * A function that takes an evaluator and its result and returns a report.
   *
   * @param evaluator
   * @param result
   * @param opts
   */
  reportEval(
    evaluator: EvaluatorDef<any, any, any, any>,
    result: EvalResultWithSummary<any, any, any, any>,
    opts: ReporterOpts,
  ): Promise<EvalReport> | EvalReport;

  /**
   * A function that takes all evaluator results and returns a boolean indicating
   * whether the run was successful. If you return false, the `braintrust eval`
   * command will exit with a non-zero status code.
   *
   * @param reports
   */
  reportRun(reports: EvalReport[]): boolean | Promise<boolean>;
}

export type ReporterDef<EvalReport> = {
  name: string;
} & ReporterBody<EvalReport>;

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
  Metadata extends BaseMetadata = DefaultMetadataType,
> = {
  projectName: string;
  evalName: string;
} & Evaluator<Input, Output, Expected, Metadata>;

export type EvaluatorFile = {
  evaluators: {
    [evalName: string]: {
      evaluator: EvaluatorDef<any, any, any, any>;
      reporter?: ReporterDef<unknown> | string;
    };
  };
  reporters: { [reporterName: string]: ReporterDef<unknown> };
};

function initExperiment<IsOpen extends boolean = false>(
  state: BraintrustState | undefined,
  options: Readonly<FullInitOptions<IsOpen>> = {},
) {
  return _initExperiment({
    state,
    ...options,
    setCurrent: false,
  });
}

export type SpanContext = {
  currentSpan: typeof currentSpan;
  NOOP_SPAN: typeof NOOP_SPAN;
};

declare global {
  var _evals: EvaluatorFile;
  var _spanContext: SpanContext | undefined;
  var _lazy_load: boolean;
}

globalThis._evals = {
  evaluators: {},
  reporters: {},
};

export async function Eval<
  Input,
  Output,
  Expected = void,
  Metadata extends BaseMetadata = DefaultMetadataType,
  EvalReport = boolean,
>(
  name: string,
  evaluator: Evaluator<Input, Output, Expected, Metadata>,
  reporter?: ReporterDef<EvalReport> | string,
): Promise<EvalResultWithSummary<Input, Output, Expected, Metadata>> {
  let evalName = makeEvalName(name, evaluator.experimentName);
  if (globalThis._evals.evaluators[evalName]) {
    evalName = `${evalName}_${Object.keys(_evals).length}`;
  }
  if (globalThis._lazy_load) {
    globalThis._evals.evaluators[evalName] = {
      evaluator: { evalName, projectName: name, ...evaluator },
      reporter,
    };

    // This only needs to be set once, but Eval() is the only time
    // we get to run code while importing a module, so use it to
    // grab these values.
    globalThis._spanContext = { currentSpan, NOOP_SPAN };

    // Better to return this empty object than have an annoying-to-use signature
    return {
      summary: {
        scores: {},
        metrics: {},
        projectName: "",
        experimentName: "",
      },
      results: [],
    };
  }

  const progressReporter = new BarProgressReporter();

  if (typeof reporter === "string") {
    throw new Error(
      "Must specify a reporter object, not a name. Can only specify reporter names when running 'braintrust eval'",
    );
  }

  const resolvedReporter = reporter || defaultReporter;
  try {
    const experiment = initExperiment(evaluator.state, {
      ...(evaluator.projectId
        ? { projectId: evaluator.projectId }
        : { project: name }),
      experiment: evaluator.experimentName,
      metadata: evaluator.metadata,
      isPublic: evaluator.isPublic,
      update: evaluator.update,
    });
    try {
      const evalDef = {
        evalName,
        projectName: name,
        ...evaluator,
      };
      const ret = await runEvaluator(experiment, evalDef, progressReporter, []);
      progressReporter.stop();
      resolvedReporter.reportEval(evalDef, ret, {
        verbose: true,
        jsonl: false,
      });
      return ret;
    } finally {
      experiment.flush();
    }
  } finally {
    progressReporter.stop();
  }
}

export function Reporter<EvalReport>(
  name: string,
  reporter: ReporterBody<EvalReport>,
): ReporterDef<EvalReport> {
  const ret = { name, ...reporter };
  if (_evals.reporters[name]) {
    throw new Error(`Reporter ${name} already exists`);
  }

  if (globalThis._lazy_load) {
    _evals.reporters[name] = ret;
  }

  return ret;
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

export function scorerName(
  scorer: EvalScorer<any, any, any, any>,
  scorer_idx: number,
) {
  return scorer.name || `scorer_${scorer_idx}`;
}

export async function runEvaluator(
  experiment: Experiment | null,
  evaluator: EvaluatorDef<any, any, any, any>,
  progressReporter: ProgressReporter,
  filters: Filter[],
): Promise<EvalResultWithSummary<any, any, any, any>> {
  let result = runEvaluatorInternal(
    experiment,
    evaluator,
    progressReporter,
    filters,
  );
  let timer = async () => {
    await new Promise((_, reject) => {
      if (evaluator.timeout) {
        setTimeout(() => {
          reject("evaluator timed out");
        }, evaluator.timeout);
      }
    });
    return null;
  };
  let winner = await Promise.race([result, timer()]);
  if (!winner) {
    throw new Error("unreachable");
  }
  return winner;
}

async function runEvaluatorInternal(
  experiment: Experiment | null,
  evaluator: EvaluatorDef<any, any, any, any>,
  progressReporter: ProgressReporter,
  filters: Filter[],
): Promise<EvalResultWithSummary<any, any, any, any>> {
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
        "Cannot use BaseExperiment() without connecting to Braintrust (you most likely set --no-send-logs)",
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

    dataResult = initExperiment(evaluator.state, {
      ...(evaluator.projectId
        ? { projectId: evaluator.projectId }
        : { project: evaluator.projectName }),
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
      [...Array(evaluator.trialCount ?? 1).keys()].map(() => datum),
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
          },
        );
        rootSpan.log({ output, metadata });

        const scoringArgs = { ...datum, metadata, output };
        const scorerNames = evaluator.scores.map(scorerName);
        const scoreResults = await Promise.all(
          evaluator.scores.map(async (score, score_idx) => {
            try {
              const results = await rootSpan.traced(
                async (span: Span) => {
                  const scoreResult = score(scoringArgs);
                  const scoreValue =
                    scoreResult instanceof Promise
                      ? await scoreResult
                      : scoreResult;

                  if (scoreValue === null) {
                    return null;
                  }

                  if (Array.isArray(scoreValue)) {
                    for (const s of scoreValue) {
                      if (!(typeof s === "object" && !isEmpty(s))) {
                        throw new Error(
                          `When returning an array of scores, each score must be a non-empty object. Got: ${JSON.stringify(
                            s,
                          )}`,
                        );
                      }
                    }
                  }

                  const results = Array.isArray(scoreValue)
                    ? scoreValue
                    : typeof scoreValue === "object" && !isEmpty(scoreValue)
                      ? [scoreValue]
                      : [
                          {
                            name: scorerNames[score_idx],
                            score: scoreValue,
                          },
                        ];

                  const getOtherFields = (s: Score) => {
                    const { metadata, name, ...rest } = s;
                    return rest;
                  };

                  const resultMetadata =
                    results.length === 1
                      ? results[0].metadata
                      : results.reduce(
                          (prev, s) =>
                            mergeDicts(prev, {
                              [s.name]: s.metadata,
                            }),
                          {},
                        );

                  const resultOutput =
                    results.length === 1
                      ? getOtherFields(results[0])
                      : results.reduce(
                          (prev, s) =>
                            mergeDicts(prev, { [s.name]: getOtherFields(s) }),
                          {},
                        );

                  const scores = results.reduce(
                    (prev, s) => mergeDicts(prev, { [s.name]: s.score }),
                    {},
                  );

                  span.log({
                    output: resultOutput,
                    metadata: resultMetadata,
                    scores: scores,
                  });
                  return results;
                },
                {
                  name: scorerNames[score_idx],
                  spanAttributes: {
                    type: SpanTypeAttribute.SCORE,
                  },
                  event: { input: scoringArgs },
                },
              );
              return { kind: "score", value: results } as const;
            } catch (e) {
              return { kind: "error", value: e } as const;
            }
          }),
        );
        // Resolve each promise on its own so that we can separate the passing
        // from the failing ones.
        const passingScorersAndResults: {
          name: string;
          score: Score | null;
        }[] = [];
        const failingScorersAndResults: { name: string; error: unknown }[] = [];
        scoreResults.forEach((results, i) => {
          const name = scorerNames[i];
          if (results.kind === "score") {
            (results.value || []).forEach((result) => {
              passingScorersAndResults.push({
                name: result.name,
                score: result,
              });
              scores[result.name] = result.score;
            });
          } else {
            failingScorersAndResults.push({ name, error: results.value });
          }
        });

        if (failingScorersAndResults.length) {
          const scorerErrors = Object.fromEntries(
            failingScorersAndResults.map(({ name, error }) => [
              name,
              error instanceof Error ? error.stack : `${error}`,
            ]),
          );
          metadata["scorer_errors"] = scorerErrors;
          rootSpan.log({ metadata: { scorer_errors: scorerErrors } });
          const names = Object.keys(scorerErrors).join(", ");
          const errors = failingScorersAndResults.map((item) => item.error);
          throw new AggregateError(
            errors,
            `Found exceptions for the following scorers: ${names}`,
          );
        }
      } catch (e) {
        error = e;
      } finally {
        progressReporter.increment(evaluator.evalName);
      }

      return {
        input: datum.input,
        ...("expected" in datum ? { expected: datum.expected } : {}),
        output,
        tags: datum.tags,
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
  const summary = experiment
    ? await experiment.summarize()
    : buildLocalSummary(evaluator, results);

  return {
    summary,
    results,
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

export function buildLocalSummary(
  evaluator: EvaluatorDef<any, any, any, any>,
  results: EvalResult<any, any, any, any>[],
): ExperimentSummary {
  const scoresByName: { [name: string]: { total: number; count: number } } = {};
  for (const result of results) {
    for (const [name, score] of Object.entries(result.scores)) {
      const { total, count } = scoresByName[name] || { total: 0, count: 0 };
      if (score === null) {
        continue;
      }
      scoresByName[name] = { total: total + score, count: count + 1 };
    }
  }

  return {
    projectName: evaluator.projectName,
    experimentName: evaluator.evalName,
    scores: Object.fromEntries(
      Object.entries(scoresByName).map(([name, { total, count }]) => [
        name,
        {
          name,
          score: total / count,
          improvements: 0,
          regressions: 0,
        },
      ]),
    ),
  };
}

export function reportFailures<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata,
>(
  evaluator: EvaluatorDef<Input, Output, Expected, Metadata>,
  failingResults: EvalResult<Input, Output, Expected, Metadata>[],
  { verbose, jsonl }: ReporterOpts,
) {
  if (failingResults.length > 0) {
    // TODO: We may want to support a non-strict mode (and make this the "strict" behavior), so that
    // users can still log imperfect evaluations. In the meantime, they should handle these cases inside
    // of their tasks.
    console.error(
      warning(
        `Evaluator ${evaluator.evalName} failed with ${pluralize(
          "error",
          failingResults.length,
          true,
        )}. This evaluation ("${
          evaluator.evalName
        }") will not be fully logged.`,
      ),
    );
    if (jsonl) {
      console.log(
        JSON.stringify({
          evaluatorName: evaluator.evalName,
          errors: failingResults.map(
            (r) => `${r.error instanceof Error ? r.error.stack : r.error}`,
          ),
        }),
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
}

/**
 * The default reporter for Braintrust evaluations. This reporter will log the results
 * of each evaluation to the console, and will return false (i.e. fail) if any of the
 * evaluations return an error.
 */
export const defaultReporter: ReporterDef<boolean> = {
  name: "Braintrust default reporter",
  async reportEval(
    evaluator: EvaluatorDef<any, any, any, any>,
    result: EvalResultWithSummary<any, any, any, any>,
    { verbose, jsonl }: ReporterOpts,
  ) {
    const { results, summary } = result;
    const failingResults = results.filter(
      (r: { error: unknown }) => r.error !== undefined,
    );

    if (failingResults.length > 0) {
      reportFailures(evaluator, failingResults, { verbose, jsonl });
    }

    // process.stdout.write will not do intelligent formatting, like cut off long lines
    process.stdout.write(
      jsonl ? JSON.stringify(summary) : formatExperimentSummary(summary),
    );
    process.stdout.write("\n");
    return failingResults.length === 0;
  },
  async reportRun(evalReports: boolean[]) {
    return evalReports.every((r) => r);
  },
};

function formatExperimentSummary(summary: ExperimentSummary) {
  let comparisonLine = "";
  if (summary.comparisonExperimentName) {
    comparisonLine = `${summary.experimentName} compared to ${summary.comparisonExperimentName}:\n`;
  }
  const longestScoreName = Math.max(
    ...Object.values(summary.scores).map((score) => score.name.length),
  );
  const longestMetricName = Math.max(
    ...Object.values(summary.metrics ?? {}).map((metric) => metric.name.length),
  );
  return (
    `\n=========================SUMMARY=========================\n${comparisonLine}` +
    Object.values(summary.scores)
      .map((score) => formatScoreSummary(score, longestScoreName))
      .join("\n") +
    (Object.keys(summary.scores).length ? "\n\n" : "") +
    Object.values(summary.metrics ?? {})
      .map((metric) => formatMetricSummary(metric, longestMetricName))
      .join("\n") +
    (Object.keys(summary.metrics ?? {}).length ? "\n\n" : "") +
    (summary.experimentUrl
      ? `See results for ${summary.experimentName} at ${summary.experimentUrl}`
      : "")
  );
}

function formatScoreSummary(summary: ScoreSummary, longestScoreName: number) {
  const diffString = isEmpty(summary.diff)
    ? ""
    : ` (${summary.diff > 0 ? "+" : ""}${(summary.diff * 100).toFixed(2)}%)`;
  const scoreName = `'${summary.name}'`.padEnd(longestScoreName + 2);
  return `${(summary.score * 100).toFixed(
    2,
  )}%${diffString} ${scoreName} score\t(${summary.improvements} improvements, ${
    summary.regressions
  } regressions)`;
}

function formatMetricSummary(
  summary: MetricSummary,
  longestMetricName: number,
) {
  const diffString = isEmpty(summary.diff)
    ? ""
    : ` (${summary.diff > 0 ? "+" : ""}${(summary.diff * 100).toFixed(2)}%)`;
  const metricName = `'${summary.name}'`.padEnd(longestMetricName + 2);
  return `${summary.metric.toFixed(2)}${summary.unit} ${metricName}\t(${
    summary.improvements
  } improvements, ${summary.regressions} regressions)`;
}
