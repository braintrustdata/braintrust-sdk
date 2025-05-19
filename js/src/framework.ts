import { Score, SpanTypeAttribute, mergeDicts } from "@braintrust/core";
import {
  GitMetadataSettings,
  ObjectReference,
  RepoInfo,
  SSEProgressEventData,
} from "@braintrust/core/typespecs";
import { queue } from "async";
import chalk from "chalk";
import pluralize from "pluralize";
import { GenericFunction } from "./framework-types";
import { CodeFunction, CodePrompt } from "./framework2";
import {
  BaseMetadata,
  BraintrustState,
  Dataset,
  DefaultMetadataType,
  EvalCase,
  Experiment,
  ExperimentSummary,
  FullInitOptions,
  MetricSummary,
  NOOP_SPAN,
  ScoreSummary,
  Span,
  StartSpanArgs,
  init as _initExperiment,
  currentSpan,
  flush,
  logError as logSpanError,
  startSpan,
  traced,
  withCurrent,
  withParent,
} from "./logger";
import { BarProgressReporter, ProgressReporter } from "./progress";
import { isEmpty, InternalAbortError } from "./util";
import {
  EvalParameters,
  InferParameters,
  validateParameters,
} from "./eval-parameters";

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
  | Promise<EvalCase<Input, Expected, Metadata>[]>
  | (() => Promise<EvalCase<Input, Expected, Metadata>[]>)
  | AsyncGenerator<EvalCase<Input, Expected, Metadata>>
  | AsyncIterable<EvalCase<Input, Expected, Metadata>>
  | BaseExperiment<Input, Expected, Metadata>
  | (() => BaseExperiment<Input, Expected, Metadata>);

export type EvalTask<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata,
  Parameters extends EvalParameters,
> =
  | ((
      input: Input,
      hooks: EvalHooks<Expected, Metadata, Parameters>,
    ) => Promise<Output>)
  | ((
      input: Input,
      hooks: EvalHooks<Expected, Metadata, Parameters>,
    ) => Output);

export type TaskProgressEvent = Omit<
  SSEProgressEventData,
  "id" | "origin" | "object_type" | "name"
>;

export interface EvalHooks<
  Expected,
  Metadata extends BaseMetadata,
  Parameters extends EvalParameters,
> {
  /**
   * @deprecated Use `metadata` instead.
   */
  meta: (info: Metadata) => void;
  /**
   * The metadata object for the current evaluation. You can mutate this object to add or remove metadata.
   */
  metadata: Metadata extends void ? Record<string, unknown> : Metadata;
  /**
   * The expected output for the current evaluation.
   */
  expected: Expected;
  /**
   * The task's span.
   */
  span: Span;
  /**
   * The current parameters being used for this specific task execution.
   * Array parameters are converted to single values.
   */
  parameters: InferParameters<Parameters>;
  /**
   * Report progress that will show up in the playground.
   */
  reportProgress: (progress: TaskProgressEvent) => void;
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

export type OneOrMoreScores = Score | number | null | Array<Score>;

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
  origin?: ObjectReference;
};

type ErrorScoreHandler = (args: {
  rootSpan: Span;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: EvalCase<any, any, any>;
  unhandledScores: string[];
}) => Record<string, number> | undefined | void;

export interface Evaluator<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType,
  Parameters extends EvalParameters = EvalParameters,
> {
  /**
   * A function that returns a list of inputs, expected outputs, and metadata.
   */
  data: EvalData<Input, Expected, Metadata>;

  /**
   * A function that takes an input and returns an output.
   */
  task: EvalTask<Input, Output, Expected, Metadata, Parameters>;

  /**
   * A set of functions that take an input, output, and expected value and return a score.
   */
  scores: EvalScorer<Input, Output, Expected, Metadata>[];

  /**
   * A set of parameters that will be passed to the evaluator.
   * Can contain array values that will be converted to single values in the task.
   */

  parameters?: Parameters;

  /**
   * An optional name for the experiment.
   */
  experimentName?: string;

  /**
   * An optional description for the experiment.
   */
  description?: string;

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
   * Defaults to undefined, in which case there is no timeout.
   */
  timeout?: number;

  /**
   * An abort signal that can be used to stop the evaluation.
   */
  signal?: AbortSignal;

  /**
   * The maximum number of tasks/scorers that will be run concurrently.
   * Defaults to undefined, in which case there is no max concurrency.
   */
  maxConcurrency?: number;

  /**
   * If specified, uses the given project ID instead of the evaluator's name to identify the project.
   */
  projectId?: string;

  /**
   * If specified, uses the logger state to initialize Braintrust objects. If unspecified, falls back
   * to the global state (initialized using your API key).
   */
  state?: BraintrustState;

  /**
   * An optional experiment name to use as a base. If specified, the new experiment will be summarized
   * and compared to this experiment.
   */
  baseExperimentName?: string;

  /**
   * An optional experiment id to use as a base. If specified, the new experiment will be summarized
   * and compared to this experiment. This takes precedence over `baseExperimentName` if specified.
   */
  baseExperimentId?: string;

  /**
   * Optional settings for collecting git metadata. By default, will collect all git metadata fields allowed in org-level settings.
   */
  gitMetadataSettings?: GitMetadataSettings;

  /**
   * Optionally explicitly specify the git metadata for this experiment. This takes precedence over `gitMetadataSettings` if specified.
   */
  repoInfo?: RepoInfo;

  /**
   * Optionally supply a custom function to specifically handle score values when tasks or scoring functions have errored.
   * A default implementation is exported as `defaultErrorScoreHandler` which will log a 0 score to the root span for any scorer that was not run.
   */
  errorScoreHandler?: ErrorScoreHandler;

  /**
   * Whether to summarize the scores of the experiment after it has run.
   * Defaults to true.
   */
  summarizeScores?: boolean;
}

export class EvalResultWithSummary<
  Input,
  Output,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType,
> {
  constructor(
    public summary: ExperimentSummary,
    public results: EvalResult<Input, Output, Expected, Metadata>[],
  ) {}

  toString(): string {
    return formatExperimentSummary(this.summary);
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `EvalResultWithSummary(summary="...", results=[...])`;
  }

  toJSON(): {
    summary: ExperimentSummary;
    results: EvalResult<Input, Output, Expected, Metadata>[];
  } {
    return {
      summary: this.summary,
      results: this.results,
    };
  }
}

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
    // These any's are required because these function specifications don't know
    // or need to know the types of the input/output/etc for the evaluator.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evaluator: EvaluatorDef<any, any, any, any, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  Parameters extends EvalParameters = EvalParameters,
> = {
  projectName: string;
  evalName: string;
} & Evaluator<Input, Output, Expected, Metadata, Parameters>;

export type EvaluatorFile = {
  functions: CodeFunction<
    unknown,
    unknown,
    GenericFunction<unknown, unknown>
  >[];
  prompts: CodePrompt[];
  evaluators: {
    [evalName: string]: {
      evaluator: EvaluatorDef<
        unknown,
        unknown,
        unknown,
        BaseMetadata,
        EvalParameters
      >;
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

export function callEvaluatorData<
  Input,
  Expected,
  Metadata extends BaseMetadata = DefaultMetadataType,
>(
  data: EvalData<Input, Expected, Metadata>,
): {
  data: EvalData<Input, Expected, Metadata>;
  baseExperiment: string | undefined;
} {
  const dataResult = typeof data === "function" ? data() : data;

  let baseExperiment: string | undefined = undefined;
  if ("_type" in dataResult && dataResult._type === "BaseExperiment") {
    baseExperiment = dataResult.name;
  }

  return {
    data: dataResult,
    baseExperiment,
  };
}

export type SpanContext = {
  currentSpan: typeof currentSpan;
  startSpan: typeof startSpan;
  withCurrent: typeof withCurrent;
  NOOP_SPAN: typeof NOOP_SPAN;
};

declare global {
  // eslint-disable-next-line no-var
  var _evals: EvaluatorFile;
  // eslint-disable-next-line no-var
  var _spanContext: SpanContext | undefined;
  // eslint-disable-next-line no-var
  var _lazy_load: boolean;
}

globalThis._evals = {
  functions: [],
  prompts: [],
  evaluators: {},
  reporters: {},
};

export interface EvalOptions<EvalReport, Parameters extends EvalParameters> {
  /**
   * A `Reporter` which you can use to summarize progress after an Eval() runs.
   */
  reporter?: ReporterDef<EvalReport> | string;
  /**
   * A callback function that will be called when an experiment is started with
   * information about its project, experiment id, name, and other useful information.
   * @param metadata
   */
  onStart?: (metadata: Omit<ExperimentSummary, "scores" | "metrics">) => void;
  /**
   * A function that will be called with progress events, which can be used to
   * display intermediate progress.
   *
   * @param data
   */
  stream?: (data: SSEProgressEventData) => void;
  /**
   * If specified, instead of creating a new experiment object, the Eval() will populate
   * the object or span specified by this parent.
   */
  parent?: string;
  /**
   * Specify this to create a custom progress-bar style reporter. Note that this interface
   * is somewhat outdated, and may be removed in the future.
   */
  progress?: ProgressReporter;
  /**
   * The parameters to use for the evaluator.
   */
  parameters?: InferParameters<Parameters>;
}

export function _initializeSpanContext() {
  // This only needs to be set once, but Eval(), Task(), etc. are the only time
  // we get to run code while importing a module, so use it to
  // grab these values.
  globalThis._spanContext = { currentSpan, withCurrent, startSpan, NOOP_SPAN };
}

export async function Eval<
  Input,
  Output,
  Expected = void,
  Metadata extends BaseMetadata = DefaultMetadataType,
  EvalReport = boolean,
  Parameters extends EvalParameters = EvalParameters,
>(
  name: string,
  evaluator: Evaluator<Input, Output, Expected, Metadata, Parameters>,
  reporterOrOpts?:
    | ReporterDef<EvalReport>
    | string
    | EvalOptions<EvalReport, Parameters>,
): Promise<EvalResultWithSummary<Input, Output, Expected, Metadata>> {
  const options: EvalOptions<EvalReport, Parameters> = isEmpty(reporterOrOpts)
    ? {}
    : typeof reporterOrOpts === "string"
      ? { reporter: reporterOrOpts }
      : "name" in reporterOrOpts
        ? { reporter: reporterOrOpts }
        : reporterOrOpts;

  let evalName = makeEvalName(name, evaluator.experimentName);
  if (globalThis._evals.evaluators[evalName]) {
    evalName = `${evalName}_${Object.keys(_evals).length}`;
  }
  if (globalThis._lazy_load) {
    globalThis._evals.evaluators[evalName] = {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      evaluator: {
        evalName,
        projectName: name,
        ...evaluator,
      } as EvaluatorDef<
        unknown,
        unknown,
        unknown,
        BaseMetadata,
        EvalParameters
      >,
      reporter: options.reporter,
    };

    _initializeSpanContext();

    // Better to return this empty object than have an annoying-to-use signature
    return new EvalResultWithSummary(
      {
        scores: {},
        metrics: {},
        projectName: "",
        experimentName: "",
      },
      [],
    );
  }

  const progressReporter = options.progress ?? new BarProgressReporter();

  if (typeof options.reporter === "string") {
    throw new Error(
      "Must specify a reporter object, not a name. Can only specify reporter names when running 'braintrust eval'",
    );
  }

  const resolvedReporter = options.reporter || defaultReporter;
  try {
    const { data, baseExperiment: defaultBaseExperiment } = callEvaluatorData(
      evaluator.data,
    );
    // NOTE: This code is duplicated with initExperiment in js/src/cli.ts. Make sure
    // to update that if you change this.
    const experiment = options.parent
      ? null
      : initExperiment(evaluator.state, {
          ...(evaluator.projectId
            ? { projectId: evaluator.projectId }
            : { project: name }),
          experiment: evaluator.experimentName,
          description: evaluator.description,
          metadata: evaluator.metadata,
          isPublic: evaluator.isPublic,
          update: evaluator.update,
          baseExperiment: evaluator.baseExperimentName ?? defaultBaseExperiment,
          baseExperimentId: evaluator.baseExperimentId,
          gitMetadataSettings: evaluator.gitMetadataSettings,
          repoInfo: evaluator.repoInfo,
          dataset: Dataset.isDataset(data) ? data : undefined,
        });

    if (experiment && options.onStart) {
      const summary = await experiment.summarize({ summarizeScores: false });
      options.onStart(summary);
    }

    try {
      const evalDef = {
        evalName,
        projectName: name,
        ...evaluator,
        data,
      };
      let ret;
      if (options.parent) {
        ret = await withParent(
          options.parent,
          () =>
            runEvaluator(
              null,
              evalDef,
              progressReporter,
              [],
              options.stream,
              options.parameters,
            ),
          evaluator.state,
        );
      } else {
        ret = await runEvaluator(
          experiment,
          evalDef,
          progressReporter,
          [],
          options.stream,
          options.parameters,
        );
      }
      progressReporter.stop();
      resolvedReporter.reportEval(evalDef, ret, {
        verbose: true,
        jsonl: false,
      });
      return ret;
    } finally {
      if (experiment) {
        experiment.flush().catch(console.error);
      } else if (options.parent) {
        flush().catch(console.error);
      }
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

export function serializeJSONWithPlainString(v: unknown) {
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

function evaluateFilter(object: unknown, filter: Filter) {
  const { path, pattern } = filter;
  const key = path.reduce(
    (acc, p) =>
      typeof acc === "object" && acc !== null
        ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          (acc as Record<string, unknown>)[p]
        : undefined,
    object,
  );
  if (key === undefined) {
    return false;
  }
  return pattern.test(serializeJSONWithPlainString(key));
}

export function scorerName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scorer: EvalScorer<any, any, any, any>,
  scorer_idx: number,
) {
  return scorer.name || `scorer_${scorer_idx}`;
}

export async function runEvaluator(
  experiment: Experiment | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluator: EvaluatorDef<any, any, any, any, any>,
  progressReporter: ProgressReporter,
  filters: Filter[],
  stream: ((data: SSEProgressEventData) => void) | undefined,
  parameters?: InferParameters<EvalParameters>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<EvalResultWithSummary<any, any, any, any>> {
  return await runEvaluatorInternal(
    experiment,
    evaluator,
    progressReporter,
    filters,
    stream,
    parameters,
  );
}

export const defaultErrorScoreHandler: ErrorScoreHandler = ({
  rootSpan,
  data: _,
  unhandledScores,
}) => {
  const scores = Object.fromEntries(unhandledScores.map((s) => [s, 0]));
  rootSpan.log({ scores });
  return scores;
};

async function runEvaluatorInternal(
  experiment: Experiment | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluator: EvaluatorDef<any, any, any, any>,
  progressReporter: ProgressReporter,
  filters: Filter[],
  stream: ((data: SSEProgressEventData) => void) | undefined,
  parameters: InferParameters<EvalParameters> | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<EvalResultWithSummary<any, any, any, any>> {
  if (typeof evaluator.data === "string") {
    throw new Error("Unimplemented: string data paths");
  }
  let dataResult =
    typeof evaluator.data === "function" ? evaluator.data() : evaluator.data;

  parameters = validateParameters(parameters ?? {}, evaluator.parameters ?? {});

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  interface EvalResult {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    output: any;
    tags?: string[];
    metadata: Record<string, unknown>;
    scores: Record<string, number | null>;
    error: unknown;
    origin?: ObjectReference;
  }
  const results: EvalResult[] = [];
  const q = queue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (datum: EvalCase<any, any, any>) => {
      const eventDataset: Dataset | undefined = experiment
        ? experiment.dataset
        : Dataset.isDataset(evaluator.data)
          ? evaluator.data
          : undefined;

      const baseEvent: StartSpanArgs = {
        name: "eval",
        spanAttributes: {
          type: SpanTypeAttribute.EVAL,
        },
        event: {
          input: datum.input,
          expected: "expected" in datum ? datum.expected : undefined,
          tags: datum.tags,
          origin:
            eventDataset && datum.id && datum._xact_id
              ? {
                  object_type: "dataset",
                  object_id: await eventDataset.id,
                  id: datum.id,
                  created: datum.created,
                  _xact_id: datum._xact_id,
                }
              : undefined,
          ...(datum.upsert_id ? { id: datum.upsert_id } : {}),
        },
      };

      const callback = async (rootSpan: Span) => {
        let metadata: Record<string, unknown> = {
          ...("metadata" in datum ? datum.metadata : {}),
        };
        const expected = "expected" in datum ? datum.expected : undefined;
        let output: unknown = undefined;
        let error: unknown | undefined = undefined;
        const scores: Record<string, number | null> = {};
        const scorerNames = evaluator.scores.map(scorerName);
        let unhandledScores: string[] | null = scorerNames;
        try {
          const meta = (o: Record<string, unknown>) =>
            (metadata = { ...metadata, ...o });

          await rootSpan.traced(
            async (span: Span) => {
              const outputResult = evaluator.task(datum.input, {
                meta,
                metadata,
                expected,
                span,
                parameters: parameters ?? {},
                reportProgress: (event: TaskProgressEvent) => {
                  stream?.({
                    ...event,
                    id: rootSpan.id,
                    origin: baseEvent.event?.origin,
                    name: evaluator.evalName,
                    object_type: "task",
                  });
                },
              });
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
          rootSpan.log({ output, metadata, expected });

          const scoringArgs = {
            input: datum.input,
            expected: "expected" in datum ? datum.expected : undefined,
            metadata,
            output,
          };
          const scoreResults = await Promise.all(
            evaluator.scores.map(async (score, score_idx) => {
              try {
                const runScorer = async (span: Span) => {
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
                    const { metadata: _metadata, name: _name, ...rest } = s;
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
                };

                const results = await rootSpan.traced(runScorer, {
                  name: scorerNames[score_idx],
                  spanAttributes: {
                    type: SpanTypeAttribute.SCORE,
                  },
                  event: { input: scoringArgs },
                });
                return { kind: "score", value: results } as const;
              } catch (e) {
                return { kind: "error", value: e } as const;
              }
            }),
          );
          // Resolve each promise on its own so that we can separate the passing
          // from the failing ones.
          const failingScorersAndResults: { name: string; error: unknown }[] =
            [];
          scoreResults.forEach((results, i) => {
            const name = scorerNames[i];
            if (results.kind === "score") {
              (results.value || []).forEach((result) => {
                scores[result.name] = result.score;
              });
            } else {
              failingScorersAndResults.push({ name, error: results.value });
            }
          });

          unhandledScores = null;
          if (failingScorersAndResults.length) {
            const scorerErrors = Object.fromEntries(
              failingScorersAndResults.map(({ name, error }) => [
                name,
                error instanceof Error ? error.stack : `${error}`,
              ]),
            );
            metadata["scorer_errors"] = scorerErrors;
            rootSpan.log({
              metadata: { scorer_errors: scorerErrors },
            });
            const names = Object.keys(scorerErrors).join(", ");
            const errors = failingScorersAndResults.map((item) => item.error);
            unhandledScores = Object.keys(scorerErrors);
            console.warn(
              `Found exceptions for the following scorers: ${names}`,
              errors,
            );
          }
        } catch (e) {
          logSpanError(rootSpan, e);
          error = e;
        } finally {
          progressReporter.increment(evaluator.evalName);
        }

        results.push({
          input: datum.input,
          ...("expected" in datum ? { expected: datum.expected } : {}),
          output,
          tags: datum.tags,
          metadata,
          scores: {
            ...(evaluator.errorScoreHandler && unhandledScores
              ? evaluator.errorScoreHandler({
                  rootSpan,
                  data: datum,
                  unhandledScores,
                })
              : undefined),
            ...scores,
          },
          error,
          origin: baseEvent.event?.origin,
        });
      };

      if (!experiment) {
        // This will almost always be a no-op span, but it means that if the Eval
        // is run in the context of a different type of span, it will be logged.
        return await traced(callback, {
          ...baseEvent,
          state: evaluator.state,
        });
      } else {
        return await experiment.traced(callback, baseEvent);
      }
    },
    Math.max(evaluator.maxConcurrency ?? data.length, 1),
  );
  q.push(data);

  const cancel = async () => {
    await new Promise((_, reject) => {
      if (evaluator.timeout) {
        setTimeout(() => {
          reject(new InternalAbortError("Evaluator timed out"));
        }, evaluator.timeout);
      }
      if (evaluator.signal) {
        evaluator.signal.addEventListener("abort", () => {
          reject(new InternalAbortError("Evaluator aborted"));
        });
      }
    });
  };

  // wait for tasks to be completed or the evaluator to be cancelled
  // if the evaluator is cancelled, the remaining tasks that have not been started will be killed
  try {
    await Promise.race([q.drain(), cancel()]);
  } catch (e) {
    if (e instanceof InternalAbortError) {
      q.kill();
    }

    throw e;
  }

  const summary = experiment
    ? await experiment.summarize({ summarizeScores: evaluator.summarizeScores })
    : buildLocalSummary(evaluator, results);

  return new EvalResultWithSummary(summary, results);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluator: EvaluatorDef<any, any, any, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evaluator: EvaluatorDef<any, any, any, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const fractionDigits = Number.isInteger(summary.metric) ? 0 : 2;
  const metricName = `'${summary.name}'`.padEnd(longestMetricName + 2);
  return `${summary.metric.toFixed(fractionDigits)}${summary.unit} ${metricName}\t(${
    summary.improvements
  } improvements, ${summary.regressions} regressions)`;
}
