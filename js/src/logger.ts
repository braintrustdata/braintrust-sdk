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
 * See `Span.startSpan` for full details.
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

  /**
   * Serializes the span as a token which can be passed around to other processes, across the network, etc. To start a span under a serialized span, call `braintrust.startSpanUnderSerialized` (see docs for more details).
   */
  serialize(): string;

  /**
   * Flush any pending logs to the server.
   */
  flush(): Promise<void>;

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

  public serialize(): string {
    return "";
  }

  public async flush(): Promise<void> {}
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
  public currentLogger: Logger | undefined;
  public currentSpan: IsoAsyncLocalStorage<Span>;

  public apiUrl: string | null;
  public loginToken: string | null;
  public orgId: string | null;
  public orgName: string | null;
  public logUrl: string | null;
  public loggedIn: boolean;

  private _apiConn: HTTPConnection | null;
  private _logConn: HTTPConnection | null;

  constructor() {
    this.id = uuidv4(); // This is for debugging
    this.currentExperiment = undefined;
    this.currentLogger = undefined;
    this.currentSpan = iso.newAsyncLocalStorage();

    this.apiUrl = null;
    this.loginToken = null;
    this.orgId = null;
    this.orgName = null;
    this.logUrl = null;
    this.loggedIn = false;

    this._apiConn = null;
    this._logConn = null;

    globalThis.__inherited_braintrust_state = this;
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

interface RegisteredProject {
  id: string;
  name: string;
}

class Project {
  name?: string;
  id?: string;

  constructor({ name, id }: { name?: string; id?: string }) {
    this.name = name;
    this.id = id;
  }

  async lazyInit(): Promise<RegisteredProject> {
    if (this.id === undefined) {
      const response = await _state
        .apiConn()
        .post_json("api/project/register", {
          project_name: this.name || GLOBAL_PROJECT,
          org_id: _state.orgId,
        });
      this.id = response.project.id;
      this.name = response.project.name;
    } else if (this.name === undefined) {
      const response = await _state.apiConn().get_json("api/project", {
        id: this.id,
      });
      this.name = response.name;
    }

    return { id: this.id!, name: this.name! };
  }
}

export interface LogOptions {
  asyncFlush?: boolean;
}

export class Logger {
  private _lazyLogin: () => Promise<void>;
  private loggedIn: boolean = false;
  private lazyProject: Project;
  private logOptions: LogOptions;
  private bgLogger: BackgroundLogger | undefined;
  private lastStartTime: number;

  // For type identification.
  public kind: "logger" = "logger";

  constructor(
    lazyLogin: () => Promise<void>,
    lazyProject: Project,
    logOptions: LogOptions = {}
  ) {
    this._lazyLogin = lazyLogin;
    this.lazyProject = lazyProject;
    this.logOptions = logOptions;
    this.lastStartTime = getCurrentUnixTimestamp();
  }

  private async lazyLogin() {
    if (!this.loggedIn) {
      await this._lazyLogin();
      this.lastStartTime = getCurrentUnixTimestamp();
      this.bgLogger = new BackgroundLogger({ logConn: _state.logConn() });
      this.loggedIn = true;
    }
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
  public async log(event: Readonly<StartSpanEventArgs>): Promise<string> {
    // Do the lazy login before retrieving the last_start_time.
    await this.lazyLogin();
    const span = await this.startSpan({ startTime: this.lastStartTime, event });
    this.lastStartTime = span.end();

    if (!this.logOptions.asyncFlush) {
      await this.flush();
    }

    return span.id;
  }

  /**
   * Create a new toplevel span underneath the logger. The name defaults to "root".
   *
   * See `Span.traced` for full details.
   */
  public async traced<R>(
    callback: (span: Span) => R,
    args?: StartSpanArgs & SetCurrentArg
  ): Promise<Awaited<R>> {
    const { setCurrent, ...argsRest } = args ?? {};
    const span = await this.startSpan(argsRest);
    try {
      return await (setCurrent ?? true
        ? withCurrent(span, () => callback(span))
        : callback(span));
    } finally {
      span.end();
      if (!this.logOptions.asyncFlush) {
        await this.flush();
      }
    }
  }

  /**
   * Lower-level alternative to `traced`, which does not automatically end the span or mark it as current.
   *
   * See `traced` for full details.
   */
  public async startSpan(args?: StartSpanArgs): Promise<Span> {
    await this.lazyLogin();
    const project = await this.lazyProject.lazyInit();
    const { name, ...argsRest } = args ?? {};
    return new SpanImpl({
      bgLogger: this.bgLogger!,
      name: name ?? "root",
      ...argsRest,
      rootProject: project,
    });
  }

  /**
   * Serializes the logger as a token which can be passed around to other processes, across the network, etc. To start a span under a serialized Logger, call `braintrust.startSpanUnderSerialized` (see docs for more details).
   */
  public async serialize(): Promise<string> {
    const project = await this.lazyProject.lazyInit();
    return SerializedSpanInfoToString({
      object_kind: "pl",
      org_id: _state.orgId!,
      project_id: project.id,
      log_id: "g",
      parent_span_kind: "none",
    });
  }

  /*
   * Flush any pending logs to the server.
   */
  async flush(): Promise<void> {
    await this.lazyLogin();
    return await this.bgLogger!.flush();
  }
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
  private logConn: HTTPConnection;
  private items: BackgroundLogEvent[] = [];
  private active_flush: Promise<string[]> = Promise.resolve([]);
  private active_flush_resolved = true;

  constructor({
    logConn,
    flushOnExit,
  }: {
    logConn: HTTPConnection;
    flushOnExit?: boolean;
  }) {
    this.logConn = logConn;

    // Note that this will not run for explicit termination events, such as
    // calls to `process.exit()` or uncaught exceptions. Thus it is a
    // "best-effort" flush.
    if (flushOnExit ?? true) {
      iso.processOn("beforeExit", async () => {
        await this.flush();
      });
    }
  }

  log(items: BackgroundLogEvent[]) {
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
    const allItems = mergeRowBatch(this.items || []).reverse();
    this.items = [];

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
              return (await this.logConn.post_json("logs", itemsS)).map(
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
 * @returns The newly created Experiment.
 */
export async function init(
  project: string,
  options: Readonly<InitOptions> = {}
): Promise<Experiment> {
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

  await login({
    orgName: orgName,
    apiKey,
    apiUrl,
  });

  const ret = await _initExperiment(project, {
    experimentName: experiment,
    description,
    dataset,
    update,
    baseExperiment,
    isPublic,
    metadata,
  });
  _state.currentExperiment = ret;
  return ret;
}

/**
 * This function is deprecated. Use `init` instead.
 */
export async function withExperiment<R>(
  project: string,
  callback: (experiment: Experiment) => R,
  options: Readonly<InitOptions & SetCurrentArg> = {}
): Promise<R> {
  console.warn(
    "withExperiment is deprecated and will be removed in a future version of braintrust. Simply create the experiment with `init`."
  );
  const experiment = await init(project, options);
  return callback(experiment);
}

/**
 * This function is deprecated. Use `initLogger` instead.
 */
export async function withLogger<R>(
  callback: (logger: Logger) => R,
  options: Readonly<InitLoggerOptions & SetCurrentArg> = {}
): Promise<R> {
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
export async function initDataset(
  project: string,
  options: Readonly<InitDatasetOptions> = {}
) {
  const { dataset, description, version, apiUrl, apiKey, orgName } =
    options || {};

  await login({
    orgName: orgName,
    apiKey,
    apiUrl,
  });

  return await _initDataset(project, {
    name: dataset,
    description,
    version,
  });
}

/**
 * This function is deprecated. Use `initDataset` instead.
 */
export async function withDataset<R>(
  project: string,
  callback: (dataset: Dataset) => R,
  options: Readonly<InitDatasetOptions> = {}
): Promise<R> {
  console.warn(
    "withDataset is deprecated and will be removed in a future version of braintrust. Simply create the dataset with `initDataset`."
  );
  const dataset = await initDataset(project, options);
  return callback(dataset);
}

type InitLoggerOptions = {
  projectName?: string;
  projectId?: string;
  asyncFlush?: boolean;
  apiUrl?: string;
  apiKey?: string;
  orgName?: string;
};

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
 * @returns The newly created Logger.
 */
export function initLogger(options: Readonly<InitLoggerOptions> = {}) {
  const { projectName, projectId, asyncFlush, apiUrl, apiKey, orgName } =
    options || {};

  const lazyLogin = async () => {
    await login({
      orgName: orgName,
      apiKey,
      apiUrl,
    });
  };

  const ret = new Logger(
    lazyLogin,
    new Project({
      name: projectName,
      id: projectId,
    }),
    {
      asyncFlush,
    }
  );
  _state.currentLogger = ret;
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

  // If any provided login inputs disagree with our existing settings, force
  // login.
  if (
    apiUrl != _state.apiUrl ||
    (apiKey !== undefined &&
      HTTPConnection.sanitize_token(apiKey) != _state.loginToken) ||
    (orgName !== undefined && orgName != _state.orgName)
  ) {
    forceLogin = true;
  }

  if (_state.loggedIn && !forceLogin) {
    return;
  }

  _state = new BraintrustState();

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

/**
 * Returns the currently-active experiment (set by `braintrust.init`). Returns undefined if no current experiment has been set.
 */
export function currentExperiment(): Experiment | undefined {
  return _state.currentExperiment;
}

/**
 * Returns the currently-active logger (set by `braintrust.initLogger`). Returns undefined if no current logger has been set.
 */
export function currentLogger(): Logger | undefined {
  return _state.currentLogger;
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
export function getSpanParentObject(): Span | Experiment {
  const parentSpan = currentSpan();
  if (!Object.is(parentSpan, NOOP_SPAN)) {
    return parentSpan;
  }
  const experiment = currentExperiment();
  if (experiment) {
    return experiment;
  }
  const logger = currentLogger();
  if (logger) {
    throw new Error(
      "Cannot start a span within a logger from startSpan(). Use logger.startSpan() instead."
    );
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
export async function traced<R>(
  callback: (span: Span) => R,
  args?: StartSpanArgs & SetCurrentArg
): Promise<Awaited<R>> {
  const span = await startSpan(args);
  try {
    if (args?.setCurrent ?? true) {
      return await withCurrent(span, () => callback(span));
    } else {
      return await callback(span);
    }
  } finally {
    span.end();
  }
}

/**
 * Lower-level alternative to `traced`, which does not automatically end the span or mark it as current. See `traced` for full details.
 */
export async function startSpan(args?: StartSpanArgs): Promise<Span> {
  const parentObject = getSpanParentObject();
  const { name: nameOpt, ...argsRest } = args ?? {};
  const name = parentObject.kind === "span" ? nameOpt : nameOpt ?? "root";
  return parentObject.startSpan({ name, ...argsRest });
}

export type CustomLoggerOpts = {
  logUrl?: string;
  logToken?: string;
  flushOnExit?: boolean;
};

/**
 * Start a span under the serialized object from `*.serialize`. See `Span.startSpan` for full details.
 *
 * @param objectToken The serialized token from `*.serialize`.
 * @param args.logger_opts Optional (mainly for internal use). Control specific properties of the span's logger. If not specified, uses the global connection.
 * @returns The newly-created Span.
 */
export function startSpanUnderSerialized(
  objectToken: string,
  args?: StartSpanArgs & CustomLoggerOpts
): Span {
  if (objectToken === "") {
    return NOOP_SPAN;
  }
  const spanInfo = SerializedSpanInfoFromString(objectToken);
  const {
    logUrl,
    logToken,
    flushOnExit,
    name: nameOpt,
    ...argsRest
  } = args ?? {};
  const logConn = (() => {
    if (!logUrl || !logToken) {
      return _state.logConn();
    } else {
      const logConn = new HTTPConnection(logUrl);
      logConn.set_token(logToken);
      return logConn;
    }
  })();
  const name =
    spanInfo.parent_span_kind === "none" ? nameOpt ?? "root" : nameOpt;
  return new SpanImpl({
    bgLogger: new BackgroundLogger({ logConn, flushOnExit: args?.flushOnExit }),
    name,
    ...argsRest,
    serializedParent: spanInfo,
  });
}

// Set the given span as current within the given callback and any asynchronous
// operations created within the callback.
function withCurrent<R>(span: Span, callback: () => R): R {
  return _state.currentSpan.run(span, callback);
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

async function _initExperiment(
  projectName: string,
  {
    experimentName,
    description,
    dataset,
    update,
    baseExperiment,
    isPublic,
    metadata,
  }: {
    experimentName?: string;
    description?: string;
    dataset?: Dataset;
    update?: boolean;
    baseExperiment?: string;
    isPublic?: boolean;
    metadata?: Metadata;
  } = {
    experimentName: undefined,
    description: undefined,
    baseExperiment: undefined,
    isPublic: false,
    metadata: undefined,
  }
) {
  const args: Record<string, unknown> = {
    project_name: projectName,
    org_id: _state.orgId,
  };

  if (experimentName) {
    args["experiment_name"] = experimentName;
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

  const project = response.project;
  const experiment = response.experiment;

  return new Experiment(project, experiment.id, experiment.name, dataset);
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
  public readonly project: RegisteredProject;
  public readonly id: string;
  public readonly name: string;
  public readonly dataset?: Dataset;
  private bgLogger: BackgroundLogger;
  private lastStartTime: number;
  // For type identification.
  public kind: "experiment" = "experiment";

  constructor(
    project: RegisteredProject,
    id: string,
    name: string,
    dataset?: Dataset
  ) {
    this.project = project;
    this.id = id;
    this.name = name;
    this.dataset = dataset;
    this.bgLogger = new BackgroundLogger({ logConn: _state.logConn() });
    this.lastStartTime = getCurrentUnixTimestamp();
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
          return withCurrent(span, () => callback(span));
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
    return new SpanImpl({
      bgLogger: this.bgLogger,
      name: name ?? "root",
      ...argsRest,
      rootExperiment: this,
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
    const projectUrl = `${_state.apiUrl}/app/${encodeURIComponent(
      _state.orgName!
    )}/p/${encodeURIComponent(this.project.name)}`;
    const experimentUrl = `${projectUrl}/${encodeURIComponent(this.name)}`;

    let scores: Record<string, ScoreSummary> | undefined = undefined;
    let metrics: Record<string, MetricSummary> | undefined = undefined;
    let comparisonExperimentName = undefined;
    if (summarizeScores) {
      if (comparisonExperimentId === undefined) {
        const conn = _state.logConn();
        const resp = await conn.get("/crud/base_experiments", {
          id: this.id,
        });
        const base_experiments = await resp.json();
        if (base_experiments.length > 0) {
          comparisonExperimentId = base_experiments[0]["base_exp_id"];
          comparisonExperimentName = base_experiments[0]["base_exp_name"];
        }
      }

      if (comparisonExperimentId !== undefined) {
        const results = await _state.logConn().get_json(
          "/experiment-comparison2",
          {
            experiment_id: this.id,
            base_experiment_id: comparisonExperimentId,
          },
          3
        );

        scores = results["scores"];
        metrics = results["metrics"];
      }
    }

    return {
      projectName: this.project.name,
      experimentName: this.name,
      projectUrl: projectUrl,
      experimentUrl: experimentUrl,
      comparisonExperimentName: comparisonExperimentName,
      scores,
      metrics,
    };
  }

  /**
   * Serializes the experiment as a token which can be passed around to other processes, across the network, etc. To start a span under a serialized experiment, call `braintrust.startSpanUnderSerialized` (see docs for more details).
   */
  public serialize(): string {
    return SerializedSpanInfoToString({
      object_kind: "e",
      project_id: this.project.id,
      experiment_id: this.id,
      parent_span_kind: "none",
    });
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

// Format and utils for serializing objects to create spans later. Keep this in
// sync with the span serialization implementation in logger.py.
type SpanObjectIds =
  | { object_kind: "e"; project_id: string; experiment_id: string }
  | { object_kind: "pl"; org_id: string; project_id: string; log_id: "g" };

type SpanParentSpanIds =
  | { parent_span_kind: "sub_span"; span_id: string; root_span_id: string }
  | { parent_span_kind: "root_span"; span_id: string; root_span_id?: undefined }
  | { parent_span_kind: "none"; span_id?: undefined; root_span_id?: undefined };

type SerializedSpanInfo = SpanObjectIds & SpanParentSpanIds;

function SerializedSpanInfoToString(info: SerializedSpanInfo): string {
  const objectIds = (() => {
    if (info.object_kind === "e") {
      return [info.project_id, info.experiment_id];
    } else if (info.object_kind === "pl") {
      return [info.org_id, info.project_id];
    } else {
      throw new Error(`Unknown kind ${(info as any).object_kind}`);
    }
  })();
  const spanParentIds = (() => {
    if (info.parent_span_kind === "sub_span") {
      return [info.span_id, info.root_span_id];
    } else if (info.parent_span_kind === "root_span") {
      return [info.span_id, ""];
    } else if (info.parent_span_kind === "none") {
      return ["", ""];
    } else {
      throw new Error(
        `Unknown parent_span_kind ${(info as any).parent_span_kind}`
      );
    }
  })();
  const ids = [info.object_kind, ...objectIds, ...spanParentIds];
  // Since all of these IDs are auto-generated as UUIDs, we can expect them to
  // not contain any colons.
  for (const id of ids) {
    if (id.includes(":")) {
      throw new Error(`Unexpected: id ${id} should not have a ':'`);
    }
  }
  return ids.join(":");
}

function SerializedSpanInfoFromString(s: string): SerializedSpanInfo {
  const ids = s.split(":");
  if (ids.length !== 5) {
    throw new Error(
      `Expected serialized info ${s} to have 5 colon-separated components`
    );
  }

  const objectIds = (() => {
    if (ids[0] === "e") {
      return {
        object_kind: ids[0],
        project_id: ids[1],
        experiment_id: ids[2],
      } as const;
    } else if (ids[0] === "pl") {
      return {
        object_kind: ids[0],
        org_id: ids[1],
        project_id: ids[2],
        log_id: "g",
      } as const;
    } else {
      throw new Error(`Unknown serialized object_kind ${ids[0]}`);
    }
  })();

  const spanParentIds = (() => {
    if (ids[4] === "") {
      if (ids[3] === "") {
        return { parent_span_kind: "none" } as const;
      } else {
        return { parent_span_kind: "root_span", span_id: ids[3] } as const;
      }
    } else {
      return {
        parent_span_kind: "sub_span",
        span_id: ids[3],
        root_span_id: ids[4],
      } as const;
    }
  })();
  return {
    ...objectIds,
    ...spanParentIds,
  };
}

/**
 * Primary implementation of the `Span` interface. See the `Span` interface for full details on each method.
 *
 * We suggest using one of the various `traced` methods, instead of creating Spans directly. See `Span.startSpan` for full details.
 */
export class SpanImpl implements Span {
  private bgLogger: BackgroundLogger;
  // `internalData` contains fields that are not part of the "user-sanitized"
  // set of fields which we want to log in just one of the span rows. It is
  // cleared after every log.
  private internalData: Partial<ExperimentEvent>;
  private isMerge: boolean;
  private loggedEndTime: number | undefined;

  // `_span_ids` and `_object_ids` contain fields that are logged to every span
  // row.
  private readonly _span_ids: {
    id: string;
    span_id: string;
    root_span_id: string;
  };
  private readonly _object_ids: SpanObjectIds;

  public kind: "span" = "span";

  constructor(
    args: { bgLogger: BackgroundLogger } & StartSpanArgs &
      (
        | { rootExperiment: Experiment }
        | { rootProject: RegisteredProject }
        | { parentSpan: SpanImpl }
        | { serializedParent: SerializedSpanInfo }
      )
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

    const id = args.event?.id ?? uuidv4();
    const span_id = uuidv4();
    if ("rootExperiment" in args) {
      this._span_ids = {
        id,
        span_id,
        root_span_id: span_id,
      };
      this._object_ids = {
        object_kind: "e",
        project_id: args.rootExperiment.project.id,
        experiment_id: args.rootExperiment.id,
      };
    } else if ("rootProject" in args) {
      this._span_ids = {
        id,
        span_id,
        root_span_id: span_id,
      };
      this._object_ids = {
        object_kind: "pl",
        org_id: _state.orgId!,
        project_id: args.rootProject.id,
        log_id: "g",
      };
    } else if ("parentSpan" in args) {
      this._span_ids = {
        id,
        span_id,
        root_span_id: args.parentSpan.root_span_id,
      };
      this._object_ids = args.parentSpan._object_ids;
      this.internalData.span_parents = [args.parentSpan.span_id];
    } else if ("serializedParent" in args) {
      const {
        parent_span_kind,
        span_id: parentSpanId,
        root_span_id: rootSpanRaw,
        ...objectIds
      } = args.serializedParent;
      const root_span_id = (() => {
        if (parent_span_kind === "sub_span") {
          return rootSpanRaw;
        } else if (parent_span_kind === "root_span") {
          return parentSpanId;
        } else if (parent_span_kind === "none") {
          return span_id;
        } else {
          throw new Error(`Invalid parent_span_kind ${parent_span_kind}`);
        }
      })();
      this._span_ids = { id, span_id, root_span_id };
      this._object_ids = objectIds;
      if (parentSpanId) {
        this.internalData.span_parents = [parentSpanId];
      }
    } else {
      throw new Error("Must provide parent info");
    }

    // The first log is a replacement, but subsequent logs to the same span
    // object will be merges.
    this.isMerge = false;
    const { id: _id, ...eventRest } = args.event ?? {};
    this.log(eventRest);
    this.isMerge = true;
  }

  public get id(): string {
    return this._span_ids.id;
  }

  public get span_id(): string {
    return this._span_ids.span_id;
  }

  public get root_span_id(): string {
    return this._span_ids.root_span_id;
  }

  public log(event: ExperimentLogPartialArgs): void {
    const sanitized = validateAndSanitizeExperimentLogPartialArgs(event);
    // There should be no overlap between the dictionaries being merged,
    // except for `sanitized` and `internalData`, where the former overrides
    // the latter.
    const sanitizedAndInternalData = { ...this.internalData };
    mergeDicts(sanitizedAndInternalData, sanitized);
    const { object_kind: _object_kind, ...object_ids } = this._object_ids;
    const record = {
      ...sanitizedAndInternalData,
      ...this._span_ids,
      ...object_ids,
      [IS_MERGE_FIELD]: this.isMerge,
    };
    if (record.metrics?.end) {
      this.loggedEndTime = record.metrics?.end as number;
    }
    this.internalData = {};
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
          return withCurrent(span, () => callback(span));
        } else {
          return callback(span);
        }
      },
      () => span.end()
    );
  }

  public startSpan(args?: StartSpanArgs): Span {
    return new SpanImpl({
      bgLogger: this.bgLogger,
      ...args,
      parentSpan: this,
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

  public serialize(): string {
    const parentSpanInfo =
      this.span_id === this.root_span_id
        ? ({ parent_span_kind: "root_span", span_id: this.span_id } as const)
        : ({
            parent_span_kind: "sub_span",
            span_id: this.span_id,
            root_span_id: this.root_span_id,
          } as const);
    return SerializedSpanInfoToString({
      ...this._object_ids,
      ...parentSpanInfo,
    });
  }

  public async flush(): Promise<void> {
    await this.bgLogger.flush();
  }
}

async function _initDataset(
  project_name: string,
  {
    name,
    description,
    version,
  }: {
    name?: string;
    description?: string;
    version?: string;
  } = {}
) {
  const args: Record<string, unknown> = {
    org_id: _state.orgId,
    project_name,
    dataset_name: name,
    description,
  };
  const response = await _state
    .apiConn()
    .post_json("api/dataset/register", args);

  const project = response.project;
  const dataset = response.dataset;

  return new Dataset(project, dataset.id, dataset.name, version);
}

/**
 * A dataset is a collection of records, such as model inputs and outputs, which represent
 * data you can use to evaluate and fine-tune models. You can log production data to datasets,
 * curate them with interesting examples, edit/delete records, and run evaluations against them.
 *
 * You should not create `Dataset` objects directly. Instead, use the `braintrust.initDataset()` method.
 */
export class Dataset {
  public readonly project: RegisteredProject;
  public readonly id: string;
  public readonly name: string;
  private pinnedVersion?: string;
  private _fetchedData?: any[] = undefined;
  private bgLogger: BackgroundLogger;

  constructor(
    project: RegisteredProject,
    id: string,
    name: string,
    pinnedVersion?: string
  ) {
    this.project = project;
    this.id = id;
    this.name = name;
    this.pinnedVersion = pinnedVersion;
    this.bgLogger = new BackgroundLogger({ logConn: _state.logConn() });
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

    const args = {
      id: id || uuidv4(),
      inputs: input,
      output,
      project_id: this.project.id,
      dataset_id: this.id,
      created: new Date().toISOString(),
      metadata,
    };

    this.bgLogger.log([args]);
    return args.id;
  }

  public delete(id: string): string {
    const args = {
      id,
      project_id: this.project.id,
      dataset_id: this.id,
      created: new Date().toISOString(),
      _object_delete: true,
    };

    this.bgLogger.log([args]);
    return args.id;
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
    const projectUrl = `${_state.apiUrl}/app/${encodeURIComponent(
      _state.orgName!
    )}/p/${encodeURIComponent(this.project.name)}`;
    const datasetUrl = `${projectUrl}/d/${encodeURIComponent(this.name)}`;

    let dataSummary = undefined;
    if (summarizeData) {
      dataSummary = await _state.logConn().get_json(
        "dataset-summary",
        {
          dataset_id: this.id,
        },
        3
      );
    }

    return {
      projectName: this.project.name,
      datasetName: this.name,
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
      const resp = await _state.logConn().get("object/dataset", {
        id: this.id,
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
