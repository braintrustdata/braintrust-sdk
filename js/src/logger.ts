/// <reference lib="dom" />

import { v4 as uuidv4 } from "uuid";

import {
  TRANSACTION_ID_FIELD,
  IS_MERGE_FIELD,
  mergeDicts,
  mergeRowBatch,
} from "@braintrust/core";

import iso, { IsoAsyncLocalStorage } from "./isomorph";
import { runFinally, GLOBAL_PROJECT, getCurrentUnixTimestamp } from "./util";

export type Metadata = Record<string, unknown>;

export type SetCurrentArg = { setCurrent?: boolean };

type StartSpanEventArgs = ExperimentLogPartialArgs & Partial<IdField>;

export type StartSpanArgs = {
  name?: string;
  spanAttributes?: Record<any, any>;
  startTime?: number;
  event?: StartSpanEventArgs;
};

export type EndSpanArgs = {
  endTime?: number;
};

/**
 * A Span encapsulates logged data and metrics for a unit of work. This interface is shared by all span implementations.
 *
 * We suggest using one of the various `traced` methods, instead of creating Spans directly.
 *
 * See `Span.traced` for full details.
 */
export interface Span {
  /**
   * Row ID of the span.
   */
  id: string;

  /**
   * Span ID of the span. This is used to link spans together.
   */
  span_id: string;

  /**
   * Span ID of the root span in the full trace.
   */
  root_span_id: string;

  /**
   * Incrementally update the current span with new data. The event will be batched and uploaded behind the scenes.
   *
   * @param event: Data to be logged. See `Experiment.log` for full details.
   */
  log(event: ExperimentLogPartialArgs): void;

  /**
   * Create a new span and run the provided callback. This is useful if you want to log more detailed trace information beyond the scope of a single log event. Data logged over several calls to `Span.log` will be merged into one logical row.
   *
   * Spans created within `traced` are ended automatically. By default, the span is marked as current, so they can be accessed using `braintrust.currentSpan`.
   *
   * @param callback The function to be run under the span context.
   * @param args.name Optional name of the span. If not provided, a name will be inferred from the call stack.
   * @param args.span_attributes Optional additional attributes to attach to the span, such as a type name.
   * @param args.start_time Optional start time of the span, as a timestamp in seconds.
   * @param args.setCurrent If true (the default), the span will be marked as the currently-active span for the duration of the callback.
   * @param args.event Data to be logged. See `Experiment.log` for full details.
   * @Returns The result of running `callback`.
   */
  traced<R>(
    callback: (span: Span) => R,
    args?: StartSpanArgs & SetCurrentArg
  ): R;

  /**
   * Lower-level alternative to `traced`, which does not automatically end the span or mark it as current. Be sure to end the span with `span.end()` when it has finished.
   *
   * See `traced` for full details.
   *
   * @returns The newly-created `Span`
   */
  startSpan(args?: StartSpanArgs): Span;

  /**
   * Log an end time to the span (defaults to the current time). Returns the logged time.
   *
   * Will be invoked automatically if the span is constructed with `traced`.
   *
   * @param args.endTime Optional end time of the span, as a timestamp in seconds.
   * @returns The end time logged to the span metrics.
   */
  end(args?: EndSpanArgs): number;

  /**
   * Alias for `end`.
   */
  close(args?: EndSpanArgs): number;

  // For type identification.
  kind: "span";
}

/**
 * A fake implementation of the Span API which does nothing. This can be used as the default span.
 */
export class NoopSpan implements Span {
  public id: string;
  public span_id: string;
  public root_span_id: string;
  public kind: "span" = "span";

  constructor() {
    this.id = "";
    this.span_id = "";
    this.root_span_id = "";
  }

  public log(_: ExperimentLogPartialArgs) {}

  public traced<R>(
    callback: (span: Span) => R,
    _1: StartSpanArgs & SetCurrentArg
  ): R {
    return callback(this);
  }

  public startSpan(_1?: StartSpanArgs) {
    return this;
  }

  public end(args?: EndSpanArgs): number {
    return args?.endTime ?? getCurrentUnixTimestamp();
  }

  public close(args?: EndSpanArgs): number {
    return this.end(args);
  }
}

export const NOOP_SPAN = new NoopSpan();

// In certain situations (e.g. the cli), we want separately-compiled modules to
// use the same state as the toplevel module. This global variable serves as a
// mechanism to propagate the initial state from some toplevel creator.
declare global {
  var __inherited_braintrust_state: BraintrustState;
}

class BraintrustState {
  public id: string;
  public currentExperiment: Experiment | undefined;
  // Note: the value of IsAsyncFlush doesn't really matter here, since we
  // (safely) dynamically cast it whenever retrieving the logger.
  public currentLogger: Logger<false> | undefined;
  public currentSpan: IsoAsyncLocalStorage<Span>;

  public apiUrl: string | null = null;
  public loginToken: string | null = null;
  public orgId: string | null = null;
  public orgName: string | null = null;
  public logUrl: string | null = null;
  public loggedIn: boolean = false;

  private _apiConn: HTTPConnection | null = null;
  private _logConn: HTTPConnection | null = null;

  constructor() {
    this.id = uuidv4(); // This is for debugging
    this.currentExperiment = undefined;
    this.currentLogger = undefined;
    this.currentSpan = iso.newAsyncLocalStorage();
    this.resetLoginInfo();

    globalThis.__inherited_braintrust_state = this;
  }

  public resetLoginInfo() {
    this.apiUrl = null;
    this.loginToken = null;
    this.orgId = null;
    this.orgName = null;
    this.logUrl = null;
    this.loggedIn = false;

    this._apiConn = null;
    this._logConn = null;
  }

  public apiConn(): HTTPConnection {
    if (!this._apiConn) {
      if (!this.apiUrl) {
        throw new Error("Must initialize apiUrl before requesting apiConn");
      }
      this._apiConn = new HTTPConnection(this.apiUrl);
    }
    return this._apiConn!;
  }

  public logConn(): HTTPConnection {
    if (!this._logConn) {
      if (!this.logUrl) {
        throw new Error("Must initialize logUrl before requesting logConn");
      }
      this._logConn = new HTTPConnection(this.logUrl);
    }
    return this._logConn!;
  }
}

let _state: BraintrustState;

// This function should be invoked exactly once after configuring the `iso`
// object based on the platform. See js/src/node.ts for an example.
export function _internalSetInitialState() {
  if (_state) {
    throw new Error("Cannot set initial state more than once");
  }
  _state = globalThis.__inherited_braintrust_state || new BraintrustState();
}
export const _internalGetGlobalState = () => _state;

class FailedHTTPResponse extends Error {
  public status: number;
  public text: string;
  public data: any;

  constructor(status: number, text: string, data: any = null) {
    super(`${status}: ${text}`);
    this.status = status;
    this.text = text;
    this.data = data;
  }
}
async function checkResponse(resp: Response) {
  if (resp.ok) {
    return resp;
  } else {
    throw new FailedHTTPResponse(
      resp.status,
      resp.statusText,
      await resp.text()
    );
  }
}

class HTTPConnection {
  base_url: string;
  token: string | null;
  headers: Record<string, string>;

  constructor(base_url: string) {
    this.base_url = base_url;
    this.token = null;
    this.headers = {};

    this._reset();
  }

  async ping() {
    try {
      const resp = await this.get("ping");
      return resp.status === 200;
    } catch (e) {
      return false;
    }
  }

  make_long_lived() {
    // Following a suggestion in https://stackoverflow.com/questions/23013220/max-retries-exceeded-with-url-in-requests
    this._reset();
  }

  static sanitize_token(token: string) {
    return token.trim();
  }

  set_token(token: string) {
    token = HTTPConnection.sanitize_token(token);
    this.token = token;
    this._reset();
  }

  // As far as I can tell, you cannot set the retry/backoff factor here
  _reset() {
    this.headers = {};
    if (this.token) {
      this.headers["Authorization"] = `Bearer ${this.token}`;
    }
  }

  async get(
    path: string,
    params: Record<string, string | undefined> | undefined = undefined
  ) {
    const url = new URL(_urljoin(this.base_url, path));
    url.search = new URLSearchParams(
      params
        ? (Object.fromEntries(
            Object.entries(params).filter(([_, v]) => v !== undefined)
          ) as Record<string, string>)
        : {}
    ).toString();
    return await checkResponse(
      await fetch(url, {
        headers: this.headers,
        keepalive: true,
      })
    );
  }

  async post(
    path: string,
    params?: Record<string, unknown> | string,
    config?: RequestInit
  ) {
    const { headers, ...rest } = config || {};
    return await checkResponse(
      await fetch(_urljoin(this.base_url, path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
          ...headers,
        },
        body:
          typeof params === "string"
            ? params
            : params
            ? JSON.stringify(params)
            : undefined,
        keepalive: true,
        ...rest,
      })
    );
  }

  async get_json(
    object_type: string,
    args: Record<string, string> | undefined = undefined,
    retries: number = 0
  ) {
    const tries = retries + 1;
    for (let i = 0; i < tries; i++) {
      try {
        const resp = await this.get(`${object_type}`, args);
        return await resp.json();
      } catch (e) {
        if (i < tries - 1) {
          console.log(
            `Retrying API request ${object_type} ${args} ${(e as any).status} ${
              (e as any).text
            }`
          );
          continue;
        }
        throw e;
      }
    }
  }

  async post_json(
    object_type: string,
    args: Record<string, unknown> | string | undefined = undefined
  ) {
    const resp = await this.post(`${object_type}`, args, {
      headers: { "Content-Type": "application/json" },
    });
    return await resp.json();
  }
}

export interface ObjectMetadata {
  id: string;
  name: string;
  fullInfo: Record<string, unknown>;
}

interface ProjectExperimentMetadata {
  project: ObjectMetadata;
  experiment: ObjectMetadata;
}

interface ProjectDatasetMetadata {
  project: ObjectMetadata;
  dataset: ObjectMetadata;
}

interface OrgProjectMetadata {
  org_id: string;
  project: ObjectMetadata;
}

export interface LogOptions<IsAsyncFlush> {
  asyncFlush?: IsAsyncFlush;
}

export type PromiseUnless<B, R> = B extends true ? R : Promise<Awaited<R>>;

export class Logger<IsAsyncFlush extends boolean> {
  private lazyMetadata: Promise<OrgProjectMetadata>;
  private logOptions: LogOptions<IsAsyncFlush>;
  private bgLogger: BackgroundLogger;
  private lastStartTime: number;

  // For type identification.
  public kind: "logger" = "logger";

  constructor(
    lazyMetadata: Promise<OrgProjectMetadata>,
    logOptions: LogOptions<IsAsyncFlush> = {}
  ) {
    this.lazyMetadata = lazyMetadata;
    this.logOptions = logOptions;
    const logConn = this.getState().then((state) => state.logConn());
    this.bgLogger = new BackgroundLogger(logConn);
    this.lastStartTime = getCurrentUnixTimestamp();
  }

  public get org_id(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata).org_id;
    })();
  }

  public get project(): Promise<ObjectMetadata> {
    return (async () => {
      return (await this.lazyMetadata).project;
    })();
  }

  private async getState(): Promise<BraintrustState> {
    // Ensure the login state is populated by awaiting lazyMetadata.
    await this.lazyMetadata;
    return _state;
  }

  /**
   * Log a single event. The event will be batched and uploaded behind the scenes if `logOptions.asyncFlush` is true.
   *
   * @param event The event to log.
   * @param event.input: The arguments that uniquely define a user input (an arbitrary, JSON serializable object).
   * @param event.output: The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
   * @param event.expected: The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
   * @param event.scores: A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare logs.
   * @param event.metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
   * @param event.metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically: "start", "end", "caller_functionname", "caller_filename", "caller_lineno".
   * @param event.id: (Optional) a unique identifier for the event. If you don't provide one, BrainTrust will generate one for you.
   * :returns: The `id` of the logged event.
   */
  public log(
    event: Readonly<StartSpanEventArgs>
  ): PromiseUnless<IsAsyncFlush, string> {
    const span = this.startSpan({ startTime: this.lastStartTime, event });
    this.lastStartTime = span.end();
    const ret = span.id;
    type Ret = PromiseUnless<IsAsyncFlush, string>;
    if (this.logOptions.asyncFlush === true) {
      return ret as Ret;
    } else {
      return (async () => {
        await this.flush();
        return ret;
      })() as Ret;
    }
  }

  /**
   * Create a new toplevel span underneath the logger. The name defaults to "root".
   *
   * See `Span.traced` for full details.
   */
  public traced<R>(
    callback: (span: Span) => R,
    args?: StartSpanArgs & SetCurrentArg
  ): PromiseUnless<IsAsyncFlush, R> {
    const { setCurrent, ...argsRest } = args ?? {};
    const span = this.startSpan(argsRest);
    const ret = runFinally(
      () => {
        if (setCurrent ?? true) {
          return withCurrent(span, callback);
        } else {
          return callback(span);
        }
      },
      () => span.end()
    );
    type Ret = PromiseUnless<IsAsyncFlush, R>;

    if (this.logOptions.asyncFlush) {
      return ret as Ret;
    } else {
      return (async () => {
        const awaitedRet = await ret;
        await this.flush();
        return awaitedRet;
      })() as Ret;
    }
  }

  /**
   * Lower-level alternative to `traced`, which does not automatically end the span or mark it as current.
   *
   * See `traced` for full details.
   */
  public startSpan(args?: StartSpanArgs): Span {
    const { name, ...argsRest } = args ?? {};
    const parentIds: Promise<ParentProjectLogIds> = (async () => ({
      kind: "project_log",
      org_id: await this.org_id,
      project_id: (await this.project).id,
      log_id: "g",
    }))();
    return new SpanImpl({
      parentIds,
      bgLogger: this.bgLogger,
      name: name ?? "root",
      ...argsRest,
    });
  }

  /*
   * Flush any pending logs to the server.
   */
  async flush(): Promise<void> {
    return await this.bgLogger.flush();
  }

  get asyncFlush(): IsAsyncFlush | undefined {
    return this.logOptions.asyncFlush;
  }
}

function castLogger<ToB extends boolean, FromB extends boolean>(
  logger: Logger<FromB> | undefined,
  asyncFlush?: ToB
): Logger<ToB> | undefined {
  if (logger === undefined) return undefined;
  if (asyncFlush && !!asyncFlush !== !!logger.asyncFlush) {
    throw new Error(
      `Asserted asyncFlush setting ${asyncFlush} does not match stored logger's setting ${logger.asyncFlush}`
    );
  }
  return logger as unknown as Logger<ToB>;
}

export type IdField = { id: string };
export type InputField = { input: unknown };
export type InputsField = { inputs: unknown };
export type OtherExperimentLogFields = {
  output: unknown;
  expected: unknown;
  scores: Record<string, number>;
  metadata: Record<string, unknown>;
  metrics: Record<string, unknown>;
  datasetRecordId: string;
};

export type ExperimentLogPartialArgs = Partial<OtherExperimentLogFields> &
  Partial<InputField | InputsField>;

export type ExperimentLogFullArgs = Partial<
  Omit<OtherExperimentLogFields, "scores">
> &
  Required<Pick<OtherExperimentLogFields, "scores">> &
  Partial<InputField | InputsField> &
  Partial<IdField>;

type SanitizedExperimentLogPartialArgs = Partial<OtherExperimentLogFields> &
  Partial<InputField>;

type ExperimentEvent = Partial<InputField> &
  Partial<OtherExperimentLogFields> & {
    id: string;
    span_id: string;
    root_span_id: string;
    project_id: string;
    experiment_id: string;
    [IS_MERGE_FIELD]: boolean;
  } & Partial<{
    created: string;
    span_parents: string[];
    span_attributes: Record<string, unknown>;
  }>;

interface DatasetEvent {
  inputs?: unknown;
  output?: unknown;
  metadata?: unknown;
  id: string;
  project_id: string;
  dataset_id: string;
  created: string;
}

type LoggingEvent = Omit<ExperimentEvent, "experiment_id"> & {
  org_id: string;
  log_id: "g";
};

type BackgroundLogEvent = ExperimentEvent | DatasetEvent | LoggingEvent;

export interface DatasetRecord {
  id: string;
  input: any;
  output: any;
  metadata: any;
}

// 6 MB (from our own testing).
const MaxRequestSize = 6 * 1024 * 1024;

function constructJsonArray(items: string[]) {
  return `[${items.join(",")}]`;
}

const DefaultBatchSize = 100;
const NumRetries = 3;

function now() {
  return new Date().getTime();
}

class BackgroundLogger {
  private logConn: Promise<HTTPConnection>;
  private items: Promise<BackgroundLogEvent>[] = [];
  private active_flush: Promise<string[]> = Promise.resolve([]);
  private active_flush_resolved = true;

  constructor(logConn: Promise<HTTPConnection>) {
    this.logConn = logConn;

    // Note that this will not run for explicit termination events, such as
    // calls to `process.exit()` or uncaught exceptions. Thus it is a
    // "best-effort" flush.
    iso.processOn("beforeExit", async () => {
      await this.flush();
    });
  }

  log(items: Promise<BackgroundLogEvent>[]) {
    this.items.push(...items);

    if (this.active_flush_resolved) {
      this.active_flush_resolved = false;
      this.active_flush = this.flush_once();
    }
  }

  async flush_once(batchSize: number = DefaultBatchSize): Promise<string[]> {
    this.active_flush_resolved = false;

    // Since the merged rows are guaranteed to refer to independent rows,
    // publish order does not matter and we can flush all item batches
    // concurrently.
    const itemPromises = this.items;
    this.items = [];
    const allItems = mergeRowBatch(await Promise.all(itemPromises)).reverse();

    let postPromises = [];
    while (true) {
      const items = [];
      let itemsLen = 0;
      while (items.length < batchSize && itemsLen < MaxRequestSize / 2) {
        let item = null;
        if (allItems.length > 0) {
          item = allItems.pop();
        } else {
          break;
        }

        const itemS = JSON.stringify(item);
        items.push(itemS);
        itemsLen += itemS.length;
      }

      if (items.length === 0) {
        break;
      }

      postPromises.push(
        (async () => {
          const itemsS = constructJsonArray(items);
          for (let i = 0; i < NumRetries; i++) {
            const startTime = now();
            try {
              return (await (await this.logConn).post_json("logs", itemsS)).map(
                (res: any) => res.id
              );
            } catch (e) {
              const retryingText = i + 1 === NumRetries ? "" : " Retrying";
              const errMsg = (() => {
                if (e instanceof FailedHTTPResponse) {
                  return `${e.status} (${e.text}): ${e.data}`;
                } else {
                  return `${e}`;
                }
              })();
              console.warn(
                `log request failed. Elapsed time: ${
                  (now() - startTime) / 1000
                } seconds. Payload size: ${
                  itemsS.length
                }. Error: ${errMsg}.${retryingText}`
              );
            }
          }
          console.warn(
            `log request failed after ${NumRetries} retries. Dropping batch`
          );
          return [];
        })()
      );
    }
    let ret = await Promise.all(postPromises);

    // If more items were added while we were flushing, flush again
    if (this.items.length > 0) {
      this.active_flush = this.flush_once();
    } else {
      this.active_flush_resolved = true;
    }

    return ret;
  }

  async flush(): Promise<void> {
    while (true) {
      await this.active_flush;
      if (this.active_flush_resolved) {
        break;
      }
    }
  }
}

export type InitOptions = {
  experiment?: string;
  description?: string;
  dataset?: Dataset;
  update?: boolean;
  baseExperiment?: string;
  isPublic?: boolean;
  apiUrl?: string;
  apiKey?: string;
  orgName?: string;
  metadata?: Metadata;
  setCurrent?: boolean;
};

/**
 * Log in, and then initialize a new experiment in a specified project. If the project does not exist, it will be created.
 *
 * @param project The name of the project to create the experiment in.
 * @param options Additional options for configuring init().
 * @param options.experiment The name of the experiment to create. If not specified, a name will be generated automatically.
 * @param options.description An optional description of the experiment.
 * @param options.dataset (Optional) A dataset to associate with the experiment. You can pass in the name of the dataset (in the same project) or a
 * dataset object (from any project).
 * @param options.update If the experiment already exists, continue logging to it.
 * @param options.baseExperiment An optional experiment name to use as a base. If specified, the new experiment will be summarized and compared to this
 * experiment. Otherwise, it will pick an experiment by finding the closest ancestor on the default (e.g. main) branch.
 * @param options.isPublic An optional parameter to control whether the experiment is publicly visible to anybody with the link or privately visible to only members of the organization. Defaults to private.
 * @param options.apiUrl The URL of the Braintrust API. Defaults to https://www.braintrustdata.com.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
 * key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @param options.metadata (Optional) A dictionary with additional data about the test example, model outputs, or just
 * about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the
 * `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any
 * JSON-serializable type, but its keys must be strings.
 * @param setCurrent If true (the default), set the global current-experiment to the newly-created one.
 * @returns The newly created Experiment.
 */
export function init(
  project: string,
  options: Readonly<InitOptions> = {}
): Experiment {
  const {
    experiment,
    description,
    dataset,
    baseExperiment,
    isPublic,
    update,
    apiUrl,
    apiKey,
    orgName,
    metadata,
  } = options || {};

  const lazyMetadata: Promise<ProjectExperimentMetadata> = (async () => {
    await login({
      orgName: orgName,
      apiKey,
      apiUrl,
    });
    const args: Record<string, unknown> = {
      project_name: project,
      org_id: _state.orgId,
    };

    if (experiment) {
      args["experiment_name"] = experiment;
    }

    if (description) {
      args["description"] = description;
    }

    if (update) {
      args["update"] = update;
    }

    const repoStatus = await iso.getRepoStatus();
    if (repoStatus) {
      args["repo_info"] = repoStatus;
    }

    if (baseExperiment) {
      args["base_experiment"] = baseExperiment;
    } else {
      args["ancestor_commits"] = await iso.getPastNAncestors();
    }

    if (dataset !== undefined) {
      args["dataset_id"] = dataset.id;
      args["dataset_version"] = await dataset.version();
    }

    if (isPublic !== undefined) {
      args["public"] = isPublic;
    }

    if (metadata) {
      args["metadata"] = metadata;
    }

    let response = null;
    while (true) {
      try {
        response = await _state
          .apiConn()
          .post_json("api/experiment/register", args);
        break;
      } catch (e: any) {
        if (
          args["base_experiment"] &&
          `${"data" in e && e.data}`.includes("base experiment")
        ) {
          console.warn(`Base experiment ${args["base_experiment"]} not found.`);
          delete args["base_experiment"];
        } else {
          throw e;
        }
      }
    }

    return {
      project: {
        id: response.project.id,
        name: response.project.name,
        fullInfo: response.project,
      },
      experiment: {
        id: response.experiment.id,
        name: response.experiment.name,
        fullInfo: response.experiment,
      },
    };
  })();

  const ret = new Experiment(lazyMetadata, dataset);
  if (options.setCurrent ?? true) {
    _state.currentExperiment = ret;
  }
  return ret;
}

/**
 * This function is deprecated. Use `init` instead.
 */
export function withExperiment<R>(
  project: string,
  callback: (experiment: Experiment) => R,
  options: Readonly<InitOptions & SetCurrentArg> = {}
): R {
  console.warn(
    "withExperiment is deprecated and will be removed in a future version of braintrust. Simply create the experiment with `init`."
  );
  const experiment = init(project, options);
  return callback(experiment);
}

/**
 * This function is deprecated. Use `initLogger` instead.
 */
export function withLogger<IsAsyncFlush extends boolean = false, R = void>(
  callback: (logger: Logger<IsAsyncFlush>) => R,
  options: Readonly<InitLoggerOptions<IsAsyncFlush> & SetCurrentArg> = {}
): R {
  console.warn(
    "withLogger is deprecated and will be removed in a future version of braintrust. Simply create the logger with `initLogger`."
  );
  const logger = initLogger(options);
  return callback(logger);
}

type InitDatasetOptions = {
  dataset?: string;
  description?: string;
  version?: string;
  apiUrl?: string;
  apiKey?: string;
  orgName?: string;
};

/**
 * Create a new dataset in a specified project. If the project does not exist, it will be created.
 *
 * @param project The name of the project to create the dataset in.
 * @param options Additional options for configuring init().
 * @param options.dataset The name of the dataset to create. If not specified, a name will be generated automatically.
 * @param options.description An optional description of the dataset.
 * @param options.apiUrl The URL of the Braintrust API. Defaults to https://www.braintrustdata.com.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
 * key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @returns The newly created Dataset.
 */
export function initDataset(
  project: string,
  options: Readonly<InitDatasetOptions> = {}
) {
  const { dataset, description, version, apiUrl, apiKey, orgName } =
    options || {};

  const lazyMetadata: Promise<ProjectDatasetMetadata> = (async () => {
    await login({
      orgName: orgName,
      apiKey,
      apiUrl,
    });

    const args: Record<string, unknown> = {
      org_id: _state.orgId,
      project_name: project,
      dataset_name: dataset,
      description,
    };
    const response = await _state
      .apiConn()
      .post_json("api/dataset/register", args);

    return {
      project: {
        id: response.project.id,
        name: response.project.name,
        fullInfo: response.project,
      },
      dataset: {
        id: response.dataset.id,
        name: response.dataset.name,
        fullInfo: response.dataset,
      },
    };
  })();

  return new Dataset(lazyMetadata, version);
}

/**
 * This function is deprecated. Use `initDataset` instead.
 */
export function withDataset<R>(
  project: string,
  callback: (dataset: Dataset) => R,
  options: Readonly<InitDatasetOptions> = {}
): R {
  console.warn(
    "withDataset is deprecated and will be removed in a future version of braintrust. Simply create the dataset with `initDataset`."
  );
  const dataset = initDataset(project, options);
  return callback(dataset);
}

type AsyncFlushArg<IsAsyncFlush> = {
  asyncFlush?: IsAsyncFlush;
};

type InitLoggerOptions<IsAsyncFlush> = {
  projectName?: string;
  projectId?: string;
  apiUrl?: string;
  apiKey?: string;
  orgName?: string;
  forceLogin?: boolean;
  setCurrent?: boolean;
} & AsyncFlushArg<IsAsyncFlush>;

/**
 * Create a new logger in a specified project. If the project does not exist, it will be created.
 *
 * @param options Additional options for configuring init().
 * @param options.projectName The name of the project to log into. If unspecified, will default to the Global project.
 * @param options.projectId The id of the project to log into. This takes precedence over projectName if specified.
 * @param options.asyncFlush If true, will log asynchronously in the background. Otherwise, will log synchronously. (false by default, to support serverless environments)
 * @param options.apiUrl The URL of the Braintrust API. Defaults to https://www.braintrustdata.com.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
 * key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @param options.forceLogin Login again, even if you have already logged in (by default, the logger will not login if you are already logged in)
 * @param setCurrent If true (the default), set the global current-experiment to the newly-created one.
 * @returns The newly created Logger.
 */
export function initLogger<IsAsyncFlush extends boolean = false>(
  options: Readonly<InitLoggerOptions<IsAsyncFlush>> = {}
) {
  const {
    projectName,
    projectId,
    asyncFlush,
    apiUrl,
    apiKey,
    orgName,
    forceLogin,
  } = options || {};

  const lazyMetadata: Promise<OrgProjectMetadata> = (async () => {
    await login({
      orgName: orgName,
      apiKey,
      apiUrl,
      forceLogin,
    });
    const org_id = _state.orgId!;
    if (projectId === undefined) {
      const response = await _state
        .apiConn()
        .post_json("api/project/register", {
          project_name: projectName || GLOBAL_PROJECT,
          org_id,
        });
      return {
        org_id,
        project: {
          id: response.project.id,
          name: response.project.name,
          fullInfo: response.project,
        },
      };
    } else if (projectName === undefined) {
      const response = await _state.apiConn().get_json("api/project", {
        id: projectId,
      });
      return {
        org_id,
        project: {
          id: projectId,
          name: response.name,
          fullInfo: response.project,
        },
      };
    } else {
      return {
        org_id,
        project: { id: projectId, name: projectName, fullInfo: {} },
      };
    }
  })();

  const ret = new Logger<IsAsyncFlush>(lazyMetadata, {
    asyncFlush,
  });
  if (options.setCurrent ?? true) {
    _state.currentLogger = ret as Logger<false>;
  }
  return ret;
}

/**
 * Log into Braintrust. This will prompt you for your API token, which you can find at
 * https://www.braintrustdata.com/app/token. This method is called automatically by `init()`.
 *
 * @param options Options for configuring login().
 * @param options.apiUrl The URL of the Braintrust API. Defaults to https://www.braintrustdata.com.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
 * key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @param options.forceLogin Login again, even if you have already logged in (by default, this function will exit quickly if you have already logged in)
 */
export async function login(
  options: {
    apiUrl?: string;
    apiKey?: string;
    orgName?: string;
    forceLogin?: boolean;
  } = {}
) {
  const {
    apiUrl = iso.getEnv("BRAINTRUST_API_URL") ||
      "https://www.braintrustdata.com",
    apiKey = iso.getEnv("BRAINTRUST_API_KEY"),
    orgName = iso.getEnv("BRAINTRUST_ORG_NAME"),
  } = options || {};

  let { forceLogin = false } = options || {};

  if (_state.loggedIn && !forceLogin) {
    return;
  }

  _state.resetLoginInfo();

  _state.apiUrl = apiUrl;

  let conn = null;

  if (apiKey !== undefined) {
    const resp = await checkResponse(
      await fetch(_urljoin(_state.apiUrl, `/api/apikey/login`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: apiKey,
        }),
      })
    );
    const info = await resp.json();

    _check_org_info(info.org_info, orgName);

    conn = _state.logConn();
    conn.set_token(apiKey);
  } else {
    // TODO: Implement token based login in the JS client
    throw new Error(
      "Please specify an api key. Token based login is not yet implemented in the JS client."
    );
  }

  if (!conn) {
    throw new Error("Conn should be set at this point (a bug)");
  }

  conn.make_long_lived();

  // Set the same token in the API
  _state.apiConn().set_token(apiKey);
  _state.loginToken = conn.token;
  _state.loggedIn = true;
}

// XXX We should remove these global functions now
/**
 * Log a single event to the current experiment. The event will be batched and uploaded behind the scenes.
 *
 * @param event The event to log. See `Experiment.log` for full details.
 * @returns The `id` of the logged event.
 */
export function log(event: ExperimentLogFullArgs): string {
  console.warn(
    "braintrust.log is deprecated and will be removed in a future version of braintrust. Use `experiment.log` instead."
  );
  const e = currentExperiment();
  if (!e) {
    throw new Error("Not initialized. Please call init() first");
  }
  return e.log(event);
}

/**
 * Summarize the current experiment, including the scores (compared to the closest reference experiment) and metadata.
 *
 * @param options Options for summarizing the experiment.
 * @param options.summarizeScores Whether to summarize the scores. If False, only the metadata will be returned.
 * @param options.comparisonExperimentId The experiment to compare against. If None, the most recent experiment on the origin's main branch will be used.
 * @returns A summary of the experiment, including the scores (compared to the closest reference experiment) and metadata.
 */
export async function summarize(
  options: {
    readonly summarizeScores?: boolean;
    readonly comparisonExperimentId?: string;
  } = {}
): Promise<ExperimentSummary> {
  console.warn(
    "braintrust.summarize is deprecated and will be removed in a future version of braintrust. Use `experiment.summarize` instead."
  );
  const e = currentExperiment();
  if (!e) {
    throw new Error("Not initialized. Please call init() first");
  }
  return await e.summarize(options);
}

/**
 * Returns the currently-active experiment (set by `braintrust.init`). Returns undefined if no current experiment has been set.
 */
export function currentExperiment(): Experiment | undefined {
  return _state.currentExperiment;
}

/**
 * Returns the currently-active logger (set by `braintrust.initLogger`). Returns undefined if no current logger has been set.
 */
export function currentLogger<IsAsyncFlush extends boolean>(
  options?: AsyncFlushArg<IsAsyncFlush>
): Logger<IsAsyncFlush> | undefined {
  return castLogger(_state.currentLogger, options?.asyncFlush);
}

/**
 * Return the currently-active span for logging (set by one of the `traced` methods). If there is no active span, returns a no-op span object, which supports the same interface as spans but does no logging.
 *
 * See `Span` for full details.
 */
export function currentSpan(): Span {
  return _state.currentSpan.getStore() ?? NOOP_SPAN;
}

/**
 * Mainly for internal use. Return the parent object for starting a span in a global context.
 */
export function getSpanParentObject<IsAsyncFlush extends boolean>(
  options?: AsyncFlushArg<IsAsyncFlush>
): Span | Experiment | Logger<IsAsyncFlush> {
  const parentSpan = currentSpan();
  if (!Object.is(parentSpan, NOOP_SPAN)) {
    return parentSpan;
  }
  const experiment = currentExperiment();
  if (experiment) {
    return experiment;
  }
  const logger = currentLogger<IsAsyncFlush>(options);
  if (logger) {
    return logger;
  }
  return NOOP_SPAN;
}

/**
 * Toplevel function for starting a span. It checks the following (in precedence order):
 *  * Currently-active span
 *  * Currently-active experiment
 *  * Currently-active logger
 *
 * and creates a span under the first one that is active. If none of these are active, it returns a no-op span object.
 *
 * See `Span.traced` for full details.
 */
export function traced<IsAsyncFlush extends boolean = false, R = void>(
  callback: (span: Span) => R,
  args?: StartSpanArgs & SetCurrentArg & AsyncFlushArg<IsAsyncFlush>
): PromiseUnless<IsAsyncFlush, R> {
  const { span, parentObject } = startSpanReturnParent<IsAsyncFlush>(args);
  const ret = runFinally(
    () => {
      if (args?.setCurrent ?? true) {
        return withCurrent(span, callback);
      } else {
        return callback(span);
      }
    },
    () => span.end()
  );
  type Ret = PromiseUnless<IsAsyncFlush, R>;

  if (args?.asyncFlush) {
    return ret as Ret;
  } else {
    return (async () => {
      const awaitedRet = await ret;
      if (parentObject.kind === "logger") {
        await parentObject.flush();
      }
      return awaitedRet;
    })() as Ret;
  }
}

/**
 * Lower-level alternative to `traced`, which does not automatically end the span or mark it as current. See `traced` for full details.
 */
export function startSpan<IsAsyncFlush extends boolean = false>(
  args?: StartSpanArgs & AsyncFlushArg<IsAsyncFlush>
): Span {
  return startSpanReturnParent<IsAsyncFlush>(args).span;
}

function startSpanReturnParent<IsAsyncFlush extends boolean = false>(
  args?: StartSpanArgs & AsyncFlushArg<IsAsyncFlush>
) {
  const parentObject = getSpanParentObject<IsAsyncFlush>({
    asyncFlush: args?.asyncFlush,
  });
  const { name: nameOpt, ...argsRest } = args ?? {};
  const name = parentObject.kind === "span" ? nameOpt : nameOpt ?? "root";
  return { span: parentObject.startSpan({ name, ...argsRest }), parentObject };
}

// Set the given span as current within the given callback and any asynchronous
// operations created within the callback.
function withCurrent<R>(span: Span, callback: (span: Span) => R): R {
  return _state.currentSpan.run(span, () => callback(span));
}

function _check_org_info(org_info: any, org_name: string | undefined) {
  if (org_info.length === 0) {
    throw new Error("This user is not part of any organizations.");
  }

  for (const org of org_info) {
    if (org_name === undefined || org.name === org_name) {
      _state.orgId = org.id;
      _state.orgName = org.name;
      _state.logUrl = iso.getEnv("BRAINTRUST_LOG_URL") ?? org.api_url;
      break;
    }
  }

  if (_state.orgId === undefined) {
    throw new Error(
      `Organization ${org_name} not found. Must be one of ${org_info
        .map((x: any) => x.name)
        .join(", ")}`
    );
  }
}

function _urljoin(...parts: string[]): string {
  return parts.map((x) => x.replace(/^\//, "")).join("/");
}

function validateAndSanitizeExperimentLogPartialArgs(
  event: ExperimentLogPartialArgs
): SanitizedExperimentLogPartialArgs {
  if (event.scores) {
    for (let [name, score] of Object.entries(event.scores)) {
      if (typeof name !== "string") {
        throw new Error("score names must be strings");
      }

      if (typeof score === "boolean") {
        score = score ? 1 : 0;
        event.scores[name] = score;
      }

      if (typeof score !== "number") {
        throw new Error("score values must be numbers");
      }
      if (score < 0 || score > 1) {
        throw new Error("score values must be between 0 and 1");
      }
    }
  }

  if (event.metadata) {
    for (const key of Object.keys(event.metadata)) {
      if (typeof key !== "string") {
        throw new Error("metadata keys must be strings");
      }
    }
  }

  if (event.metrics) {
    for (const [key, value] of Object.entries(event.metrics)) {
      if (typeof key !== "string") {
        throw new Error("metric keys must be strings");
      }

      if (typeof value !== "number") {
        throw new Error("metric values must be numbers");
      }
    }
  }

  if ("input" in event && event.input && "inputs" in event && event.inputs) {
    throw new Error(
      "Only one of input or inputs (deprecated) can be specified. Prefer input."
    );
  }

  if ("inputs" in event) {
    const { inputs, ...rest } = event;
    return { input: inputs, ...rest };
  } else {
    return { ...event };
  }
}

// Note that this only checks properties that are expected of a complete event.
// validateAndSanitizeExperimentLogPartialArgs should still be invoked (after
// handling special fields like 'id').
function validateAndSanitizeExperimentLogFullArgs(
  event: ExperimentLogFullArgs,
  hasDataset: boolean
): ExperimentLogFullArgs {
  if (
    ("input" in event && event.input && "inputs" in event && event.inputs) ||
    (!("input" in event) && !("inputs" in event))
  ) {
    throw new Error(
      "Exactly one of input or inputs (deprecated) must be specified. Prefer input."
    );
  }

  if (!event.scores) {
    throw new Error("scores must be specified");
  }

  if (hasDataset && event.datasetRecordId === undefined) {
    throw new Error("datasetRecordId must be specified when using a dataset");
  } else if (!hasDataset && event.datasetRecordId !== undefined) {
    throw new Error(
      "datasetRecordId cannot be specified when not using a dataset"
    );
  }

  return event;
}

/**
 * An experiment is a collection of logged events, such as model inputs and outputs, which represent
 * a snapshot of your application at a particular point in time. An experiment is meant to capture more
 * than just the model you use, and includes the data you use to test, pre- and post- processing code,
 * comparison metrics (scores), and any other metadata you want to include.
 *
 * Experiments are associated with a project, and two experiments are meant to be easily comparable via
 * their `inputs`. You can change the attributes of the experiments in a project (e.g. scoring functions)
 * over time, simply by changing what you log.
 *
 * You should not create `Experiment` objects directly. Instead, use the `braintrust.init()` method.
 */
export class Experiment {
  private readonly lazyMetadata: Promise<ProjectExperimentMetadata>;
  public readonly dataset?: Dataset;
  private bgLogger: BackgroundLogger;
  private lastStartTime: number;
  // For type identification.
  public kind: "experiment" = "experiment";

  constructor(
    lazyMetadata: Promise<ProjectExperimentMetadata>,
    dataset?: Dataset
  ) {
    this.lazyMetadata = lazyMetadata;
    this.dataset = dataset;

    const logConn = this.getState().then((state) => state.logConn());
    this.bgLogger = new BackgroundLogger(logConn);
    this.lastStartTime = getCurrentUnixTimestamp();
  }

  public get id(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata).experiment.id;
    })();
  }

  public get name(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata).experiment.name;
    })();
  }

  public get project(): Promise<ObjectMetadata> {
    return (async () => {
      return (await this.lazyMetadata).project;
    })();
  }

  private async getState(): Promise<BraintrustState> {
    // Ensure the login state is populated by awaiting lazyMetadata.
    await this.lazyMetadata;
    return _state;
  }

  /**
   * Log a single event to the experiment. The event will be batched and uploaded behind the scenes.
   *
   * @param event The event to log.
   * @param event.input: The arguments that uniquely define a test case (an arbitrary, JSON serializable object). Later on, Braintrust will use the `input` to know whether two test cases are the same between experiments, so they should not contain experiment-specific state. A simple rule of thumb is that if you run the same experiment twice, the `input` should be identical.
   * @param event.output: The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
   * @param event.expected: The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate your experiments while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
   * @param event.scores: A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare experiments.
   * @param event.metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
   * @param event.metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically: "start", "end", "caller_functionname", "caller_filename", "caller_lineno".
   * @param event.id: (Optional) a unique identifier for the event. If you don't provide one, BrainTrust will generate one for you.
   * @param event.dataset_record_id: (Optional) the id of the dataset record that this event is associated with. This field is required if and only if the experiment is associated with a dataset.
   * @param event.inputs: (Deprecated) the same as `input` (will be removed in a future version).
   * :returns: The `id` of the logged event.
   */
  public log(event: Readonly<ExperimentLogFullArgs>): string {
    event = validateAndSanitizeExperimentLogFullArgs(event, !!this.dataset);
    const span = this.startSpan({ startTime: this.lastStartTime, event });
    this.lastStartTime = span.end();
    return span.id;
  }

  /**
   * Create a new toplevel span underneath the experiment. The name defaults to "root".
   *
   * See `Span.traced` for full details.
   */
  public traced<R>(
    callback: (span: Span) => R,
    args?: StartSpanArgs & SetCurrentArg
  ): R {
    const { setCurrent, ...argsRest } = args ?? {};
    const span = this.startSpan(argsRest);
    return runFinally(
      () => {
        if (setCurrent ?? true) {
          return withCurrent(span, callback);
        } else {
          return callback(span);
        }
      },
      () => span.end()
    );
  }

  /**
   * Lower-level alternative to `traced`, which does not automatically end the span or mark it as current.
   *
   * See `traced` for full details.
   */
  public startSpan(args?: StartSpanArgs): Span {
    const { name, ...argsRest } = args ?? {};
    const parentIds: Promise<ParentExperimentIds> = (async () => ({
      kind: "experiment",
      project_id: (await this.project).id,
      experiment_id: await this.id,
    }))();
    return new SpanImpl({
      parentIds,
      bgLogger: this.bgLogger,
      name: name ?? "root",
      ...argsRest,
    });
  }

  /**
   * Summarize the experiment, including the scores (compared to the closest reference experiment) and metadata.
   *
   * @param options Options for summarizing the experiment.
   * @param options.summarizeScores Whether to summarize the scores. If False, only the metadata will be returned.
   * @param options.comparisonExperimentId The experiment to compare against. If None, the most recent experiment on the origin's main branch will be used.
   * @returns A summary of the experiment, including the scores (compared to the closest reference experiment) and metadata.
   */
  public async summarize(
    options: {
      readonly summarizeScores?: boolean;
      readonly comparisonExperimentId?: string;
    } = {}
  ): Promise<ExperimentSummary> {
    let { summarizeScores = true, comparisonExperimentId = undefined } =
      options || {};

    await this.bgLogger.flush();
    const state = await this.getState();
    const projectUrl = `${state.apiUrl}/app/${encodeURIComponent(
      state.orgName!
    )}/p/${encodeURIComponent((await this.project).name)}`;
    const experimentUrl = `${projectUrl}/${encodeURIComponent(
      await this.name
    )}`;

    let scores: Record<string, ScoreSummary> | undefined = undefined;
    let metrics: Record<string, MetricSummary> | undefined = undefined;
    let comparisonExperimentName = undefined;
    if (summarizeScores) {
      if (comparisonExperimentId === undefined) {
        const conn = state.logConn();
        const resp = await conn.get("/crud/base_experiments", {
          id: await this.id,
        });
        const base_experiments = await resp.json();
        if (base_experiments.length > 0) {
          comparisonExperimentId = base_experiments[0]["base_exp_id"];
          comparisonExperimentName = base_experiments[0]["base_exp_name"];
        }
      }

      if (comparisonExperimentId !== undefined) {
        const results = await state.logConn().get_json(
          "/experiment-comparison2",
          {
            experiment_id: await this.id,
            base_experiment_id: comparisonExperimentId,
          },
          3
        );

        scores = results["scores"];
        metrics = results["metrics"];
      }
    }

    return {
      projectName: (await this.project).name,
      experimentName: await this.name,
      projectUrl: projectUrl,
      experimentUrl: experimentUrl,
      comparisonExperimentName: comparisonExperimentName,
      scores,
      metrics,
    };
  }

  /**
   * Flush any pending rows to the server.
   */
  async flush(): Promise<void> {
    return await this.bgLogger.flush();
  }

  /**
   * This function is deprecated. You can simply remove it from your code.
   */
  public async close(): Promise<string> {
    console.warn(
      "close is deprecated and will be removed in a future version of braintrust. It is now a no-op and can be removed"
    );
    return this.id;
  }
}

interface ParentExperimentIds {
  kind: "experiment";
  project_id: string;
  experiment_id: string;
}

interface ParentProjectLogIds {
  kind: "project_log";
  org_id: string;
  project_id: string;
  log_id: "g";
}

/**
 * Primary implementation of the `Span` interface. See the `Span` interface for full details on each method.
 *
 * We suggest using one of the various `traced` methods, instead of creating Spans directly. See `Span.startSpan` for full details.
 */
export class SpanImpl implements Span {
  private bgLogger: BackgroundLogger;
  // `internalData` contains fields that are not part of the "user-sanitized"
  // set of fields which we want to log in just one of the span rows.
  private internalData: Partial<ExperimentEvent>;
  private isMerge: boolean;
  private loggedEndTime: number | undefined;

  // These fields are logged to every span row.
  private parentIds: Promise<ParentExperimentIds | ParentProjectLogIds>;
  private readonly rowIds: {
    id: string;
    span_id: string;
    root_span_id: string;
  };

  public kind: "span" = "span";

  // root_experiment should only be specified for a root span. parent_span
  // should only be specified for non-root spans.
  constructor(
    args: {
      parentIds: Promise<ParentExperimentIds | ParentProjectLogIds>;
      bgLogger: BackgroundLogger;
      parentSpanInfo?: { span_id: string; root_span_id: string };
    } & StartSpanArgs
  ) {
    this.loggedEndTime = undefined;

    this.bgLogger = args.bgLogger;

    const callerLocation = iso.getCallerLocation();
    const name = (() => {
      if (args.name) return args.name;
      if (callerLocation) {
        const pathComponents = callerLocation.caller_filename.split("/");
        const filename = pathComponents[pathComponents.length - 1];
        return [callerLocation.caller_functionname]
          .concat(
            filename ? [`${filename}:${callerLocation.caller_lineno}`] : []
          )
          .join(":");
      }
      return "subspan";
    })();
    this.internalData = {
      metrics: {
        start: args.startTime ?? getCurrentUnixTimestamp(),
        ...callerLocation,
      },
      span_attributes: { ...args.spanAttributes, name },
      created: new Date().toISOString(),
    };

    this.parentIds = args.parentIds;

    const id = args.event?.id ?? uuidv4();
    const span_id = uuidv4();
    this.rowIds = {
      id,
      span_id,
      root_span_id: args.parentSpanInfo?.root_span_id ?? span_id,
    };
    if (args.parentSpanInfo) {
      this.internalData.span_parents = [args.parentSpanInfo.span_id];
    }

    // The first log is a replacement, but subsequent logs to the same span
    // object will be merges.
    this.isMerge = false;
    const { id: _id, ...eventRest } = args.event ?? {};
    this.log(eventRest);
    this.isMerge = true;
  }

  public get id(): string {
    return this.rowIds.id;
  }

  public get span_id(): string {
    return this.rowIds.span_id;
  }

  public get root_span_id(): string {
    return this.rowIds.root_span_id;
  }

  public log(event: ExperimentLogPartialArgs): void {
    const sanitized = validateAndSanitizeExperimentLogPartialArgs(event);
    // There should be no overlap between the dictionaries being merged,
    // except for `sanitized` and `internalData`, where the former overrides
    // the latter.
    const sanitizedAndInternalData = { ...this.internalData };
    mergeDicts(sanitizedAndInternalData, sanitized);
    this.internalData = {};
    if (sanitizedAndInternalData.metrics?.end) {
      this.loggedEndTime = sanitizedAndInternalData.metrics?.end as number;
    }
    const record = (async () => {
      return {
        ...sanitizedAndInternalData,
        ...this.rowIds,
        ...(await this.parentIds),
        [IS_MERGE_FIELD]: this.isMerge,
      };
    })();
    this.bgLogger.log([record]);
  }

  public traced<R>(
    callback: (span: Span) => R,
    args?: StartSpanArgs & SetCurrentArg
  ): R {
    const { setCurrent, ...argsRest } = args ?? {};
    const span = this.startSpan(argsRest);
    return runFinally(
      () => {
        if (setCurrent ?? true) {
          return withCurrent(span, callback);
        } else {
          return callback(span);
        }
      },
      () => span.end()
    );
  }

  public startSpan(args?: StartSpanArgs): Span {
    return new SpanImpl({
      parentIds: this.parentIds,
      bgLogger: this.bgLogger,
      parentSpanInfo: {
        span_id: this.rowIds.span_id,
        root_span_id: this.rowIds.root_span_id,
      },
      ...args,
    });
  }

  public end(args?: EndSpanArgs): number {
    let endTime: number;
    if (!this.loggedEndTime) {
      endTime = args?.endTime ?? getCurrentUnixTimestamp();
      this.internalData = { metrics: { end: endTime } };
    } else {
      endTime = this.loggedEndTime;
    }
    this.log({});
    return endTime;
  }

  public close(args?: EndSpanArgs): number {
    return this.end(args);
  }
}

/**
 * A dataset is a collection of records, such as model inputs and outputs, which represent
 * data you can use to evaluate and fine-tune models. You can log production data to datasets,
 * curate them with interesting examples, edit/delete records, and run evaluations against them.
 *
 * You should not create `Dataset` objects directly. Instead, use the `braintrust.initDataset()` method.
 */
export class Dataset {
  private readonly lazyMetadata: Promise<ProjectDatasetMetadata>;
  private pinnedVersion?: string;
  private _fetchedData?: any[] = undefined;
  private bgLogger: BackgroundLogger;

  constructor(
    lazyMetadata: Promise<ProjectDatasetMetadata>,
    pinnedVersion?: string
  ) {
    this.lazyMetadata = lazyMetadata;
    this.pinnedVersion = pinnedVersion;
    const logConn = this.getState().then((state) => state.logConn());
    this.bgLogger = new BackgroundLogger(logConn);
  }

  public get id(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata).dataset.id;
    })();
  }

  public get name(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata).dataset.name;
    })();
  }

  public get project(): Promise<ObjectMetadata> {
    return (async () => {
      return (await this.lazyMetadata).project;
    })();
  }

  private async getState(): Promise<BraintrustState> {
    // Ensure the login state is populated by awaiting lazyMetadata.
    await this.lazyMetadata;
    return _state;
  }

  /**
   * Insert a single record to the dataset. The record will be batched and uploaded behind the scenes. If you pass in an `id`,
   * and a record with that `id` already exists, it will be overwritten (upsert).
   *
   * @param event The event to log.
   * @param event.input The argument that uniquely define an input case (an arbitrary, JSON serializable object).
   * @param event.output The output of your application, including post-processing (an arbitrary, JSON serializable object).
   * @param event.metadata (Optional) a dictionary with additional data about the test example, model outputs, or just
   * about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the
   * `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any
   * JSON-serializable type, but its keys must be strings.
   * @param event.id (Optional) a unique identifier for the event. If you don't provide one, Braintrust will generate one for you.
   * @returns The `id` of the logged record.
   */
  public insert({
    input,
    output,
    metadata,
    id,
  }: {
    readonly input?: unknown;
    readonly output: unknown;
    readonly metadata?: Record<string, unknown>;
    readonly id?: string;
  }): string {
    if (metadata !== undefined) {
      for (const key of Object.keys(metadata)) {
        if (typeof key !== "string") {
          throw new Error("metadata keys must be strings");
        }
      }
    }

    const rowId = id || uuidv4();
    const args = (async () => ({
      id: rowId,
      inputs: input,
      output,
      project_id: (await this.project).id,
      dataset_id: await this.id,
      created: new Date().toISOString(),
      metadata,
    }))();

    this.bgLogger.log([args]);
    return rowId;
  }

  public delete(id: string): string {
    const args = (async () => ({
      id,
      project_id: (await this.project).id,
      dataset_id: await this.id,
      created: new Date().toISOString(),
      _object_delete: true,
    }))();

    this.bgLogger.log([args]);
    return id;
  }

  /**
   * Summarize the dataset, including high level metrics about its size and other metadata.
   * @param summarizeData Whether to summarize the data. If false, only the metadata will be returned.
   * @returns `DatasetSummary`
   * @returns A summary of the dataset.
   */
  public async summarize(
    options: { readonly summarizeData?: boolean } = {}
  ): Promise<DatasetSummary> {
    let { summarizeData = true } = options || {};

    await this.bgLogger.flush();
    const state = await this.getState();
    const projectUrl = `${state.apiUrl}/app/${encodeURIComponent(
      state.orgName!
    )}/p/${encodeURIComponent((await this.project).name)}`;
    const datasetUrl = `${projectUrl}/d/${encodeURIComponent(await this.name)}`;

    let dataSummary = undefined;
    if (summarizeData) {
      dataSummary = await state.logConn().get_json(
        "dataset-summary",
        {
          dataset_id: await this.id,
        },
        3
      );
    }

    return {
      projectName: (await this.project).name,
      datasetName: await this.name,
      projectUrl,
      datasetUrl,
      dataSummary,
    };
  }

  /**
   * Fetch all records in the dataset.
   *
   * @example
   * ```
   * // Use an async iterator to fetch all records in the dataset.
   * for await (const record of dataset.fetch()) {
   *  console.log(record);
   * }
   *
   * // You can also iterate over the dataset directly.
   * for await (const record of dataset) {
   *  console.log(record);
   * }
   * ```
   *
   * @returns An iterator over the dataset's records.
   */
  async *fetch(): AsyncGenerator<DatasetRecord> {
    const records = await this.fetchedData();
    for (const record of records) {
      yield {
        id: record.id,
        input: record.input && JSON.parse(record.input),
        output: record.input && JSON.parse(record.output),
        metadata: record.metadata && JSON.parse(record.metadata),
      };
    }
    this.clearCache();
  }

  /**
   * Fetch all records in the dataset.
   *
   * @example
   * ```
   * // Use an async iterator to fetch all records in the dataset.
   * for await (const record of dataset) {
   *  console.log(record);
   * }
   * ```
   */
  [Symbol.asyncIterator]() {
    return this.fetch();
  }

  async fetchedData() {
    if (this._fetchedData === undefined) {
      const state = await this.getState();
      const resp = await state.logConn().get("object/dataset", {
        id: await this.id,
        fmt: "json",
        version: this.pinnedVersion,
      });

      const text = await resp.text();
      this._fetchedData = text
        .split("\n")
        .filter((x: string) => x.trim() !== "")
        .map((x: string) => JSON.parse(x));
    }

    return this._fetchedData || [];
  }

  clearCache() {
    this._fetchedData = undefined;
  }

  async version() {
    if (this.pinnedVersion !== undefined) {
      return this.pinnedVersion;
    } else {
      const fetchedData = await this.fetchedData();
      let maxVersion = undefined;
      for (const record of fetchedData) {
        const xactId = record[TRANSACTION_ID_FIELD];
        if (maxVersion === undefined || (xactId ?? xactId > maxVersion)) {
          maxVersion = xactId;
        }
      }
      return maxVersion;
    }
  }

  /**
   * Flush any pending rows to the server.
   */
  async flush(): Promise<void> {
    return await this.bgLogger.flush();
  }

  /**
   * This function is deprecated. You can simply remove it from your code.
   */
  public async close(): Promise<string> {
    console.warn(
      "close is deprecated and will be removed in a future version of braintrust. It is now a no-op and can be removed"
    );
    return this.id;
  }
}

/**
 * Summary of a score's performance.
 * @property name Name of the score.
 * @property score Average score across all examples.
 * @property diff Difference in score between the current and reference experiment.
 * @property improvements Number of improvements in the score.
 * @property regressions Number of regressions in the score.
 */
export interface ScoreSummary {
  name: string;
  score: number;
  diff: number;
  improvements: number;
  regressions: number;
}

/**
 * Summary of a metric's performance.
 * @property name Name of the metric.
 * @property metric Average metric across all examples.
 * @property unit Unit label for the metric.
 * @property diff Difference in metric between the current and reference experiment.
 * @property improvements Number of improvements in the metric.
 * @property regressions Number of regressions in the metric.
 */
export interface MetricSummary {
  name: string;
  metric: number;
  unit: string;
  diff: number;
  improvements: number;
  regressions: number;
}

/**
 * Summary of an experiment's scores and metadata.
 * @property projectName Name of the project that the experiment belongs to.
 * @property experimentName Name of the experiment.
 * @property projectUrl URL to the project's page in the Braintrust app.
 * @property experimentUrl URL to the experiment's page in the Braintrust app.
 * @property comparisonExperimentName The experiment scores are baselined against.
 * @property scores Summary of the experiment's scores.
 */
export interface ExperimentSummary {
  projectName: string;
  experimentName: string;
  projectUrl: string;
  experimentUrl: string;
  comparisonExperimentName: string | undefined;
  scores: Record<string, ScoreSummary> | undefined;
  metrics: Record<string, MetricSummary> | undefined;
}

/**
 * Summary of a dataset's data.
 *
 * @property newRecords New or updated records added in this session.
 * @property totalRecords Total records in the dataset.
 */
export interface DataSummary {
  newRecords: number;
  totalRecords: number;
}

/**
 * Summary of a dataset's scores and metadata.
 *
 * @property projectName Name of the project that the dataset belongs to.
 * @property datasetName Name of the dataset.
 * @property projectUrl URL to the project's page in the Braintrust app.
 * @property datasetUrl URL to the experiment's page in the Braintrust app.
 * @property dataSummary Summary of the dataset's data.
 */
export interface DatasetSummary {
  projectName: string;
  datasetName: string;
  projectUrl: string;
  datasetUrl: string;
  dataSummary: DataSummary;
}
