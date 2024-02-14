/// <reference lib="dom" />

import { v4 as uuidv4 } from "uuid";

import {
  TRANSACTION_ID_FIELD,
  IS_MERGE_FIELD,
  PARENT_ID_FIELD,
  mergeDicts,
  mergeRowBatch,
  VALID_SOURCES,
  AUDIT_SOURCE_FIELD,
  AUDIT_METADATA_FIELD,
  GitMetadataSettings,
  RepoInfo,
  mergeGitMetadataSettings,
  TransactionId,
  ParentExperimentIds,
  ParentProjectLogIds,
  IdField,
  ExperimentLogPartialArgs,
  ExperimentLogFullArgs,
  LogFeedbackFullArgs,
  SanitizedExperimentLogPartialArgs,
  ExperimentEvent,
  BackgroundLogEvent,
  AnyDatasetRecord,
  DEFAULT_IS_LEGACY_DATASET,
  DatasetRecord,
  ensureDatasetRecord,
  makeLegacyEvent,
} from "@braintrust/core";

import iso, { IsoAsyncLocalStorage } from "./isomorph";
import {
  runFinally,
  GLOBAL_PROJECT,
  getCurrentUnixTimestamp,
  isEmpty,
  LazyValue,
} from "./util";

export type SetCurrentArg = { setCurrent?: boolean };

type StartSpanEventArgs = ExperimentLogPartialArgs & Partial<IdField>;

export type StartSpanArgs = {
  name?: string;
  spanAttributes?: Record<any, any>;
  startTime?: number;
  parentId?: string;
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
   * Add feedback to the current span. Unlike `Experiment.logFeedback` and `Logger.logFeedback`, this method does not accept an id parameter, because it logs feedback to the current span.
   *
   * @param event: Data to be logged. See `Experiment.logFeedback` for full details.
   */
  logFeedback(event: Omit<LogFeedbackFullArgs, "id">): void;

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
   * @param args.parentId Optional id of the parent span. If not provided, the current span will be used (depending on context). This is useful for adding spans to an existing trace.
   * @param args.event Data to be logged. See `Experiment.log` for full details.
   * @Returns The result of running `callback`.
   */
  traced<R>(
    callback: (span: Span) => R,
    args?: StartSpanArgs & SetCurrentArg
  ): R;

  /**
   * Lower-level alternative to `traced`. This allows you to start a span yourself, and can be useful in situations
   * where you cannot use callbacks. However, spans started with `startSpan` will not be marked as the "current span",
   * so `currentSpan()` and `traced()` will be no-ops. If you want to mark a span as current, use `traced` instead.
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

  public logFeedback(event: Omit<LogFeedbackFullArgs, "id">) {}

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

  public appUrl: string | null = null;
  public loginToken: string | null = null;
  public orgId: string | null = null;
  public orgName: string | null = null;
  public logUrl: string | null = null;
  public loggedIn: boolean = false;
  public gitMetadataSettings?: GitMetadataSettings;

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
    this.appUrl = null;
    this.loginToken = null;
    this.orgId = null;
    this.orgName = null;
    this.logUrl = null;
    this.loggedIn = false;
    this.gitMetadataSettings = undefined;

    this._apiConn = null;
    this._logConn = null;
  }

  public apiConn(): HTTPConnection {
    if (!this._apiConn) {
      if (!this.appUrl) {
        throw new Error("Must initialize appUrl before requesting apiConn");
      }
      this._apiConn = new HTTPConnection(this.appUrl);
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

function logFeedbackImpl(
  bgLogger: BackgroundLogger,
  parentIds: LazyValue<ParentExperimentIds | ParentProjectLogIds>,
  {
    id,
    expected,
    scores,
    metadata: inputMetadata,
    comment,
    source: inputSource,
  }: LogFeedbackFullArgs
) {
  const source = inputSource ?? "external";

  if (!VALID_SOURCES.includes(source)) {
    throw new Error(`source must be one of ${VALID_SOURCES}`);
  }

  if (isEmpty(scores) && isEmpty(expected) && isEmpty(comment)) {
    throw new Error(
      "At least one of scores, expected, or comment must be specified"
    );
  }

  const validatedEvent = validateAndSanitizeExperimentLogPartialArgs({
    scores,
    metadata: inputMetadata,
    expected,
  });

  let { metadata, ...updateEvent } = validatedEvent;
  updateEvent = Object.fromEntries(
    Object.entries(updateEvent).filter(([_, v]) => !isEmpty(v))
  );

  const trueParentIds = new LazyValue(async () => {
    const { kind, ...ids } = await parentIds.get();
    return ids;
  });

  if (Object.keys(updateEvent).length > 0) {
    const record = new LazyValue(async () => {
      return {
        id,
        ...updateEvent,
        ...(await trueParentIds.get()),
        [AUDIT_SOURCE_FIELD]: source,
        [AUDIT_METADATA_FIELD]: metadata,
        [IS_MERGE_FIELD]: true,
      };
    });
    bgLogger.log([record]);
  }

  if (!isEmpty(comment)) {
    const record = new LazyValue(async () => {
      return {
        id: uuidv4(),
        created: new Date().toISOString(),
        origin: {
          // NOTE: We do not know (or care?) what the transaction id of the row that
          // we're commenting on is here, so we omit it.
          id,
        },
        comment: {
          text: comment,
        },
        ...(await trueParentIds.get()),
        [AUDIT_SOURCE_FIELD]: source,
        [AUDIT_METADATA_FIELD]: metadata,
      };
    });
    bgLogger.log([record]);
  }
}

export class Logger<IsAsyncFlush extends boolean> {
  private lazyMetadata: LazyValue<OrgProjectMetadata>;
  private logOptions: LogOptions<IsAsyncFlush>;
  private bgLogger: BackgroundLogger;
  private lastStartTime: number;

  // For type identification.
  public kind: "logger" = "logger";

  constructor(
    lazyMetadata: LazyValue<OrgProjectMetadata>,
    logOptions: LogOptions<IsAsyncFlush> = {}
  ) {
    this.lazyMetadata = lazyMetadata;
    this.logOptions = logOptions;
    const logConn = new LazyValue(() =>
      this.getState().then((state) => state.logConn())
    );
    this.bgLogger = new BackgroundLogger(logConn);
    this.lastStartTime = getCurrentUnixTimestamp();
  }

  public get org_id(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata.get()).org_id;
    })();
  }

  public get project(): Promise<ObjectMetadata> {
    return (async () => {
      return (await this.lazyMetadata.get()).project;
    })();
  }

  private async getState(): Promise<BraintrustState> {
    // Ensure the login state is populated by awaiting lazyMetadata.
    await this.lazyMetadata.get();
    return _state;
  }

  /**
   * Log a single event. The event will be batched and uploaded behind the scenes if `logOptions.asyncFlush` is true.
   *
   * @param event The event to log.
   * @param event.input: (Optional) the arguments that uniquely define a user input (an arbitrary, JSON serializable object).
   * @param event.output: (Optional) the output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
   * @param event.expected: (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
   * @param event.scores: (Optional) a dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare logs.
   * @param event.metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
   * @param event.metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically: "start", "end".
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

  private async lazyParentIds(): Promise<ParentProjectLogIds> {
    return {
      kind: "project_log",
      org_id: await this.org_id,
      project_id: (await this.project).id,
      log_id: "g",
    };
  }

  /**
   * Lower-level alternative to `traced`. This allows you to start a span yourself, and can be useful in situations
   * where you cannot use callbacks. However, spans started with `startSpan` will not be marked as the "current span",
   * so `currentSpan()` and `traced()` will be no-ops. If you want to mark a span as current, use `traced` instead.
   *
   * See `traced` for full details.
   */
  public startSpan(args?: StartSpanArgs): Span {
    const { name, ...argsRest } = args ?? {};
    return new SpanImpl({
      parentIds: new LazyValue(() => this.lazyParentIds()),
      bgLogger: this.bgLogger,
      name: name ?? "root",
      ...argsRest,
    });
  }

  /**
   * Log feedback to an event. Feedback is used to save feedback scores, set an expected value, or add a comment.
   *
   * @param event
   * @param event.id The id of the event to log feedback for. This is the `id` returned by `log` or accessible as the `id` field of a span.
   * @param event.scores (Optional) a dictionary of numeric values (between 0 and 1) to log. These scores will be merged into the existing scores for the event.
   * @param event.expected (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not.
   * @param event.comment (Optional) an optional comment string to log about the event.
   * @param event.metadata (Optional) a dictionary with additional data about the feedback. If you have a `user_id`, you can log it here and access it in the Braintrust UI.
   * @param event.source (Optional) the source of the feedback. Must be one of "external" (default), "app", or "api".
   */
  public logFeedback(event: LogFeedbackFullArgs): void {
    logFeedbackImpl(
      this.bgLogger,
      new LazyValue(() => this.lazyParentIds()),
      event
    );
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

// 6 MB (from our own testing).
const MaxRequestSize = 6 * 1024 * 1024;

function constructJsonArray(items: string[]) {
  return `[${items.join(",")}]`;
}

function constructLogs3Data(items: string[]) {
  return `{"rows": ${constructJsonArray(items)}, "api_version": 2}`;
}

const DefaultBatchSize = 100;
const NumRetries = 3;

function now() {
  return new Date().getTime();
}

class BackgroundLogger {
  private logConn: LazyValue<HTTPConnection>;
  private items: LazyValue<BackgroundLogEvent>[] = [];
  private active_flush: Promise<string[]> = Promise.resolve([]);
  private active_flush_resolved = true;

  constructor(logConn: LazyValue<HTTPConnection>) {
    this.logConn = logConn;

    // Note that this will not run for explicit termination events, such as
    // calls to `process.exit()` or uncaught exceptions. Thus it is a
    // "best-effort" flush.
    iso.processOn("beforeExit", async () => {
      await this.flush();
    });
  }

  log(items: LazyValue<BackgroundLogEvent>[]) {
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
    const itemLazyValues = this.items;
    this.items = [];
    const allItems = await (async () => {
      try {
        const itemPromises = itemLazyValues.map((x) => x.get());
        return mergeRowBatch(await Promise.all(itemPromises)).reverse();
      } catch (e) {
        console.warn(
          "Encountered error when constructing records to flush:\n",
          e
        );
        return [];
      }
    })();
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
          const dataS = constructLogs3Data(items);
          for (let i = 0; i < NumRetries; i++) {
            const startTime = now();
            try {
              try {
                return (
                  await (await this.logConn.get()).post_json("logs3", dataS)
                ).ids.map((res: any) => res.id);
              } catch (e) {
                // Fallback to legacy API. Remove once all API endpoints are updated.
                const legacyDataS = constructJsonArray(
                  items.map((r: any) =>
                    JSON.stringify(makeLegacyEvent(JSON.parse(r)))
                  )
                );
                return (
                  await (
                    await this.logConn.get()
                  ).post_json("logs", legacyDataS)
                ).map((res: any) => res.id);
              }
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
                  dataS.length
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

type InitOpenOption<IsOpen extends boolean> = {
  open?: IsOpen;
};

export type InitOptions<IsOpen extends boolean> = {
  experiment?: string;
  description?: string;
  dataset?: AnyDataset;
  update?: boolean;
  baseExperiment?: string;
  isPublic?: boolean;
  appUrl?: string;
  apiKey?: string;
  orgName?: string;
  metadata?: Record<string, unknown>;
  gitMetadataSettings?: GitMetadataSettings;
  projectId?: string;
  baseExperimentId?: string;
  repoInfo?: RepoInfo;
  setCurrent?: boolean;
} & InitOpenOption<IsOpen>;

export type FullInitOptions<IsOpen extends boolean> = {
  project?: string;
} & InitOptions<IsOpen>;

type InitializedExperiment<IsOpen extends boolean | undefined> =
  IsOpen extends true ? ReadonlyExperiment : Experiment;

/**
 * Log in, and then initialize a new experiment in a specified project. If the project does not exist, it will be created.
 *
 * @param options Options for configuring init().
 * @param options.project The name of the project to create the experiment in. Must specify at least one of `project` or `projectId`.
 * @param options.experiment The name of the experiment to create. If not specified, a name will be generated automatically.
 * @param options.description An optional description of the experiment.
 * @param options.dataset (Optional) A dataset to associate with the experiment. You can pass in the name of the dataset (in the same project) or a dataset object (from any project).
 * @param options.update If the experiment already exists, continue logging to it.
 * @param options.baseExperiment An optional experiment name to use as a base. If specified, the new experiment will be summarized and compared to this experiment. Otherwise, it will pick an experiment by finding the closest ancestor on the default (e.g. main) branch.
 * @param options.isPublic An optional parameter to control whether the experiment is publicly visible to anybody with the link or privately visible to only members of the organization. Defaults to private.
 * @param options.appUrl The URL of the Braintrust App. Defaults to https://www.braintrustdata.com.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @param options.metadata (Optional) A dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
 * @param options.gitMetadataSettings (Optional) Settings for collecting git metadata. By default, will collect all git metadata fields allowed in org-level settings.
 * @param setCurrent If true (the default), set the global current-experiment to the newly-created one.
 * @param options.open If the experiment already exists, open it in read-only mode.
 * @param options.projectId The id of the project to create the experiment in. This takes precedence over `project` if specified.
 * @param options.baseExperimentId An optional experiment id to use as a base. If specified, the new experiment will be summarized and compared to this. This takes precedence over `baseExperiment` if specified.
 * @param options.repoInfo (Optional) Explicitly specify the git metadata for this experiment. This takes precedence over `gitMetadataSettings` if specified.
 * @returns The newly created Experiment.
 */
export function init<IsOpen extends boolean = false>(
  options: Readonly<FullInitOptions<IsOpen>>
): InitializedExperiment<IsOpen>;

/**
 * Legacy form of `init` which accepts the project name as the first parameter,
 * separately from the remaining options. See `init(options)` for full details.
 */
export function init<IsOpen extends boolean = false>(
  project: string,
  options?: Readonly<InitOptions<IsOpen>>
): InitializedExperiment<IsOpen>;

/**
 * Combined overload implementation of `init`. Do not call this directly.
 * Instead, call `init(options)` or `init(project, options)`.
 */
export function init<IsOpen extends boolean = false>(
  projectOrOptions: string | Readonly<FullInitOptions<IsOpen>>,
  optionalOptions?: Readonly<InitOptions<IsOpen>>
): InitializedExperiment<IsOpen> {
  const options = ((): Readonly<FullInitOptions<IsOpen>> => {
    if (typeof projectOrOptions === "string") {
      return { ...optionalOptions, project: projectOrOptions };
    } else {
      if (optionalOptions !== undefined) {
        throw new Error(
          "Cannot specify options struct as both parameters. Must call either init(project, options) or init(options)."
        );
      }
      return projectOrOptions;
    }
  })();

  const {
    project,
    experiment,
    description,
    dataset,
    baseExperiment,
    isPublic,
    open,
    update,
    appUrl,
    apiKey,
    orgName,
    metadata,
    gitMetadataSettings,
    projectId,
    baseExperimentId,
    repoInfo,
  } = options;

  if (open && update) {
    throw new Error("Cannot open and update an experiment at the same time");
  }

  if (open || update) {
    if (isEmpty(experiment)) {
      const action = open ? "open" : "update";
      throw new Error(
        `Cannot ${action} an experiment without specifying its name`
      );
    }

    const lazyMetadata: LazyValue<ProjectExperimentMetadata> = new LazyValue(
      async () => {
        await login({
          orgName: orgName,
          apiKey,
          appUrl,
        });
        const args: Record<string, unknown> = {
          project_name: project,
          project_id: projectId,
          org_name: _state.orgName,
          experiment_name: experiment,
        };

        const response = await _state
          .apiConn()
          .post_json("api/experiment/get", args);

        if (response.length === 0) {
          throw new Error(
            `Experiment ${experiment} not found in project ${
              projectId ?? project
            }.`
          );
        }

        const info = response[0];
        return {
          project: {
            id: info.project_id,
            name: "",
            fullInfo: {},
          },
          experiment: {
            id: info.id,
            name: info.name,
            fullInfo: info,
          },
        };
      }
    );

    if (open) {
      return new ReadonlyExperiment(
        lazyMetadata
      ) as InitializedExperiment<IsOpen>;
    } else {
      const ret = new Experiment(lazyMetadata, dataset);
      if (options.setCurrent ?? true) {
        _state.currentExperiment = ret;
      }
      return ret as InitializedExperiment<IsOpen>;
    }
  }

  const lazyMetadata: LazyValue<ProjectExperimentMetadata> = new LazyValue(
    async () => {
      await login({
        orgName: orgName,
        apiKey,
        appUrl,
      });
      const args: Record<string, unknown> = {
        project_name: project,
        project_id: projectId,
        org_id: _state.orgId,
      };

      if (experiment) {
        args["experiment_name"] = experiment;
      }

      if (description) {
        args["description"] = description;
      }

      const repoInfoArg = await (async (): Promise<RepoInfo | undefined> => {
        if (repoInfo) {
          return repoInfo;
        }
        let mergedGitMetadataSettings = {
          ...(_state.gitMetadataSettings || {
            collect: "all",
          }),
        };
        if (gitMetadataSettings) {
          mergedGitMetadataSettings = mergeGitMetadataSettings(
            mergedGitMetadataSettings,
            gitMetadataSettings
          );
        }
        return await iso.getRepoInfo(mergedGitMetadataSettings);
      })();

      if (repoInfoArg) {
        args["repo_info"] = repoInfoArg;
      }

      if (baseExperimentId) {
        args["base_exp_id"] = baseExperimentId;
      } else if (baseExperiment) {
        args["base_experiment"] = baseExperiment;
      } else {
        args["ancestor_commits"] = await iso.getPastNAncestors();
      }

      if (dataset !== undefined) {
        args["dataset_id"] = await dataset.id;
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
            console.warn(
              `Base experiment ${args["base_experiment"]} not found.`
            );
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
    }
  );

  const ret = new Experiment(lazyMetadata, dataset);
  if (options.setCurrent ?? true) {
    _state.currentExperiment = ret;
  }
  return ret as InitializedExperiment<IsOpen>;
}

/**
 * Alias for init(options).
 */
export function initExperiment<IsOpen extends boolean = false>(
  options: Readonly<InitOptions<IsOpen>>
): InitializedExperiment<IsOpen>;

/**
 * Alias for init(project, options).
 */
export function initExperiment<IsOpen extends boolean = false>(
  project: string,
  options?: Readonly<InitOptions<IsOpen>>
): InitializedExperiment<IsOpen>;

/**
 * Combined overload implementation of `initExperiment`, which is an alias for
 * `init`. Do not call this directly. Instead, call `initExperiment(options)` or
 * `initExperiment(project, options)`.
 */
export function initExperiment<IsOpen extends boolean = false>(
  projectOrOptions: string | Readonly<InitOptions<IsOpen>>,
  optionalOptions?: Readonly<InitOptions<IsOpen>>
): InitializedExperiment<IsOpen> {
  const options = ((): Readonly<FullInitOptions<IsOpen>> => {
    if (typeof projectOrOptions === "string") {
      return { ...optionalOptions, project: projectOrOptions };
    } else {
      if (optionalOptions !== undefined) {
        throw new Error(
          "Cannot specify options struct as both parameters. Must call either init(project, options) or init(options)."
        );
      }
      return projectOrOptions;
    }
  })();
  return init(options);
}

/**
 * This function is deprecated. Use `init` instead.
 */
export function withExperiment<R>(
  project: string,
  callback: (experiment: Experiment) => R,
  options: Readonly<InitOptions<false> & SetCurrentArg> = {}
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

type UseOutputOption<IsLegacyDataset extends boolean> = {
  useOutput?: IsLegacyDataset;
};

type InitDatasetOptions<IsLegacyDataset extends boolean> = {
  dataset?: string;
  description?: string;
  version?: string;
  appUrl?: string;
  apiKey?: string;
  orgName?: string;
  projectId?: string;
} & UseOutputOption<IsLegacyDataset>;

type FullInitDatasetOptions<IsLegacyDataset extends boolean> = {
  project?: string;
} & InitDatasetOptions<IsLegacyDataset>;

/**
 * Create a new dataset in a specified project. If the project does not exist, it will be created.
 *
 * @param options Options for configuring initDataset().
 * @param options.project The name of the project to create the dataset in. Must specify at least one of `project` or `projectId`.
 * @param options.dataset The name of the dataset to create. If not specified, a name will be generated automatically.
 * @param options.description An optional description of the dataset.
 * @param options.appUrl The URL of the Braintrust App. Defaults to https://www.braintrustdata.com.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @param options.projectId The id of the project to create the dataset in. This takes precedence over `project` if specified.
 * @param options.useOutput If true (the default), records will be fetched from this dataset in the legacy format, with the "expected" field renamed to "output". This will default to false in a future version of Braintrust.
 * @returns The newly created Dataset.
 */
export function initDataset<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET
>(
  options: Readonly<FullInitDatasetOptions<IsLegacyDataset>>
): Dataset<IsLegacyDataset>;

/**
 * Legacy form of `initDataset` which accepts the project name as the first
 * parameter, separately from the remaining options. See
 * `initDataset(options)` for full details.
 */
export function initDataset<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET
>(
  project: string,
  options?: Readonly<InitDatasetOptions<IsLegacyDataset>>
): Dataset<IsLegacyDataset>;

/**
 * Combined overload implementation of `initDataset`. Do not call this
 * directly. Instead, call `initDataset(options)` or `initDataset(project,
 * options)`.
 */
export function initDataset<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET
>(
  projectOrOptions: string | Readonly<FullInitDatasetOptions<IsLegacyDataset>>,
  optionalOptions?: Readonly<InitDatasetOptions<IsLegacyDataset>>
): Dataset<IsLegacyDataset> {
  const options = ((): Readonly<FullInitDatasetOptions<IsLegacyDataset>> => {
    if (typeof projectOrOptions === "string") {
      return { ...optionalOptions, project: projectOrOptions };
    } else {
      if (optionalOptions !== undefined) {
        throw new Error(
          "Cannot specify options struct as both parameters. Must call either initDataset(project, options) or initDataset(options)."
        );
      }
      return projectOrOptions;
    }
  })();

  const {
    project,
    dataset,
    description,
    version,
    appUrl,
    apiKey,
    orgName,
    projectId,
    useOutput: legacy,
  } = options;

  const lazyMetadata: LazyValue<ProjectDatasetMetadata> = new LazyValue(
    async () => {
      await login({
        orgName: orgName,
        apiKey,
        appUrl,
      });

      const args: Record<string, unknown> = {
        org_id: _state.orgId,
        project_name: project,
        project_id: projectId,
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
    }
  );

  return new Dataset(lazyMetadata, version, legacy);
}

/**
 * This function is deprecated. Use `initDataset` instead.
 */
export function withDataset<
  R,
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET
>(
  project: string,
  callback: (dataset: Dataset<IsLegacyDataset>) => R,
  options: Readonly<InitDatasetOptions<IsLegacyDataset>> = {}
): R {
  console.warn(
    "withDataset is deprecated and will be removed in a future version of braintrust. Simply create the dataset with `initDataset`."
  );
  const dataset = initDataset<IsLegacyDataset>(project, options);
  return callback(dataset);
}

type AsyncFlushArg<IsAsyncFlush> = {
  asyncFlush?: IsAsyncFlush;
};

type InitLoggerOptions<IsAsyncFlush> = {
  projectName?: string;
  projectId?: string;
  appUrl?: string;
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
 * @param options.appUrl The URL of the Braintrust App. Defaults to https://www.braintrustdata.com.
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
    appUrl,
    apiKey,
    orgName,
    forceLogin,
  } = options || {};

  const lazyMetadata: LazyValue<OrgProjectMetadata> = new LazyValue(
    async () => {
      await login({
        orgName: orgName,
        apiKey,
        appUrl,
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
    }
  );

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
 * @param options.appUrl The URL of the Braintrust App. Defaults to https://www.braintrustdata.com.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
 * key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @param options.forceLogin Login again, even if you have already logged in (by default, this function will exit quickly if you have already logged in)
 */
export async function login(
  options: {
    appUrl?: string;
    apiKey?: string;
    orgName?: string;
    forceLogin?: boolean;
  } = {}
) {
  const {
    appUrl = iso.getEnv("BRAINTRUST_APP_URL") ||
      "https://www.braintrustdata.com",
    apiKey = iso.getEnv("BRAINTRUST_API_KEY"),
    orgName = iso.getEnv("BRAINTRUST_ORG_NAME"),
  } = options || {};

  let { forceLogin = false } = options || {};

  if (_state.loggedIn && !forceLogin) {
    return;
  }

  _state.resetLoginInfo();

  _state.appUrl = appUrl;

  let conn = null;

  if (apiKey !== undefined) {
    const resp = await checkResponse(
      await fetch(_urljoin(_state.appUrl, `/api/apikey/login`), {
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
 * Lower-level alternative to `traced`. This allows you to start a span yourself, and can be useful in situations
 * where you cannot use callbacks. However, spans started with `startSpan` will not be marked as the "current span",
 * so `currentSpan()` and `traced()` will be no-ops. If you want to mark a span as current, use `traced` instead.
 *
 * See `traced` for full details.
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
      _state.logUrl = iso.getEnv("BRAINTRUST_API_URL") ?? org.api_url;
      _state.gitMetadataSettings = org.git_metadata || undefined;
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

      if (score === null || score === undefined) {
        continue;
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
    ("input" in event &&
      !isEmpty(event.input) &&
      "inputs" in event &&
      !isEmpty(event.inputs)) ||
    (!("input" in event) && !("inputs" in event))
  ) {
    throw new Error(
      "Exactly one of input or inputs (deprecated) must be specified. Prefer input."
    );
  }

  if (isEmpty(event.output)) {
    throw new Error("output must be specified");
  }
  if (isEmpty(event.scores)) {
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

export type WithTransactionId<R> = R & {
  [TRANSACTION_ID_FIELD]: TransactionId;
};

class ObjectFetcher<RecordType>
  implements AsyncIterable<WithTransactionId<RecordType>>
{
  private _fetchedData: WithTransactionId<RecordType>[] | undefined = undefined;

  constructor(
    private objectType: "dataset" | "experiment",
    private pinnedVersion: string | undefined,
    private mutateRecord?: (r: any) => RecordType
  ) {}

  public get id(): Promise<string> {
    throw new Error("ObjectFetcher subclasses must have an 'id' attribute");
  }

  protected async getState(): Promise<BraintrustState> {
    throw new Error("ObjectFetcher subclasses must have a 'getState' method");
  }

  async *fetch(): AsyncGenerator<WithTransactionId<RecordType>> {
    const records = await this.fetchedData();
    for (const record of records) {
      yield record;
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<WithTransactionId<RecordType>> {
    return this.fetch();
  }

  async fetchedData() {
    if (this._fetchedData === undefined) {
      const state = await this.getState();
      let data = undefined;
      try {
        const resp = await state.logConn().get(`object3/${this.objectType}`, {
          id: await this.id,
          fmt: "json2",
          version: this.pinnedVersion,
          api_version: "2",
        });
        data = await resp.json();
      } catch (e) {
        // DEPRECATION_NOTICE: When hitting old versions of the API where the "object3/" endpoint isn't available, we fall back to
        // the "object/" endpoint, which may require patching the incoming records. Remove this code once
        // all APIs are updated.
        const resp = await state.logConn().get(`object/${this.objectType}`, {
          id: await this.id,
          fmt: "json2",
          version: this.pinnedVersion,
        });
        data = await resp.json();
      }
      this._fetchedData = this.mutateRecord
        ? data?.map(this.mutateRecord)
        : data;
    }
    return this._fetchedData || [];
  }

  clearCache() {
    this._fetchedData = undefined;
  }

  public async version() {
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
}

export type BaseMetadata = Record<string, unknown> | void;
export type DefaultMetadataType = void;
export type EvalCase<Input, Expected, Metadata> = {
  input: Input;
} & (Expected extends void ? {} : { expected: Expected }) &
  (Metadata extends void ? {} : { metadata: Metadata });

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
export class Experiment extends ObjectFetcher<ExperimentEvent> {
  private readonly lazyMetadata: LazyValue<ProjectExperimentMetadata>;
  public readonly dataset?: AnyDataset;
  private bgLogger: BackgroundLogger;
  private lastStartTime: number;
  // For type identification.
  public kind: "experiment" = "experiment";

  constructor(
    lazyMetadata: LazyValue<ProjectExperimentMetadata>,
    dataset?: AnyDataset
  ) {
    super("experiment", undefined);
    this.lazyMetadata = lazyMetadata;
    this.dataset = dataset;

    const logConn = new LazyValue(() =>
      this.getState().then((state) => state.logConn())
    );
    this.bgLogger = new BackgroundLogger(logConn);
    this.lastStartTime = getCurrentUnixTimestamp();
  }

  public get id(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata.get()).experiment.id;
    })();
  }

  public get name(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata.get()).experiment.name;
    })();
  }

  public get project(): Promise<ObjectMetadata> {
    return (async () => {
      return (await this.lazyMetadata.get()).project;
    })();
  }

  protected async getState(): Promise<BraintrustState> {
    // Ensure the login state is populated by awaiting lazyMetadata.
    await this.lazyMetadata.get();
    return _state;
  }

  /**
   * Log a single event to the experiment. The event will be batched and uploaded behind the scenes.
   *
   * @param event The event to log.
   * @param event.input: The arguments that uniquely define a test case (an arbitrary, JSON serializable object). Later on, Braintrust will use the `input` to know whether two test cases are the same between experiments, so they should not contain experiment-specific state. A simple rule of thumb is that if you run the same experiment twice, the `input` should be identical.
   * @param event.output: The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
   * @param event.expected: (Optional) The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate your experiments while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
   * @param event.scores: A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare experiments.
   * @param event.metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
   * @param event.metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically: "start", "end".
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

  private async lazyParentIds(): Promise<ParentExperimentIds> {
    return {
      kind: "experiment",
      project_id: (await this.project).id,
      experiment_id: await this.id,
    };
  }

  /**
   * Lower-level alternative to `traced`. This allows you to start a span yourself, and can be useful in situations
   * where you cannot use callbacks. However, spans started with `startSpan` will not be marked as the "current span",
   * so `currentSpan()` and `traced()` will be no-ops. If you want to mark a span as current, use `traced` instead.
   *
   * See `traced` for full details.
   */
  public startSpan(args?: StartSpanArgs): Span {
    const { name, ...argsRest } = args ?? {};
    return new SpanImpl({
      parentIds: new LazyValue(() => this.lazyParentIds()),
      bgLogger: this.bgLogger,
      name: name ?? "root",
      ...argsRest,
    });
  }

  public async fetchBaseExperiment() {
    const state = await this.getState();
    const conn = state.apiConn();

    try {
      const resp = await conn.post("/api/base_experiment/get_id", {
        id: await this.id,
      });

      const base = await resp.json();
      return {
        id: base["base_exp_id"],
        name: base["base_exp_name"],
      };
    } catch (e) {
      if (e instanceof FailedHTTPResponse && e.status === 400) {
        // No base experiment
        return null;
      } else {
        throw e;
      }
    }
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
    const projectUrl = `${state.appUrl}/app/${encodeURIComponent(
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
        const baseExperiment = await this.fetchBaseExperiment();
        if (baseExperiment !== null) {
          comparisonExperimentId = baseExperiment.id;
          comparisonExperimentName = baseExperiment.name;
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
   * Log feedback to an event in the experiment. Feedback is used to save feedback scores, set an expected value, or add a comment.
   *
   * @param event
   * @param event.id The id of the event to log feedback for. This is the `id` returned by `log` or accessible as the `id` field of a span.
   * @param event.scores (Optional) a dictionary of numeric values (between 0 and 1) to log. These scores will be merged into the existing scores for the event.
   * @param event.expected (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not.
   * @param event.comment (Optional) an optional comment string to log about the event.
   * @param event.metadata (Optional) a dictionary with additional data about the feedback. If you have a `user_id`, you can log it here and access it in the Braintrust UI.
   * @param event.source (Optional) the source of the feedback. Must be one of "external" (default), "app", or "api".
   */
  public logFeedback(event: LogFeedbackFullArgs): void {
    logFeedbackImpl(
      this.bgLogger,
      new LazyValue(() => this.lazyParentIds()),
      event
    );
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
 * A read-only view of an experiment, initialized by passing `open: true` to `init()`.
 */
export class ReadonlyExperiment extends ObjectFetcher<ExperimentEvent> {
  constructor(
    private readonly lazyMetadata: LazyValue<ProjectExperimentMetadata>
  ) {
    super("experiment", undefined);
  }

  public get id(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata.get()).experiment.id;
    })();
  }

  public get name(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata.get()).experiment.name;
    })();
  }

  protected async getState(): Promise<BraintrustState> {
    // Ensure the login state is populated by awaiting lazyMetadata.
    await this.lazyMetadata.get();
    return _state;
  }

  public async *asDataset<Input, Expected>(): AsyncGenerator<
    EvalCase<Input, Expected, void>
  > {
    const records = this.fetch();
    for await (const record of records) {
      if (record.root_span_id !== record.span_id) {
        continue;
      }

      const { output, expected: expectedRecord } = record;
      const expected = (expectedRecord ?? output) as Expected;

      if (isEmpty(expected)) {
        yield {
          input: record.input as Input,
        } as EvalCase<Input, Expected, void>;
      } else {
        yield {
          input: record.input as Input,
          expected: expected,
        } as unknown as EvalCase<Input, Expected, void>;
      }
    }
  }
}

let executionCounter = 0;

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
  private parentIds: LazyValue<ParentExperimentIds | ParentProjectLogIds>;
  private readonly rowIds: {
    id: string;
    span_id: string;
    root_span_id: string;
    [PARENT_ID_FIELD]?: string;
  };

  public kind: "span" = "span";

  // root_experiment should only be specified for a root span. parent_span
  // should only be specified for non-root spans.
  constructor(
    args: {
      parentIds: LazyValue<ParentExperimentIds | ParentProjectLogIds>;
      bgLogger: BackgroundLogger;
    } & Omit<StartSpanArgs, "parentId"> &
      (
        | {
            parentSpanInfo?: { span_id: string; root_span_id: string };
          }
        | {
            parentId?: string;
          }
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
      },
      context: { ...callerLocation },
      span_attributes: {
        ...args.spanAttributes,
        name,
        exec_counter: executionCounter++,
      },
      created: new Date().toISOString(),
    };

    this.parentIds = args.parentIds;

    const id = args.event?.id ?? uuidv4();
    const span_id = uuidv4();
    this.rowIds = {
      id,
      span_id,
      root_span_id:
        "parentSpanInfo" in args && args.parentSpanInfo?.root_span_id
          ? args.parentSpanInfo.root_span_id
          : span_id,
    };
    if ("parentSpanInfo" in args && args.parentSpanInfo?.span_id) {
      this.internalData.span_parents = [args.parentSpanInfo.span_id];
    } else if ("parentId" in args && !isEmpty(args.parentId)) {
      this.rowIds[PARENT_ID_FIELD] = args.parentId;
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

    const parentIds = new LazyValue(async () => {
      const { kind, ...ids } = await this.parentIds.get();
      return ids;
    });

    const record = new LazyValue(async () => {
      return {
        ...sanitizedAndInternalData,
        ...this.rowIds,
        ...(await parentIds.get()),
        [IS_MERGE_FIELD]: this.isMerge,
      };
    });
    this.bgLogger.log([record]);
  }

  public logFeedback(event: Omit<LogFeedbackFullArgs, "id">): void {
    logFeedbackImpl(this.bgLogger, this.parentIds, {
      ...event,
      id: this.id,
    });
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

  public startSpan(args?: Omit<StartSpanArgs, "parent_id">): Span {
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
 * A dataset is a collection of records, such as model inputs and expected outputs, which represent
 * data you can use to evaluate and fine-tune models. You can log production data to datasets,
 * curate them with interesting examples, edit/delete records, and run evaluations against them.
 *
 * You should not create `Dataset` objects directly. Instead, use the `braintrust.initDataset()` method.
 */
class Dataset<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET
> extends ObjectFetcher<DatasetRecord<IsLegacyDataset>> {
  private readonly lazyMetadata: LazyValue<ProjectDatasetMetadata>;
  private bgLogger: BackgroundLogger;

  constructor(
    lazyMetadata: LazyValue<ProjectDatasetMetadata>,
    pinnedVersion?: string,
    legacy?: IsLegacyDataset
  ) {
    const isLegacyDataset = (legacy ??
      DEFAULT_IS_LEGACY_DATASET) as IsLegacyDataset;
    if (isLegacyDataset) {
      console.warn(
        `Records will be fetched from this dataset in the legacy format, with the "expected" field renamed to "output". Please update your code to use "expected", and use \`braintrust.initDataset()\` with \`{ useOutput: false }\`, which will become the default in a future version of Braintrust.`
      );
    }
    super("dataset", pinnedVersion, (r: AnyDatasetRecord) =>
      ensureDatasetRecord(r, isLegacyDataset)
    );
    this.lazyMetadata = lazyMetadata;
    const logConn = new LazyValue(() =>
      this.getState().then((state) => state.logConn())
    );
    this.bgLogger = new BackgroundLogger(logConn);
  }

  public get id(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata.get()).dataset.id;
    })();
  }

  public get name(): Promise<string> {
    return (async () => {
      return (await this.lazyMetadata.get()).dataset.name;
    })();
  }

  public get project(): Promise<ObjectMetadata> {
    return (async () => {
      return (await this.lazyMetadata.get()).project;
    })();
  }

  protected async getState(): Promise<BraintrustState> {
    // Ensure the login state is populated by awaiting lazyMetadata.
    await this.lazyMetadata.get();
    return _state;
  }

  /**
   * Insert a single record to the dataset. The record will be batched and uploaded behind the scenes. If you pass in an `id`,
   * and a record with that `id` already exists, it will be overwritten (upsert).
   *
   * @param event The event to log.
   * @param event.input The argument that uniquely define an input case (an arbitrary, JSON serializable object).
   * @param event.expected The output of your application, including post-processing (an arbitrary, JSON serializable object).
   * @param event.metadata (Optional) a dictionary with additional data about the test example, model outputs, or just
   * about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the
   * `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any
   * JSON-serializable type, but its keys must be strings.
   * @param event.id (Optional) a unique identifier for the event. If you don't provide one, Braintrust will generate one for you.
   * @param event.output: (Deprecated) The output of your application. Use `expected` instead.
   * @returns The `id` of the logged record.
   */
  public insert({
    input,
    expected,
    metadata,
    id,
    output,
  }: {
    readonly input?: unknown;
    readonly expected?: unknown;
    readonly metadata?: Record<string, unknown>;
    readonly id?: string;
    readonly output?: unknown;
  }): string {
    if (metadata !== undefined) {
      for (const key of Object.keys(metadata)) {
        if (typeof key !== "string") {
          throw new Error("metadata keys must be strings");
        }
      }
    }

    if (expected && output) {
      throw new Error(
        "Only one of expected or output (deprecated) can be specified. Prefer expected."
      );
    }

    const rowId = id || uuidv4();
    const args = new LazyValue(async () => ({
      id: rowId,
      input,
      expected: expected === undefined ? output : expected,
      project_id: (await this.project).id,
      dataset_id: await this.id,
      created: new Date().toISOString(),
      metadata,
    }));

    this.bgLogger.log([args]);
    return rowId;
  }

  public delete(id: string): string {
    const args = new LazyValue(async () => ({
      id,
      project_id: (await this.project).id,
      dataset_id: await this.id,
      created: new Date().toISOString(),
      _object_delete: true,
    }));

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
    const projectUrl = `${state.appUrl}/app/${encodeURIComponent(
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

export type AnyDataset = Dataset<boolean>;

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
