import axios, { AxiosInstance } from "axios";
import { v4 as uuidv4 } from "uuid";

import iso, { IsoAsyncLocalStorage, CallerLocation } from "./isomorph";
import { runFinally } from "./util";
import { configureNode } from "./node";

export type SetCurrentArg = { setCurrent?: boolean };

export type StartSpanArgs = {
  name: string;
  spanAttributes?: Record<any, any>;
  startTime?: number;
  event?: ExperimentLogPartialArgs & Partial<IdField>;
};

export type StartSpanOptionalNameArgs = Omit<StartSpanArgs, "name"> &
  Partial<Pick<StartSpanArgs, "name">>;

/**
 * A Span encapsulates logged data and metrics for a unit of work. This interface is shared by all span implementations.
 *
 * We suggest using one of the various `startSpan` methods, instead of creating Spans directly. See `Span.startSpan` for full details.
 */
export interface Span {
  // Row ID of the span.
  id: string;

  // Span ID of the span. This is used to link spans together.
  span_id: string;

  // Span ID of the root span in the full trace.
  root_span_id: string;

  /**
   * Incrementally update the current span with new data. The event will be batched and uploaded behind the scenes.
   *
   * @param event: Data to be logged. See `Experiment.log` for full details.
   */
  log(event: ExperimentLogPartialArgs): void;

  /**
   * Create a new span. This is useful if you want to log more detailed trace information beyond the scope of a single log event. Data logged over several calls to `Span.log` will be merged into one logical row.
   *
   * We recommend running spans within a callback (using `startSpanWithinCallback`) to automatically mark them as current and ensure they are terminated. If you wish to start a span outside a callback, be sure to terminate it with `span.end()`.
   *
   * @param args.name The name of the span.
   * @param args.span_attributes Optional additional attributes to attach to the span, such as a type name.
   * @param args.start_time Optional start time of the span, as a timestamp in seconds.
   * @param args.event Data to be logged. See `Experiment.log` for full details.
   * @returns The newly-created `Span`
   */
  startSpan(args: StartSpanArgs): Span;

  /**
   * Wrapper over `Span.startSpan`, which passes the initialized `Span` it to the given callback and ends it afterwards. See `Span.startSpan` for full details.
   *
   * @param args.setCurrent If true (the default), the span will be marked as the currently-active span for the duration of the callback. Equivalent to calling `braintrust.withCurrent(span, callback)`.
   */
  startSpanWithCallback<R>(
    args: StartSpanArgs & SetCurrentArg,
    callback: (span: Span) => R
  ): R;

  /**
   * Terminate the span. Returns the end time logged to the row's metrics. After calling end, you may not invoke any further methods on the span object, except for the property accessors.
   *
   * Will be invoked automatically if the span is constructed with startSpanWithCallback.
   *
   * @param args.endTime Optional end time of the span, as a timestamp in seconds.
   * @returns The end time logged to the span metrics.
   */
  end(args?: { endTime?: number }): number;

  /**
   * Alias for `end`.
   */
  close(args?: { endTime?: number }): number;
}

/**
 * A fake implementation of the Span API which does nothing. This can be used as the default span.
 */
export class NoopSpan implements Span {
  public id: string;
  public span_id: string;
  public root_span_id: string;

  constructor() {
    this.id = "";
    this.span_id = "";
    this.root_span_id = "";
  }

  public log(_: ExperimentLogPartialArgs) {}

  public startSpan(_: StartSpanArgs) {
    return this;
  }

  public startSpanWithCallback<R>(
    _: StartSpanArgs & SetCurrentArg,
    callback: (span: Span) => R
  ): R {
    return callback(this);
  }

  public end(args?: { endTime?: number }): number {
    return args?.endTime ?? getCurrentUnixTimestamp();
  }

  public close(args?: { endTime?: number }): number {
    return this.end(args);
  }
}

const noopSpan = new NoopSpan();

class BraintrustState {
  public currentExperiment: IsoAsyncLocalStorage<Experiment | undefined>;
  public currentSpan: IsoAsyncLocalStorage<Span>;
  public id: string;

  constructor() {
    this.id = uuidv4(); // This is for debugging
    this.currentExperiment = iso.newAsyncLocalStorage();
    this.currentSpan = iso.newAsyncLocalStorage();
  }
}

declare global {
  var __inherited_state: BraintrustState;
}

let _state = globalThis.__inherited_state || new BraintrustState();

export const _internalGetGlobalState = () => _state;
export function _internalSetGlobalState(state: BraintrustState) {
  _state = state;
}

// A utility to keep track of objects that should be cleaned up before
// program exit. At the end of the program, the UnterminatedObjectsHandler
// will print out all un-terminated objects as a warning.
class UnterminatedObjectsHandler {
  private unterminatedObjects: Map<any, CallerLocation | undefined>;

  constructor() {
    this.unterminatedObjects = new Map();
    process.on("exit", () => {
      this.warnUnterminated();
    });
  }

  addUnterminated(obj: any, createdLocation: CallerLocation | undefined) {
    this.unterminatedObjects.set(obj, createdLocation);
  }

  removeUnterminated(obj: any) {
    this.unterminatedObjects.delete(obj);
  }

  private warnUnterminated() {
    if (this.unterminatedObjects.size === 0) {
      return;
    }
    let warningMessage =
      "WARNING: Did not close the following braintrust objects. We recommend running `.close` on the listed objects, or by running them inside a callback so they are closed automatically:";
    this.unterminatedObjects.forEach((createdLocation, obj) => {
      let msg = `\n\tObject of type ${typeof obj}`;
      if (createdLocation) {
        msg += ` created at ${JSON.stringify(createdLocation)}`;
      }
      warningMessage += msg;
    });
    console.warn(warningMessage);
  }
}

let unterminatedObjects = new UnterminatedObjectsHandler();

let API_URL: string | null = null;
let LOGIN_TOKEN: string | null = null;
let ORG_ID: string | null = null;
let ORG_NAME: string | null = null;
let LOG_URL: string | null = null;
let LOGGED_IN = false;

const TRANSACTION_ID_FIELD = "_xact_id";

class HTTPConnection {
  base_url: string;
  token: string | null;
  session: AxiosInstance | null;

  constructor(base_url: string) {
    this.base_url = base_url;
    this.token = null;
    this.session = null;

    this._reset();
  }

  async ping() {
    try {
      const resp = await this.get("ping");
      if (_var_user_info === null) {
        _var_user_info = resp.data;
      }
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
    let headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    this.session = iso.makeAxios({ headers });
  }

  async get(path: string, params: unknown | undefined = undefined) {
    return await this.session!.get(_urljoin(this.base_url, path), { params });
  }

  async post(
    path: string,
    params: unknown | undefined = undefined,
    config: any = undefined
  ) {
    return await this.session!.post(
      _urljoin(this.base_url, path),
      params,
      config
    );
  }

  async get_json(
    object_type: string,
    args: unknown | undefined = undefined,
    retries: number = 0
  ) {
    const tries = retries + 1;
    for (let i = 0; i < tries; i++) {
      try {
        const resp = await this.get(`${object_type}`, args);
        return resp.data;
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

  async post_json(object_type: string, args: unknown | undefined = undefined) {
    const resp = await this.post(`${object_type}`, args, {
      // https://masteringjs.io/tutorials/axios/post-json
      headers: { "Content-Type": "application/json" },
    });
    return resp.data;
  }
}

let _api_conn: HTTPConnection | null = null;
function api_conn() {
  if (!_api_conn) {
    _api_conn = new HTTPConnection(API_URL!);
  }
  return _api_conn;
}

let _log_conn: HTTPConnection | null = null;
function log_conn() {
  if (!_log_conn) {
    _log_conn = new HTTPConnection(LOG_URL!);
  }
  return _log_conn;
}

interface UserInfo {
  id: string;
}
let _var_user_info: UserInfo | null = null;
async function _user_info(): Promise<UserInfo> {
  if (_var_user_info === null) {
    _var_user_info = await log_conn().get_json("ping");
  }
  return _var_user_info!;
}

function clear_cached_globals() {
  _api_conn = null;
  _log_conn = null;
  _var_user_info = null;
  _state = new BraintrustState();
}

export class Project {
  name: string;
  id: string;
  org_id: string;

  constructor(name: string, id: string, org_id: string) {
    this.name = name;
    this.id = id;
    this.org_id = org_id;
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
    _is_merge: boolean;
  } & Partial<{
    user_id: string;
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
  user_id: string;
  created: string;
}

type LogEvent = ExperimentEvent | DatasetEvent;

export interface DatasetRecord {
  id: string;
  input: any;
  output: any;
  metadata: any;
}

// 10 MB (https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html)
const MaxRequestSize = 10 * 1024 * 1024;

function constructJsonArray(items: string[]) {
  return `[${items.join(",")}]`;
}

class LogThread {
  private items: LogEvent[] = [];
  private active_flush: Promise<string[]> = Promise.resolve([]);
  private active_flush_resolved = true;

  log(items: LogEvent[]) {
    this.items.push(...items);

    if (this.active_flush_resolved) {
      this.active_flush_resolved = false;
      this.active_flush = this.flush_once();
    }
  }

  async flush_once(batchSize: number = 100): Promise<string[]> {
    this.active_flush_resolved = false;

    const initialItems = (this.items || []).reverse();
    this.items = [];

    let ret = [];
    while (true) {
      const items = [];
      let itemsLen = 0;
      while (items.length < batchSize && itemsLen < MaxRequestSize / 2) {
        let item = null;
        if (initialItems.length > 0) {
          item = initialItems.pop();
        } else {
          break;
        }

        const itemS = JSON.stringify(item);
        items.push(itemS);
        itemsLen += itemS.length;
      }

      if (items.length > 0) {
        const resp = await log_conn().post_json(
          "logs",
          constructJsonArray(items)
        );
        ret = resp.data;
      } else {
        break;
      }
    }

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
  disableCache?: boolean;
};

/**
 * Log in, and then initialize a new experiment in a specified project. If the project does not exist, it will be created.
 *
 * Remember to close your experiment when it is finished by calling `Experiment.close`. We recommend initializing the experiment within a callback (using `braintrust.initWithCallback`) to automatically mark it as active and ensure it is terminated.
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
 * @param options.disableCache Do not use cached login information.
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
    disableCache,
  } = options || {};

  await login({
    orgName: orgName,
    disableCache,
    apiKey,
    apiUrl,
  });

  return await _initExperiment(project, {
    experimentName: experiment,
    description,
    dataset,
    update,
    baseExperiment,
    isPublic,
  });
}

/**
 * Wrapper over `braintrust.init`, which passes the initialized `Experiment` it to the given callback and closes it afterwards. See `braintrust.init` for full details.
 *
 * @param options.setCurrent If true (default), set the currently-active experiment to the newly-created one. Equivalent to calling `braintrust.withCurrent(experiment, callback)`.
 */
export async function initWithCallback<R>(
  project: string,
  options: Readonly<InitOptions & SetCurrentArg> = {},
  callback: (experiment: Experiment) => R
): Promise<R> {
  const experiment = await init(project, options);
  return runFinally(
    () => {
      if (options.setCurrent ?? true) {
        return withCurrent(experiment, () => callback(experiment));
      } else {
        return callback(experiment);
      }
    },
    () => experiment.close()
  );
}

type InitDatasetOptions = {
  dataset?: string;
  description?: string;
  version?: string;
  apiUrl?: string;
  apiKey?: string;
  orgName?: string;
  disableCache?: boolean;
};

/**
 * Create a new dataset in a specified project. If the project does not exist, it will be created.
 *
 * Remember to close your dataset when it is finished by calling `Dataset.close`. We recommend initializing the dataset within a callback (using `braintrust.initDatasetWithCallback`) to ensure it is terminated.
 *
 * @param project The name of the project to create the dataset in.
 * @param options Additional options for configuring init().
 * @param options.dataset The name of the dataset to create. If not specified, a name will be generated automatically.
 * @param options.description An optional description of the dataset.
 * @param options.apiUrl The URL of the Braintrust API. Defaults to https://www.braintrustdata.com.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
 * key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @param options.disableCache Do not use cached login information.
 * @returns The newly created Dataset.
 */
export async function initDataset(
  project: string,
  options: Readonly<InitDatasetOptions> = {}
) {
  const {
    dataset,
    description,
    version,
    apiUrl,
    apiKey,
    orgName,
    disableCache,
  } = options || {};

  await login({
    orgName: orgName,
    disableCache,
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
 * Wrapper over `braintrust.initDataset`, which passes the initialized `Dataset` it to the given callback and closes it afterwards. See `braintrust.initDataset` for full details.
 */
export async function initDatasetWithCallback<R>(
  project: string,
  options: Readonly<InitDatasetOptions> = {},
  callback: (dataset: Dataset) => R
): Promise<R> {
  const dataset = await initDataset(project, options);
  return runFinally(
    () => callback(dataset),
    () => dataset.close()
  );
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
 * @param options.disableCache Do not use cached login information.
 * @param options.forceLogin Login again, even if you have already logged in (by default, this function will exit quickly if you have already logged in)
 */
export async function login(
  options: {
    apiUrl?: string;
    apiKey?: string;
    orgName?: string;
    disableCache?: boolean;
    forceLogin?: boolean;
  } = {}
) {
  const {
    apiUrl = iso.getEnv("BRAINTRUST_API_URL") ||
      "https://www.braintrustdata.com",
    apiKey = iso.getEnv("BRAINTRUST_API_KEY"),
    orgName: orgName = undefined,
    disableCache = false,
  } = options || {};

  let { forceLogin = false } = options || {};

  // If any provided login inputs disagree with our existing settings, force
  // login.
  if (
    apiUrl != API_URL ||
    (apiKey !== undefined &&
      HTTPConnection.sanitize_token(apiKey) != LOGIN_TOKEN) ||
    (orgName !== undefined && orgName != ORG_NAME)
  ) {
    forceLogin = true;
  }

  if (LOGGED_IN && !forceLogin) {
    return;
  }

  clear_cached_globals();

  API_URL = apiUrl;

  let login_key_info: any = null;
  let ping_ok = false;
  let conn = null;

  if (apiKey !== undefined) {
    const resp = await axios.post(_urljoin(API_URL, `/api/apikey/login`), {
      token: apiKey,
    });
    const info = resp.data;

    _check_org_info(info.org_info, orgName);

    conn = log_conn();
    conn.set_token(apiKey);

    ping_ok = await conn.ping();
  } else {
    // TODO: Implement token based login in the JS client
    throw new Error(
      "Please specify an api key. Token based login is not yet implemented in the JS client."
    );
  }

  if (!conn) {
    throw new Error("Conn should be set at this point (a bug)");
  }

  if (!ping_ok) {
    await conn.get("ping");
  }

  conn.make_long_lived();

  // Set the same token in the API
  api_conn().set_token(apiKey);
  LOGIN_TOKEN = conn.token;
  LOGGED_IN = true;
}

/**
 * Log a single event to the current experiment. The event will be batched and uploaded behind the scenes.
 *
 * @param event The event to log. See `Experiment.log` for full details.
 * @returns The `id` of the logged event.
 */
export function log(event: ExperimentLogFullArgs): string {
  const currentExperiment = _state.currentExperiment.getStore();
  if (!currentExperiment) {
    throw new Error("Not initialized. Please call init() first");
  }

  return currentExperiment.log(event);
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
  const currentExperiment = _state.currentExperiment.getStore();
  if (!currentExperiment) {
    throw new Error("Not initialized. Please call init() first");
  }

  return await currentExperiment.summarize(options);
}

/**
 * Returns the currently-active experiment (set by `braintrust.initWithCallback` or `braintrust.withCurrent`). Returns undefined if no current experiment has been set.
 */
export function currentExperiment(): Experiment | undefined {
  return _state.currentExperiment.getStore();
}

/**
 * Return the currently-active span for logging (set by `startSpanWithCallback` or `braintrust.withCurrent`). If there is no active span, returns a no-op span object, which supports the same interface as spans but does no logging.
 *
 * See `Span` for full details.
 */
export function currentSpan(): Span {
  return _state.currentSpan.getStore()!;
}

/**
 * Toplevel function for starting a span. If there is a currently-active span, the new span is created as a subspan. Otherwise, if there is a currently-active experiment, the new span is created as a toplevel span. Otherwise, it returns a no-op span object.
 *
 * Unless a name is explicitly provided, the name of the span will be the name of the calling function, or "root" if no meaningful name can be determined.
 *
 * We recommend running spans within a callback (using `startSpanWithinCallback`) to automatically mark them as current and ensure they are terminated. If you wish to start a span outside a callback, be sure to terminate it with `span.end()`.
 *
 * See `Span.startSpan` for full details.
 */
export function startSpan(args: StartSpanOptionalNameArgs): Span {
  const { name: nameOpt, ...argsRest } = args;
  const name =
    (nameOpt ?? iso.getCallerLocation()?.caller_function_name) || "root";
  const newSpanArgs = { name, ...argsRest };
  const parentSpan = currentSpan();
  if (!Object.is(parentSpan, noopSpan)) {
    return parentSpan.startSpan(newSpanArgs);
  }

  const experiment = currentExperiment();
  if (experiment) {
    return experiment.startSpan(newSpanArgs);
  }

  return noopSpan;
}

/**
 * Wrapper over `braintrust.startSpan`, which passes the initialized `Span` it to the given callback and ends it afterwards. See `Span.startSpanWithCallback` for full details.
 */
export function startSpanWithCallback<R>(
  args: StartSpanOptionalNameArgs & SetCurrentArg,
  callback: (span: Span) => R
): R {
  const span = startSpan(args);
  return runFinally(
    () => {
      if (args.setCurrent ?? true) {
        return withCurrent(span, () => callback(span));
      } else {
        return callback(span);
      }
    },
    () => span.end()
  );
}

/**
 * Set the given experiment or span as current within the given callback and any asynchronous operations created within the callback. The current experiment can be accessed with `braintrust.currentExperiment`, and the current span with `braintrust.currentSpan`.
 *
 * @param object: The experiment or span to be marked as current.
 * @param callback: The callback to be run under the scope of the current object.
 */
export function withCurrent<R>(
  object: Experiment | SpanImpl | NoopSpan,
  callback: () => R
): R {
  if (object instanceof Experiment) {
    return _state.currentExperiment.run(object, callback);
  } else if (object instanceof SpanImpl || object instanceof NoopSpan) {
    return _state.currentSpan.run(object, callback);
  } else {
    throw new Error(`Invalid object of type ${typeof object}`);
  }
}

function _check_org_info(org_info: any, org_name: string | undefined) {
  if (org_info.length === 0) {
    throw new Error("This user is not part of any organizations.");
  }

  for (const org of org_info) {
    if (org_name === undefined || org.name === org_name) {
      ORG_ID = org.id;
      ORG_NAME = org.name;
      LOG_URL = org.api_url;
      break;
    }
  }

  if (ORG_ID === undefined) {
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

function getCurrentUnixTimestamp(): number {
  return new Date().getTime() / 1000;
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
    for (const key of Object.keys(event.metrics)) {
      if (typeof key !== "string") {
        throw new Error("metric keys must be strings");
      }
    }
    for (const forbiddenKey of [
      "start",
      "end",
      "caller_function_name",
      "caller_file_name",
      "caller_line_num",
    ]) {
      if (forbiddenKey in event.metrics) {
        throw new Error(`Key ${forbiddenKey} may not be specified in metrics`);
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
  }: {
    experimentName?: string;
    description?: string;
    dataset?: Dataset;
    update?: boolean;
    baseExperiment?: string;
    isPublic?: boolean;
  } = {
    experimentName: undefined,
    description: undefined,
    baseExperiment: undefined,
    isPublic: false,
  }
) {
  const args: Record<string, unknown> = {
    project_name: projectName,
    org_id: ORG_ID,
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

  const response = await api_conn().post_json("api/experiment/register", args);

  const project = response.project;
  const experiment = response.experiment;

  // NOTE: This is a deviation from the Python lib and allows the log() method
  // to not be async.
  //
  const user_id = (await _user_info())["id"];

  return new Experiment(
    project,
    experiment.id,
    experiment.name,
    user_id,
    dataset
  );
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
  public readonly project: Project;
  public readonly id: string;
  public readonly name: string;
  public readonly user_id: string;
  public readonly dataset?: Dataset;
  private logger: LogThread;
  private lastStartTime: number;
  private finished: boolean;

  constructor(
    project: Project,
    id: string,
    name: string,
    user_id: string,
    dataset?: Dataset
  ) {
    this.finished = false;

    this.project = project;
    this.id = id;
    this.name = name;
    this.user_id = user_id;
    this.dataset = dataset;
    this.logger = new LogThread();
    this.lastStartTime = getCurrentUnixTimestamp();

    unterminatedObjects.addUnterminated(this, iso.getCallerLocation());
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
   * @param event.metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically and should not be specified: "start", "end", "caller_function_name", "caller_file_name", "caller_line_num".
   * @param event.id: (Optional) a unique identifier for the event. If you don't provide one, BrainTrust will generate one for you.
   * @param event.dataset_record_id: (Optional) the id of the dataset record that this event is associated with. This field is required if and only if the experiment is associated with a dataset.
   * @param event.inputs: (Deprecated) the same as `input` (will be removed in a future version).
   * :returns: The `id` of the logged event.
   */
  public log(event: Readonly<ExperimentLogFullArgs>): string {
    this.checkNotFinished();

    event = validateAndSanitizeExperimentLogFullArgs(event, !!this.dataset);
    const span = this.startSpan({ startTime: this.lastStartTime, event });
    this.lastStartTime = span.end();
    return span.id;
  }

  /**
   * Create a new toplevel span. The name parameter is optional and defaults to "root".
   *
   * See `Span.startSpan` for full details.
   */
  public startSpan(args: StartSpanOptionalNameArgs): Span {
    this.checkNotFinished();

    const { name, ...argsRest } = args;
    return new SpanImpl({
      experimentLogger: this.logger,
      name: name ?? "root",
      ...argsRest,
      rootExperiment: this,
    });
  }

  /**
   * Wrapper over `Experiment.startSpan`, which passes the initialized `Span` it to the given callback and ends it afterwards. See `Span.startSpanWithCallback` for full details.
   */
  public startSpanWithCallback<R>(
    args: StartSpanOptionalNameArgs & SetCurrentArg,
    callback: (span: Span) => R
  ): R {
    const { setCurrent, ...argsRest } = args;
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

    await this.logger.flush();
    const projectUrl = `${API_URL}/app/${encodeURIComponent(
      ORG_NAME!
    )}/p/${encodeURIComponent(this.project.name)}`;
    const experimentUrl = `${projectUrl}/${encodeURIComponent(this.name)}`;

    let scores: Record<string, ScoreSummary> | undefined = undefined;
    let comparisonExperimentName = undefined;
    if (summarizeScores) {
      if (comparisonExperimentId === undefined) {
        const conn = log_conn();
        const resp = await conn.get("/crud/base_experiments", {
          id: this.id,
        });
        const base_experiments = resp.data;
        if (base_experiments.length > 0) {
          comparisonExperimentId = base_experiments[0]["base_exp_id"];
          comparisonExperimentName = base_experiments[0]["base_exp_name"];
        }
      }

      if (comparisonExperimentId !== undefined) {
        scores = await log_conn().get_json(
          "/experiment-comparison",
          {
            experiment_id: this.id,
            base_experiment_id: comparisonExperimentId,
          },
          3
        );
      }
    }

    return {
      projectName: this.project.name,
      experimentName: this.name,
      projectUrl: projectUrl,
      experimentUrl: experimentUrl,
      comparisonExperimentName: comparisonExperimentName,
      scores,
    };
  }

  /**
   * Finish the experiment and return its id. After calling close, you may not invoke any further methods on the experiment object.
   *
   * Will be invoked automatically if the experiment is wrapped in a callback passed to `braintrust.initWithCallback`.
   *
   * @returns The experiment id.
   */
  public async close(): Promise<string> {
    this.checkNotFinished();

    await this.logger.flush();

    this.finished = true;
    unterminatedObjects.removeUnterminated(this);
    return this.id;
  }

  private checkNotFinished() {
    if (this.finished) {
      throw new Error("Cannot invoke method on finished experiment");
    }
  }
}

/**
 * Primary implementation of the `Span` interface. See the `Span` interface for full details on each method.
 *
 * We suggest using one of the various `startSpan` methods, instead of creating Spans directly. See `Span.startSpan` for full details.
 */
export class SpanImpl implements Span {
  private finished: boolean;
  private experimentLogger: LogThread;
  // `internalData` contains fields that are not part of the "user-sanitized"
  // set of fields which we want to log in just one of the span rows.
  private internalData: Partial<ExperimentEvent>;
  private isMerge: boolean;

  // Fields that are logged to every row.
  public id: string;
  public span_id: string;
  public root_span_id: string;
  private _project_id: string;
  private _experiment_id: string;

  // root_experiment should only be specified for a root span. parent_span
  // should only be specified for non-root spans.
  constructor(
    args: {
      experimentLogger: LogThread;
      name: string;
      spanAttributes?: Record<any, any>;
      startTime?: number;
      setCurrent?: boolean;
      event?: ExperimentLogPartialArgs & Partial<IdField>;
    } & ({ rootExperiment: Experiment } | { parentSpan: SpanImpl })
  ) {
    this.finished = false;

    this.experimentLogger = args.experimentLogger;

    const callerLocation = iso.getCallerLocation();
    this.internalData = {
      metrics: {
        start: args.startTime ?? getCurrentUnixTimestamp(),
        ...callerLocation,
      },
      span_attributes: { ...args.spanAttributes, name: args.name },
    };

    this.id = args.event?.id ?? uuidv4();
    this.span_id = uuidv4();
    if ("rootExperiment" in args) {
      this.root_span_id = this.span_id;
      this._project_id = args.rootExperiment.project.id;
      this._experiment_id = args.rootExperiment.id;
      this.internalData = Object.assign(this.internalData, {
        // TODO: Hopefully we can remove this.
        user_id: args.rootExperiment.user_id,
        created: new Date().toISOString(),
      });
    } else if ("parentSpan" in args) {
      this.root_span_id = args.parentSpan.root_span_id;
      this._project_id = args.parentSpan._project_id;
      this._experiment_id = args.parentSpan._experiment_id;
      this.internalData.span_parents = [args.parentSpan.span_id];
    } else {
      throw new Error("Must provide either 'rootExperiment' or 'parentSpan'");
    }

    // The first log is a replacement, but subsequent logs to the same span
    // object will be merges.
    this.isMerge = false;
    const { id: id, ...eventRest } = args.event ?? {};
    this.log(eventRest);
    this.isMerge = true;

    unterminatedObjects.addUnterminated(this, callerLocation);
  }

  public log(event: ExperimentLogPartialArgs): void {
    this.checkNotFinished();

    const sanitized = validateAndSanitizeExperimentLogPartialArgs(event);
    // There should be no overlap between the dictionaries being merged.
    const record: ExperimentEvent = {
      ...sanitized,
      ...this.internalData,
      id: this.id,
      span_id: this.span_id,
      root_span_id: this.root_span_id,
      project_id: this._project_id,
      experiment_id: this._experiment_id,
      _is_merge: this.isMerge,
    };
    this.internalData = {};
    this.experimentLogger.log([record]);
  }

  public startSpan(args: StartSpanArgs): Span {
    this.checkNotFinished();

    return new SpanImpl({
      experimentLogger: this.experimentLogger,
      ...args,
      parentSpan: this,
    });
  }

  public startSpanWithCallback<R>(
    args: StartSpanArgs & SetCurrentArg,
    callback: (span: Span) => R
  ): R {
    const span = this.startSpan(args);
    return runFinally(
      () => {
        if (args.setCurrent ?? true) {
          return withCurrent(span, () => callback(span));
        } else {
          return callback(span);
        }
      },
      () => span.end()
    );
  }

  public end(args?: { endTime?: number }): number {
    this.checkNotFinished();

    const endTime = args?.endTime ?? getCurrentUnixTimestamp();
    this.internalData = { metrics: { end: endTime } };
    this.log({});

    this.finished = true;
    unterminatedObjects.removeUnterminated(this);
    return endTime;
  }

  public close(args?: { endTime?: number }): number {
    return this.end(args);
  }

  private checkNotFinished() {
    if (this.finished) {
      throw new Error("Cannot invoke method on finished span");
    }
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
    org_id: ORG_ID,
    project_name,
    dataset_name: name,
    description,
  };
  const response = await api_conn().post_json("api/dataset/register", args);

  const project = response.project;
  const dataset = response.dataset;

  // NOTE: This is a deviation from the Python lib and allows the log() method
  // to not be async.
  //
  const user_id = (await _user_info())["id"];

  return new Dataset(project, dataset.id, dataset.name, user_id, version);
}

/**
 * A dataset is a collection of records, such as model inputs and outputs, which represent
 * data you can use to evaluate and fine-tune models. You can log production data to datasets,
 * curate them with interesting examples, edit/delete records, and run evaluations against them.
 *
 * You should not create `Dataset` objects directly. Instead, use the `braintrust.initDataset()` method.
 */
export class Dataset {
  public readonly project: Project;
  public readonly id: string;
  public readonly name: string;
  public readonly user_id: string;
  private pinnedVersion?: string;
  private _fetchedData?: any[] = undefined;
  private logger: LogThread;
  private finished: boolean;

  constructor(
    project: Project,
    id: string,
    name: string,
    user_id: string,
    pinnedVersion?: string
  ) {
    this.finished = false;

    this.project = project;
    this.id = id;
    this.name = name;
    this.user_id = user_id;
    this.pinnedVersion = pinnedVersion;
    this.logger = new LogThread();

    unterminatedObjects.addUnterminated(this, iso.getCallerLocation());
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
    this.checkNotFinished();

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
      user_id: this.user_id,
      created: new Date().toISOString(),
      metadata,
    };

    this.logger.log([args]);
    return args.id;
  }

  public delete(id: string): string {
    this.checkNotFinished();

    const user_id = this.user_id;
    const args = {
      id,
      project_id: this.project.id,
      dataset_id: this.id,
      user_id,
      created: new Date().toISOString(),
      _object_delete: true,
    };

    this.logger.log([args]);
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
    this.checkNotFinished();

    let { summarizeData = true } = options || {};

    await this.logger.flush();
    const projectUrl = `${API_URL}/app/${encodeURIComponent(
      ORG_NAME!
    )}/p/${encodeURIComponent(this.project.name)}`;
    const datasetUrl = `${projectUrl}/d/${encodeURIComponent(this.name)}`;

    let dataSummary = undefined;
    if (summarizeData) {
      dataSummary = await log_conn().get_json(
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
    this.checkNotFinished();

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
    this.checkNotFinished();

    return this.fetch();
  }

  async fetchedData() {
    this.checkNotFinished();

    if (this._fetchedData === undefined) {
      const resp = await log_conn().get("object/dataset", {
        id: this.id,
        fmt: "json",
        version: this.pinnedVersion,
      });

      const text = await resp.data;
      this._fetchedData = text
        .split("\n")
        .filter((x: string) => x.trim() !== "")
        .map((x: string) => JSON.parse(x));
    }

    return this._fetchedData || [];
  }

  clearCache() {
    this.checkNotFinished();

    this._fetchedData = undefined;
  }

  async version() {
    this.checkNotFinished();

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
   * Terminate connection to the dataset and return its id. After calling close, you may not invoke any further methods on the dataset object.
   *
   * Will be invoked automatically if the dataset is bound as a context manager.
   *
   * @returns The dataset id.
   */
  public async close(): Promise<string> {
    this.checkNotFinished();

    await this.logger.flush();
    this.finished = true;
    unterminatedObjects.removeUnterminated(this);
    return this.id;
  }

  private checkNotFinished() {
    if (this.finished) {
      throw new Error("Cannot invoke method on finished dataset");
    }
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
