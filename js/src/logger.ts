/// <reference lib="dom" />

import { v4 as uuidv4 } from "uuid";

import {
  _urljoin,
  AnyDatasetRecord,
  AUDIT_METADATA_FIELD,
  AUDIT_SOURCE_FIELD,
  BackgroundLogEvent,
  batchItems,
  constructJsonArray,
  DatasetRecord,
  DEFAULT_IS_LEGACY_DATASET,
  ensureDatasetRecord,
  ExperimentEvent,
  ExperimentLogFullArgs,
  ExperimentLogPartialArgs,
  IdField,
  IS_MERGE_FIELD,
  LogFeedbackFullArgs,
  mergeDicts,
  mergeGitMetadataSettings,
  mergeRowBatch,
  SanitizedExperimentLogPartialArgs,
  SpanComponentsV3,
  SpanObjectTypeV3,
  spanObjectTypeV3ToString,
  SpanType,
  SpanTypeAttribute,
  TRANSACTION_ID_FIELD,
  TransactionId,
  VALID_SOURCES,
  isArray,
  isObject,
} from "@braintrust/core";
import {
  AnyModelParam,
  AttachmentReference,
  BraintrustAttachmentReference,
  ExternalAttachmentReference,
  attachmentReferenceSchema,
  ModelParams,
  responseFormatJsonSchemaSchema,
  AttachmentStatus,
  attachmentStatusSchema,
  BRAINTRUST_ATTACHMENT,
  BRAINTRUST_PARAMS,
  GitMetadataSettings,
  gitMetadataSettingsSchema,
  Message,
  OpenAIMessage,
  PromptData,
  promptDataSchema,
  Prompt as PromptRow,
  promptSchema,
  PromptSessionEvent,
  RepoInfo,
  Tools,
  toolsSchema,
  EXTERNAL_ATTACHMENT,
  PromptBlockData,
} from "@braintrust/core/typespecs";
import { waitUntil } from "@vercel/functions";
import Mustache, { Context } from "mustache";
import { z, ZodError } from "zod";
import {
  BraintrustStream,
  createFinalValuePassThroughStream,
  devNullWritableStream,
} from "./functions/stream";
import iso, { IsoAsyncLocalStorage } from "./isomorph";
import { canUseDiskCache, DiskCache } from "./prompt-cache/disk-cache";
import { LRUCache } from "./prompt-cache/lru-cache";
import { PromptCache } from "./prompt-cache/prompt-cache";
import {
  addAzureBlobHeaders,
  getCurrentUnixTimestamp,
  GLOBAL_PROJECT,
  isEmpty,
  LazyValue,
  SyncLazyValue,
  runCatchFinally,
} from "./util";
import { lintTemplate } from "./mustache-utils";

export type SetCurrentArg = { setCurrent?: boolean };

type StartSpanEventArgs = ExperimentLogPartialArgs & Partial<IdField>;

export type StartSpanArgs = {
  name?: string;
  type?: SpanType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spanAttributes?: Record<any, any>;
  startTime?: number;
  parent?: string;
  event?: StartSpanEventArgs;
  propagatedEvent?: StartSpanEventArgs;
};

export type EndSpanArgs = {
  endTime?: number;
};

export interface Exportable {
  /**
   * Return a serialized representation of the object that can be used to start subspans in other places. See {@link Span.traced} for more details.
   */
  export(): Promise<string>;
}

/**
 * A Span encapsulates logged data and metrics for a unit of work. This interface is shared by all span implementations.
 *
 * We suggest using one of the various `traced` methods, instead of creating Spans directly. See {@link Span.traced} for full details.
 */
export interface Span extends Exportable {
  /**
   * Row ID of the span.
   */
  id: string;

  /**
   * Span ID of the span.
   */
  spanId: string;

  /**
   * Root span ID of the span.
   */
  rootSpanId: string;

  /**
   * Parent span IDs of the span.
   */
  spanParents: string[];

  /**
   * Incrementally update the current span with new data. The event will be batched and uploaded behind the scenes.
   *
   * @param event: Data to be logged. See {@link Experiment.log} for full details.
   */
  log(event: ExperimentLogPartialArgs): void;

  /**
   * Add feedback to the current span. Unlike `Experiment.logFeedback` and `Logger.logFeedback`, this method does not accept an id parameter, because it logs feedback to the current span.
   *
   * @param event: Data to be logged. See {@link Experiment.logFeedback} for full details.
   */
  logFeedback(event: Omit<LogFeedbackFullArgs, "id">): void;

  /**
   * Create a new span and run the provided callback. This is useful if you want to log more detailed trace information beyond the scope of a single log event. Data logged over several calls to `Span.log` will be merged into one logical row.
   *
   * Spans created within `traced` are ended automatically. By default, the span is marked as current, so they can be accessed using `braintrust.currentSpan`.
   *
   * @param callback The function to be run under the span context.
   * @param args.name Optional name of the span. If not provided, a name will be inferred from the call stack.
   * @param args.type Optional type of the span. If not provided, the type will be unset.
   * @param args.span_attributes Optional additional attributes to attach to the span, such as a type name.
   * @param args.start_time Optional start time of the span, as a timestamp in seconds.
   * @param args.setCurrent If true (the default), the span will be marked as the currently-active span for the duration of the callback.
   * @param args.parent Optional parent info string for the span. The string can be generated from `[Span,Experiment,Logger].export`. If not provided, the current span will be used (depending on context). This is useful for adding spans to an existing trace.
   * @param args.event Data to be logged. See {@link Experiment.log} for full details.
   * @returns The result of running `callback`.
   */
  traced<R>(
    callback: (span: Span) => R,
    args?: StartSpanArgs & SetCurrentArg,
  ): R;

  /**
   * Lower-level alternative to `traced`. This allows you to start a span yourself, and can be useful in situations
   * where you cannot use callbacks. However, spans started with `startSpan` will not be marked as the "current span",
   * so `currentSpan()` and `traced()` will be no-ops. If you want to mark a span as current, use `traced` instead.
   *
   * See {@link Span.traced} for full details.
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
   * Serialize the identifiers of this span. The return value can be used to
   * identify this span when starting a subspan elsewhere, such as another
   * process or service, without needing to access this `Span` object. See the
   * parameters of {@link Span.startSpan} for usage details.
   *
   * Callers should treat the return value as opaque. The serialization format
   * may change from time to time. If parsing is needed, use
   * `SpanComponentsV3.fromStr`.
   *
   * @returns Serialized representation of this span's identifiers.
   */
  export(): Promise<string>;

  /**
   * Format a permalink to the Braintrust application for viewing this span.
   *
   * Links can be generated at any time, but they will only become viewable
   * after the span and its root have been flushed to the server and ingested.
   *
   * This function can block resolving data with the server. For production
   * applications it's preferable to call {@link Span.link} instead.
   *
   * @returns A promise which resolves to a permalink to the span.
   */
  permalink(): Promise<string>;

  /**
   * Format a link to the Braintrust application for viewing this span.
   *
   * Links can be generated at any time, but they will only become viewable
   * after the span and its root have been flushed to the server and ingested.
   *
   * There are some conditions when a Span doesn't have enough information
   * to return a stable link (e.g. during an unresolved experiment). In this case
   * or if there's an error generating link, we'll return a placeholder link.
   *
   * @returns A link to the span.
   */
  link(): string;

  /**
   * Flush any pending rows to the server.
   */
  flush(): Promise<void>;

  /**
   * Alias for `end`.
   */
  close(args?: EndSpanArgs): number;

  /**
   * Set the span's name, type, or other attributes after it's created.
   */
  setAttributes(args: Omit<StartSpanArgs, "event">): void;

  /**
   * Start a span with a specific id and parent span ids.
   */
  startSpanWithParents(
    spanId: string,
    spanParents: string[],
    args?: StartSpanArgs,
  ): Span;

  /*
   * Gets the span's `state` value, which is usually the global logging state (this is
   * for very advanced purposes only)
   */
  state(): BraintrustState;

  // For type identification.
  kind: "span";
}

/**
 * A fake implementation of the Span API which does nothing. This can be used as the default span.
 */
export class NoopSpan implements Span {
  public id: string;
  public spanId: string;
  public rootSpanId: string;
  public spanParents: string[];

  public kind: "span" = "span";

  constructor() {
    this.id = "";
    this.spanId = "";
    this.rootSpanId = "";
    this.spanParents = [];
  }

  public log(_: ExperimentLogPartialArgs) {}

  public logFeedback(_event: Omit<LogFeedbackFullArgs, "id">) {}

  public traced<R>(
    callback: (span: Span) => R,
    _1?: StartSpanArgs & SetCurrentArg,
  ): R {
    return callback(this);
  }

  public startSpan(_1?: StartSpanArgs) {
    return this;
  }

  public end(args?: EndSpanArgs): number {
    return args?.endTime ?? getCurrentUnixTimestamp();
  }

  public async export(): Promise<string> {
    return "";
  }

  public async permalink(): Promise<string> {
    return NOOP_SPAN_PERMALINK;
  }

  public link(): string {
    return NOOP_SPAN_PERMALINK;
  }

  public async flush(): Promise<void> {}

  public close(args?: EndSpanArgs): number {
    return this.end(args);
  }

  public setAttributes(_args: Omit<StartSpanArgs, "event">) {}

  public startSpanWithParents(
    _spanId: string,
    _spanParents: string[],
    _args?: StartSpanArgs,
  ): Span {
    return this;
  }

  public state() {
    return _internalGetGlobalState();
  }
}

export const NOOP_SPAN = new NoopSpan();
export const NOOP_SPAN_PERMALINK = "https://braintrust.dev/noop-span";

// In certain situations (e.g. the cli), we want separately-compiled modules to
// use the same state as the toplevel module. This global variable serves as a
// mechanism to propagate the initial state from some toplevel creator.
declare global {
  var __inherited_braintrust_state: BraintrustState;
}

const loginSchema = z.strictObject({
  appUrl: z.string(),
  appPublicUrl: z.string(),
  orgName: z.string(),
  apiUrl: z.string(),
  proxyUrl: z.string(),
  loginToken: z.string(),
  orgId: z.string().nullish(),
  gitMetadataSettings: gitMetadataSettingsSchema.nullish(),
});

export type SerializedBraintrustState = z.infer<typeof loginSchema>;

let stateNonce = 0;

export class BraintrustState {
  public id: string;
  public currentExperiment: Experiment | undefined;
  // Note: the value of IsAsyncFlush doesn't really matter here, since we
  // (safely) dynamically cast it whenever retrieving the logger.
  public currentLogger: Logger<false> | undefined;
  public currentParent: IsoAsyncLocalStorage<string>;
  public currentSpan: IsoAsyncLocalStorage<Span>;
  // Any time we re-log in, we directly update the apiConn inside the logger.
  // This is preferable to replacing the whole logger, which would create the
  // possibility of multiple loggers floating around, which may not log in a
  // deterministic order.
  private _bgLogger: SyncLazyValue<HTTPBackgroundLogger>;
  private _overrideBgLogger: BackgroundLogger | null = null;

  public appUrl: string | null = null;
  public appPublicUrl: string | null = null;
  public loginToken: string | null = null;
  public orgId: string | null = null;
  public orgName: string | null = null;
  public apiUrl: string | null = null;
  public proxyUrl: string | null = null;
  public loggedIn: boolean = false;
  public gitMetadataSettings?: GitMetadataSettings;

  public fetch: typeof globalThis.fetch = globalThis.fetch;
  private _appConn: HTTPConnection | null = null;
  private _apiConn: HTTPConnection | null = null;
  private _proxyConn: HTTPConnection | null = null;

  public promptCache: PromptCache;

  constructor(private loginParams: LoginOptions) {
    this.id = `${new Date().toLocaleString()}-${stateNonce++}`; // This is for debugging. uuidv4() breaks on platforms like Cloudflare.
    this.currentExperiment = undefined;
    this.currentLogger = undefined;
    this.currentParent = iso.newAsyncLocalStorage();
    this.currentSpan = iso.newAsyncLocalStorage();

    if (loginParams.fetch) {
      this.fetch = loginParams.fetch;
    }

    const defaultGetLogConn = async () => {
      await this.login({});
      return this.apiConn();
    };
    this._bgLogger = new SyncLazyValue(
      () =>
        new HTTPBackgroundLogger(new LazyValue(defaultGetLogConn), loginParams),
    );

    this.resetLoginInfo();

    const memoryCache = new LRUCache<string, Prompt>({
      max: Number(iso.getEnv("BRAINTRUST_PROMPT_CACHE_MEMORY_MAX")) ?? 1 << 10,
    });
    const diskCache = canUseDiskCache()
      ? new DiskCache<Prompt>({
          cacheDir:
            iso.getEnv("BRAINTRUST_PROMPT_CACHE_DIR") ??
            `${iso.getEnv("HOME") ?? iso.homedir!()}/.braintrust/prompt_cache`,
          max:
            Number(iso.getEnv("BRAINTRUST_PROMPT_CACHE_DISK_MAX")) ?? 1 << 20,
        })
      : undefined;
    this.promptCache = new PromptCache({ memoryCache, diskCache });
  }

  public resetLoginInfo() {
    this.appUrl = null;
    this.appPublicUrl = null;
    this.loginToken = null;
    this.orgId = null;
    this.orgName = null;
    this.apiUrl = null;
    this.proxyUrl = null;
    this.loggedIn = false;
    this.gitMetadataSettings = undefined;

    this._appConn = null;
    this._apiConn = null;
    this._proxyConn = null;
  }

  public copyLoginInfo(other: BraintrustState) {
    this.appUrl = other.appUrl;
    this.appPublicUrl = other.appPublicUrl;
    this.loginToken = other.loginToken;
    this.orgId = other.orgId;
    this.orgName = other.orgName;
    this.apiUrl = other.apiUrl;
    this.proxyUrl = other.proxyUrl;
    this.loggedIn = other.loggedIn;
    this.gitMetadataSettings = other.gitMetadataSettings;

    this._appConn = other._appConn;
    this._apiConn = other._apiConn;
    this.loginReplaceApiConn(this.apiConn());
    this._proxyConn = other._proxyConn;
  }

  public serialize(): SerializedBraintrustState {
    if (!this.loggedIn) {
      throw new Error(
        "Cannot serialize BraintrustState without being logged in",
      );
    }

    if (
      !this.appUrl ||
      !this.appPublicUrl ||
      !this.apiUrl ||
      !this.proxyUrl ||
      !this.orgName ||
      !this.loginToken ||
      !this.loggedIn
    ) {
      throw new Error(
        "Cannot serialize BraintrustState without all login attributes",
      );
    }

    return {
      appUrl: this.appUrl,
      appPublicUrl: this.appPublicUrl,
      loginToken: this.loginToken,
      orgId: this.orgId,
      orgName: this.orgName,
      apiUrl: this.apiUrl,
      proxyUrl: this.proxyUrl,
      gitMetadataSettings: this.gitMetadataSettings,
    };
  }

  static deserialize(
    serialized: unknown,
    opts?: LoginOptions,
  ): BraintrustState {
    const serializedParsed = loginSchema.safeParse(serialized);
    if (!serializedParsed.success) {
      throw new Error(
        `Cannot deserialize BraintrustState: ${serializedParsed.error.message}`,
      );
    }
    const state = new BraintrustState({ ...opts });
    for (const key of Object.keys(loginSchema.shape)) {
      (state as any)[key] = (serializedParsed.data as any)[key];
    }

    if (!state.loginToken) {
      throw new Error(
        "Cannot deserialize BraintrustState without a login token",
      );
    }

    state.apiConn().set_token(state.loginToken);
    state.apiConn().make_long_lived();
    state.appConn().set_token(state.loginToken);
    if (state.proxyUrl) {
      state.proxyConn().make_long_lived();
      state.proxyConn().set_token(state.loginToken);
    }

    state.loggedIn = true;
    state.loginReplaceApiConn(state.apiConn());

    return state;
  }

  public setFetch(fetch: typeof globalThis.fetch) {
    this.loginParams.fetch = fetch;
    this.fetch = fetch;
    this._apiConn?.setFetch(fetch);
    this._appConn?.setFetch(fetch);
  }

  public async login(loginParams: LoginOptions & { forceLogin?: boolean }) {
    if (this.apiUrl && !loginParams.forceLogin) {
      return;
    }
    const newState = await loginToState({
      ...this.loginParams,
      ...Object.fromEntries(
        Object.entries(loginParams).filter(([k, v]) => !isEmpty(v)),
      ),
    });
    this.copyLoginInfo(newState);
  }

  public appConn(): HTTPConnection {
    if (!this._appConn) {
      if (!this.appUrl) {
        throw new Error("Must initialize appUrl before requesting appConn");
      }
      this._appConn = new HTTPConnection(this.appUrl, this.fetch);
    }
    return this._appConn!;
  }

  public apiConn(): HTTPConnection {
    if (!this._apiConn) {
      if (!this.apiUrl) {
        throw new Error("Must initialize apiUrl before requesting apiConn");
      }
      this._apiConn = new HTTPConnection(this.apiUrl, this.fetch);
    }
    return this._apiConn!;
  }

  public proxyConn(): HTTPConnection {
    if (!this.proxyUrl) {
      return this.apiConn();
    }
    if (!this._proxyConn) {
      if (!this.proxyUrl) {
        throw new Error("Must initialize proxyUrl before requesting proxyConn");
      }
      this._proxyConn = new HTTPConnection(this.proxyUrl, this.fetch);
    }
    return this._proxyConn!;
  }

  public bgLogger(): BackgroundLogger {
    if (this._overrideBgLogger) {
      return this._overrideBgLogger;
    }
    return this._bgLogger.get();
  }

  public httpLogger(): HTTPBackgroundLogger {
    // this is called for configuration in some end-to-end tests so
    // expose the http bg logger here.
    return this._bgLogger.get() as HTTPBackgroundLogger;
  }

  public setOverrideBgLogger(logger: BackgroundLogger | null) {
    this._overrideBgLogger = logger;
  }

  // Should only be called by the login function.
  public loginReplaceApiConn(apiConn: HTTPConnection) {
    this._bgLogger.get().internalReplaceApiConn(apiConn);
  }

  public disable() {
    this._bgLogger.get().disable();
  }
}

let _globalState: BraintrustState;

// Return a TestBackgroundLogger that will intercept logs before they are sent to the server.
// Used for testing only.
function useTestBackgroundLogger(): TestBackgroundLogger {
  const state = _internalGetGlobalState();
  if (!state) {
    throw new Error("global state not set yet");
  }

  const logger = new TestBackgroundLogger();
  state.setOverrideBgLogger(logger);
  return logger;
}

function clearTestBackgroundLogger() {
  _internalGetGlobalState()?.setOverrideBgLogger(null);
}

/**
 * This function should be invoked exactly once after configuring the `iso`
 * object based on the platform. See js/src/node.ts for an example.
 * @internal
 */
export function _internalSetInitialState() {
  if (_globalState) {
    throw new Error("Cannot set initial state more than once");
  }
  _globalState =
    globalThis.__inherited_braintrust_state ||
    new BraintrustState({
      /*empty login options*/
    });
}
/**
 * @internal
 */
export const _internalGetGlobalState = () => _globalState;

export class FailedHTTPResponse extends Error {
  public status: number;
  public text: string;
  public data: string;

  constructor(status: number, text: string, data: string) {
    super(`${status}: ${text} (${data})`);
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
      await resp.text(),
    );
  }
}

class HTTPConnection {
  base_url: string;
  token: string | null;
  headers: Record<string, string>;
  fetch: typeof globalThis.fetch;

  constructor(base_url: string, fetch: typeof globalThis.fetch) {
    this.base_url = base_url;
    this.token = null;
    this.headers = {};

    this._reset();
    this.fetch = fetch;
  }

  public setFetch(fetch: typeof globalThis.fetch) {
    this.fetch = fetch;
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
    params:
      | Record<string, string | string[] | undefined>
      | undefined = undefined,
    config?: RequestInit,
  ) {
    const { headers, ...rest } = config || {};
    const url = new URL(_urljoin(this.base_url, path));
    url.search = new URLSearchParams(
      params
        ? Object.entries(params)
            .filter(([_, v]) => v !== undefined)
            .flatMap(([k, v]) =>
              v !== undefined
                ? typeof v === "string"
                  ? [[k, v]]
                  : v.map((x) => [k, x])
                : [],
            )
        : [],
    ).toString();

    // On platforms like Cloudflare, we lose "this" when we make an async call,
    // so we need to bind it again.
    const this_fetch = this.fetch;
    const this_headers = this.headers;
    return await checkResponse(
      // Using toString() here makes it work with isomorphic fetch
      await this_fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          ...this_headers,
          ...headers,
        },
        keepalive: true,
        ...rest,
      }),
    );
  }

  async post(
    path: string,
    params?: Record<string, unknown> | string,
    config?: RequestInit,
  ) {
    const { headers, ...rest } = config || {};
    // On platforms like Cloudflare, we lose "this" when we make an async call,
    // so we need to bind it again.
    const this_fetch = this.fetch;
    const this_base_url = this.base_url;
    const this_headers = this.headers;

    return await checkResponse(
      await this_fetch(_urljoin(this_base_url, path), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...this_headers,
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
      }),
    );
  }

  async get_json(
    object_type: string,
    args: Record<string, string | string[] | undefined> | undefined = undefined,
    retries: number = 0,
  ) {
    const tries = retries + 1;
    for (let i = 0; i < tries; i++) {
      try {
        const resp = await this.get(`${object_type}`, args);
        return await resp.json();
      } catch (e) {
        if (i < tries - 1) {
          console.log(
            `Retrying API request ${object_type} ${JSON.stringify(args)} ${
              (e as any).status
            } ${(e as any).text}`,
          );
          continue;
        }
        throw e;
      }
    }
  }

  async post_json(
    object_type: string,
    args: Record<string, unknown> | string | undefined = undefined,
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
  computeMetadataArgs?: Record<string, any>;
}

export type PromiseUnless<B, R> = B extends true ? R : Promise<Awaited<R>>;

export interface AttachmentParams {
  data: string | Blob | ArrayBuffer;
  filename: string;
  contentType: string;
  state?: BraintrustState;
}

export interface ExternalAttachmentParams {
  url: string;
  filename: string;
  contentType: string;
  state?: BraintrustState;
}

export abstract class BaseAttachment {
  readonly reference!: AttachmentReference;
  abstract upload(): Promise<AttachmentStatus>;
  abstract data(): Promise<Blob>;
  abstract debugInfo(): Record<string, unknown>;
}

/**
 * Represents an attachment to be uploaded and the associated metadata.
 * `Attachment` objects can be inserted anywhere in an event, allowing you to
 * log arbitrary file data. The SDK will asynchronously upload the file to
 * object storage and replace the `Attachment` object with an
 * `AttachmentReference`.
 */
export class Attachment extends BaseAttachment {
  /**
   * The object that replaces this `Attachment` at upload time.
   */
  readonly reference: BraintrustAttachmentReference;

  private readonly uploader: LazyValue<AttachmentStatus>;
  private readonly _data: LazyValue<Blob>;
  private readonly state?: BraintrustState;
  // For debug logging only.
  private readonly dataDebugString: string;

  /**
   * Construct an attachment.
   *
   * @param param A parameter object with:
   *
   * `data`: A string representing the path of the file on disk, or a
   * `Blob`/`ArrayBuffer` with the file's contents. The caller is responsible
   * for ensuring the file/blob/buffer is not modified until upload is complete.
   *
   * `filename`: The desired name of the file in Braintrust after uploading.
   * This parameter is for visualization purposes only and has no effect on
   * attachment storage.
   *
   * `contentType`: The MIME type of the file.
   *
   * `state`: (Optional) For internal use.
   */
  constructor({ data, filename, contentType, state }: AttachmentParams) {
    super();
    this.reference = {
      type: BRAINTRUST_ATTACHMENT,
      filename,
      content_type: contentType,
      key: newId(),
    };
    this.state = state;
    this.dataDebugString = typeof data === "string" ? data : "<in-memory data>";

    this._data = this.initData(data);
    this.uploader = this.initUploader();
  }

  /**
   * On first access, (1) reads the attachment from disk if needed, (2)
   * authenticates with the data plane to request a signed URL, (3) uploads to
   * object store, and (4) updates the attachment.
   *
   * @returns The attachment status.
   */
  async upload() {
    return await this.uploader.get();
  }

  /**
   * The attachment contents. This is a lazy value that will read the attachment contents from disk or memory on first access.
   */
  async data() {
    return this._data.get();
  }

  /**
   * A human-readable description for logging and debugging.
   *
   * @returns The debug object. The return type is not stable and may change in
   * a future release.
   */
  debugInfo(): Record<string, unknown> {
    return {
      inputData: this.dataDebugString,
      reference: this.reference,
      state: this.state,
    };
  }

  private initUploader(): LazyValue<AttachmentStatus> {
    const doUpload = async (conn: HTTPConnection, orgId: string) => {
      const requestParams = {
        key: this.reference.key,
        filename: this.reference.filename,
        content_type: this.reference.content_type,
        org_id: orgId,
      };
      const [metadataPromiseResult, dataPromiseResult] =
        await Promise.allSettled([
          conn.post("/attachment", requestParams),
          this._data.get(),
        ]);
      if (metadataPromiseResult.status === "rejected") {
        const errorStr = JSON.stringify(metadataPromiseResult.reason);
        throw new Error(
          `Failed to request signed URL from API server: ${errorStr}`,
        );
      }
      if (dataPromiseResult.status === "rejected") {
        const errorStr = JSON.stringify(dataPromiseResult.reason);
        throw new Error(`Failed to read file: ${errorStr}`);
      }
      const metadataResponse = metadataPromiseResult.value;
      const data = dataPromiseResult.value;

      let signedUrl: string | undefined;
      let headers: Record<string, string>;
      try {
        ({ signedUrl, headers } = z
          .object({
            signedUrl: z.string().url(),
            headers: z.record(z.string()),
          })
          .parse(await metadataResponse.json()));
      } catch (error) {
        if (error instanceof ZodError) {
          const errorStr = JSON.stringify(error.flatten());
          throw new Error(`Invalid response from API server: ${errorStr}`);
        }
        throw error;
      }

      addAzureBlobHeaders(headers, signedUrl);

      // TODO multipart upload.
      let objectStoreResponse: Response | undefined;
      try {
        objectStoreResponse = await checkResponse(
          await fetch(signedUrl, {
            method: "PUT",
            headers,
            body: data,
          }),
        );
      } catch (error) {
        if (error instanceof FailedHTTPResponse) {
          throw new Error(
            `Failed to upload attachment to object store: ${error.status} ${error.text} ${error.data}`,
          );
        }
        throw error;
      }

      return { signedUrl, metadataResponse, objectStoreResponse };
    };

    // Catches error messages and updates the attachment status.
    const errorWrapper = async () => {
      const status: AttachmentStatus = { upload_status: "done" };

      const state = this.state ?? _globalState;
      await state.login({});

      const conn = state.apiConn();
      const orgId = state.orgId ?? "";

      try {
        await doUpload(conn, orgId);
      } catch (error) {
        status.upload_status = "error";
        status.error_message =
          error instanceof Error ? error.message : JSON.stringify(error);
      }

      const requestParams = {
        key: this.reference.key,
        org_id: orgId,
        status,
      };
      const statusResponse = await conn.post(
        "/attachment/status",
        requestParams,
      );
      if (!statusResponse.ok) {
        const errorStr = JSON.stringify(statusResponse);
        throw new Error(`Couldn't log attachment status: ${errorStr}`);
      }

      return status;
    };

    return new LazyValue(errorWrapper);
  }

  private initData(data: string | Blob | ArrayBuffer): LazyValue<Blob> {
    if (typeof data === "string") {
      const readFile = iso.readFile;
      if (!readFile) {
        throw new Error(
          `This platform does not support reading the filesystem. Construct the Attachment
with a Blob/ArrayBuffer, or run the program on Node.js.`,
        );
      }
      // This could stream the file in the future.
      return new LazyValue(async () => new Blob([await readFile(data)]));
    } else {
      return new LazyValue(async () => new Blob([data]));
    }
  }
}

/**
 * Represents an attachment that resides in an external object store and the associated metadata.
 *
 * `ExternalAttachment` objects can be inserted anywhere in an event, similar to
 * `Attachment` objects, but they reference files that already exist in an external
 * object store rather than requiring upload. The SDK will replace the `ExternalAttachment`
 * object with an `AttachmentReference` during logging.
 */
export class ExternalAttachment extends BaseAttachment {
  /**
   * The object that replaces this `ExternalAttachment` at upload time.
   */
  readonly reference: ExternalAttachmentReference;

  private readonly _data: LazyValue<Blob>;
  private readonly state?: BraintrustState;

  /**
   * Construct an external attachment.
   *
   * @param param A parameter object with:
   *
   * `url`: The fully qualified URL of the file in the external object store.
   *
   * `filename`: The desired name of the file in Braintrust after uploading.
   * This parameter is for visualization purposes only and has no effect on
   * attachment storage.
   *
   * `contentType`: The MIME type of the file.
   *
   * `state`: (Optional) For internal use.
   */
  constructor({ url, filename, contentType, state }: ExternalAttachmentParams) {
    super();
    this.reference = {
      type: EXTERNAL_ATTACHMENT,
      filename,
      content_type: contentType,
      url,
    };

    this._data = this.initData();
  }

  /**
   * For ExternalAttachment, this is a no-op since the data already resides
   * in the external object store. It marks the attachment as already uploaded.
   *
   * @returns The attachment status, which will always indicate success.
   */
  async upload() {
    return { upload_status: "done" as const };
  }

  /**
   * The attachment contents. This is a lazy value that will read the attachment contents from the external object store on first access.
   */
  async data() {
    return this._data.get();
  }

  /**
   * A human-readable description for logging and debugging.
   *
   * @returns The debug object. The return type is not stable and may change in
   * a future release.
   */
  debugInfo(): Record<string, unknown> {
    return {
      url: this.reference.url,
      reference: this.reference,
      state: this.state,
    };
  }

  private initData(): LazyValue<Blob> {
    return new LazyValue(async () => {
      const readonly = new ReadonlyAttachment(this.reference, this.state);
      return await readonly.data();
    });
  }
}

const attachmentMetadataSchema = z.object({
  downloadUrl: z.string(),
  status: attachmentStatusSchema,
});

type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;

/**
 * A readonly alternative to `Attachment`, which can be used for fetching
 * already-uploaded Attachments.
 */
export class ReadonlyAttachment {
  /**
   * Attachment metadata.
   */
  readonly reference: AttachmentReference;

  private readonly _data: LazyValue<Blob>;
  private readonly state?: BraintrustState;

  /**
   * Construct a ReadonlyAttachment.
   *
   * @param reference The `AttachmentReference` that should be read by the
   * `ReadonlyAttachment` object.
   * @param state (Optional) For internal use.
   * @returns The new `ReadonlyAttachment` object.
   */
  constructor(reference: AttachmentReference, state?: BraintrustState) {
    this.reference = reference;
    this.state = state;
    this._data = this.initDownloader();
  }

  /**
   * The attachment contents. This is a lazy value that will read the attachment
   * contents from the object store on first access.
   */
  async data() {
    return this._data.get();
  }

  /**
   * Fetch the attachment metadata, which includes a downloadUrl and a status.
   * This will re-fetch the status each time in case it changes over time.
   */
  async metadata(): Promise<AttachmentMetadata> {
    const state = this.state ?? _globalState;
    await state.login({});

    const params: Record<string, string> = {
      filename: this.reference.filename,
      content_type: this.reference.content_type,
      org_id: state.orgId || "",
    };
    if (this.reference.type === "braintrust_attachment") {
      params.key = this.reference.key;
    } else if (this.reference.type === "external_attachment") {
      params.url = this.reference.url;
    }
    const resp = await state.apiConn().get("/attachment", params);
    if (!resp.ok) {
      const errorStr = JSON.stringify(resp);
      throw new Error(`Invalid response from API server: ${errorStr}`);
    }

    return attachmentMetadataSchema.parse(await resp.json());
  }

  /**
   * Fetch the attachment upload status. This will re-fetch the status each time
   * in case it changes over time.
   */
  async status(): Promise<AttachmentStatus> {
    return (await this.metadata()).status;
  }

  private initDownloader(): LazyValue<Blob> {
    const download = async () => {
      const { downloadUrl, status } = await this.metadata();

      if (status.upload_status !== "done") {
        throw new Error(
          `Expected attachment status "done", got "${status.upload_status}"`,
        );
      }

      const objResponse = await fetch(downloadUrl);
      if (objResponse.status !== 200) {
        const error = await objResponse.text();
        throw new Error(`Couldn't download attachment: ${error}`);
      }

      return await objResponse.blob();
    };

    return new LazyValue(download);
  }
}

function logFeedbackImpl(
  state: BraintrustState,
  parentObjectType: SpanObjectTypeV3,
  parentObjectId: LazyValue<string>,
  {
    id,
    expected,
    scores,
    metadata: inputMetadata,
    tags,
    comment,
    source: inputSource,
  }: LogFeedbackFullArgs,
) {
  const source = inputSource ?? "external";

  if (!VALID_SOURCES.includes(source)) {
    throw new Error(`source must be one of ${VALID_SOURCES}`);
  }

  if (
    isEmpty(scores) &&
    isEmpty(expected) &&
    isEmpty(tags) &&
    isEmpty(comment)
  ) {
    throw new Error(
      "At least one of scores, expected, tags, or comment must be specified",
    );
  }

  const validatedEvent = validateAndSanitizeExperimentLogPartialArgs({
    scores,
    metadata: inputMetadata,
    expected,
    tags,
  });

  let { metadata, ...updateEvent } = deepCopyEvent(validatedEvent);
  updateEvent = Object.fromEntries(
    Object.entries(updateEvent).filter(([_, v]) => !isEmpty(v)),
  );

  const parentIds = async () =>
    new SpanComponentsV3({
      object_type: parentObjectType,
      object_id: await parentObjectId.get(),
    }).objectIdFields();

  if (Object.keys(updateEvent).length > 0) {
    const record = new LazyValue(async () => {
      return {
        id,
        ...updateEvent,
        ...(await parentIds()),
        [AUDIT_SOURCE_FIELD]: source,
        [AUDIT_METADATA_FIELD]: metadata,
        [IS_MERGE_FIELD]: true,
      };
    });
    state.bgLogger().log([record]);
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
        ...(await parentIds()),
        [AUDIT_SOURCE_FIELD]: source,
        [AUDIT_METADATA_FIELD]: metadata,
      };
    });
    state.bgLogger().log([record]);
  }
}

function updateSpanImpl({
  state,
  parentObjectType,
  parentObjectId,
  id,
  event,
}: {
  state: BraintrustState;
  parentObjectType: SpanObjectTypeV3;
  parentObjectId: LazyValue<string>;
  id: string;
  event: Omit<Partial<ExperimentEvent>, "id">;
}): void {
  const updateEvent = deepCopyEvent(
    validateAndSanitizeExperimentLogPartialArgs({
      id,
      ...event,
    } as Partial<ExperimentEvent>),
  );

  const parentIds = async () =>
    new SpanComponentsV3({
      object_type: parentObjectType,
      object_id: await parentObjectId.get(),
    }).objectIdFields();

  const record = new LazyValue(async () => ({
    id,
    ...updateEvent,
    ...(await parentIds()),
    [IS_MERGE_FIELD]: true,
  }));
  state.bgLogger().log([record]);
}

/**
 * Update a span using the output of `span.export()`. It is important that you only resume updating
 * to a span once the original span has been fully written and flushed, since otherwise updates to
 * the span may conflict with the original span.
 *
 * @param exported The output of `span.export()`.
 * @param event The event data to update the span with. See {@link Experiment.log} for a full list of valid fields.
 * @param state (optional) Login state to use. If not provided, the global state will be used.
 */
export function updateSpan({
  exported,
  state,
  ...event
}: { exported: string } & Omit<Partial<ExperimentEvent>, "id"> &
  OptionalStateArg): void {
  const resolvedState = state ?? _globalState;
  const components = SpanComponentsV3.fromStr(exported);

  if (!components.data.row_id) {
    throw new Error("Exported span must have a row id");
  }

  updateSpanImpl({
    state: resolvedState,
    parentObjectType: components.data.object_type,
    parentObjectId: new LazyValue(
      spanComponentsToObjectIdLambda(resolvedState, components),
    ),
    id: components.data.row_id,
    event,
  });
}

interface ParentSpanIds {
  spanId: string;
  rootSpanId: string;
}

interface MultiParentSpanIds {
  parentSpanIds: string[];
  rootSpanId: string;
}

function spanComponentsToObjectIdLambda(
  state: BraintrustState,
  components: SpanComponentsV3,
): () => Promise<string> {
  if (components.data.object_id) {
    const ret = components.data.object_id;
    return async () => ret;
  }
  if (!components.data.compute_object_metadata_args) {
    throw new Error(
      "Impossible: must provide either objectId or computeObjectMetadataArgs",
    );
  }
  switch (components.data.object_type) {
    case SpanObjectTypeV3.EXPERIMENT:
      throw new Error(
        "Impossible: computeObjectMetadataArgs not supported for experiments",
      );
    case SpanObjectTypeV3.PLAYGROUND_LOGS:
      throw new Error(
        "Impossible: computeObjectMetadataArgs not supported for prompt sessions",
      );
    case SpanObjectTypeV3.PROJECT_LOGS:
      return async () =>
        (
          await computeLoggerMetadata(state, {
            ...components.data.compute_object_metadata_args,
          })
        ).project.id;
    default:
      const x: never = components.data.object_type;
      throw new Error(`Unknown object type: ${x}`);
  }
}

// Utility function to resolve the object ID of a SpanComponentsV3 object. This
// function may trigger a login to braintrust if the object ID is encoded
// "lazily".
export async function spanComponentsToObjectId({
  components,
  state,
}: {
  components: SpanComponentsV3;
  state?: BraintrustState;
}): Promise<string> {
  return await spanComponentsToObjectIdLambda(
    state ?? _globalState,
    components,
  )();
}

export const ERR_PERMALINK = "https://braintrust.dev/error-generating-link";

function getErrPermlink(msg: string) {
  if (msg == "") {
    return ERR_PERMALINK;
  }
  return `${ERR_PERMALINK}?msg=${encodeURIComponent(msg)}`;
}

/**
 * Format a permalink to the Braintrust application for viewing the span
 * represented by the provided `slug`.
 *
 * Links can be generated at any time, but they will only become viewable after
 * the span and its root have been flushed to the server and ingested.
 *
 * If you have a `Span` object, use {@link Span.link} instead.
 *
 * @param slug The identifier generated from {@link Span.export}.
 * @param opts Optional arguments.
 * @param opts.state The login state to use. If not provided, the global state will be used.
 * @param opts.orgName The org name to use. If not provided, the org name will be inferred from the state.
 * @param opts.appUrl The app URL to use. If not provided, the app URL will be inferred from the state.
 * @returns A permalink to the exported span.
 */
export async function permalink(
  slug: string,
  opts?: {
    state?: BraintrustState;
    orgName?: string;
    appUrl?: string;
  },
): Promise<string> {
  // Noop spans have an empty slug, so return a dummy permalink.
  if (slug === "") {
    return NOOP_SPAN_PERMALINK;
  }

  const state = opts?.state ?? _globalState;
  const getOrgName = async () => {
    if (opts?.orgName) {
      return opts.orgName;
    }
    await state.login({});
    if (!state.orgName) {
      throw new Error("provide-org-or-login"); // this is caught below
    }
    return state.orgName;
  };
  const getAppUrl = async () => {
    if (opts?.appUrl) {
      return opts.appUrl;
    }
    await state.login({});
    if (!state.appUrl) {
      throw new Error("provide-app-url-or-login"); // this is caught below
    }
    return state.appUrl;
  };

  try {
    const components = SpanComponentsV3.fromStr(slug);
    const object_type = spanObjectTypeV3ToString(components.data.object_type);
    const [orgName, appUrl, object_id] = await Promise.all([
      getOrgName(),
      getAppUrl(),
      spanComponentsToObjectId({ components, state }),
    ]);
    const id = components.data.row_id;
    if (!id) {
      throw new Error("Span slug does not refer to an individual row");
    }
    const urlParams = new URLSearchParams({ object_type, object_id, id });
    return `${appUrl}/app/${orgName}/object?${urlParams}`;
  } catch (e) {
    if (e instanceof FailedHTTPResponse) {
      return getErrPermlink(`http-error-${e.status}`);
    }
    return getErrPermlink(e instanceof Error ? e.message : String(e));
  }
}

// IMPORTANT NOTE: This function may pass arguments which override those in the
// main argument set, so if using this in a spread, like `SpanImpl({ ...args,
// ...startSpanParentArgs(...)})`, make sure to put startSpanParentArgs after
// the original argument set.
function startSpanParentArgs(args: {
  state: BraintrustState;
  parent: string | undefined;
  parentObjectType: SpanObjectTypeV3;
  parentObjectId: LazyValue<string>;
  parentComputeObjectMetadataArgs: Record<string, any> | undefined;
  parentSpanIds: ParentSpanIds | MultiParentSpanIds | undefined;
  propagatedEvent: StartSpanEventArgs | undefined;
}): {
  parentObjectType: SpanObjectTypeV3;
  parentObjectId: LazyValue<string>;
  parentComputeObjectMetadataArgs: Record<string, any> | undefined;
  parentSpanIds: ParentSpanIds | MultiParentSpanIds | undefined;
  propagatedEvent: StartSpanEventArgs | undefined;
} {
  let argParentObjectId: LazyValue<string> | undefined = undefined;
  let argParentSpanIds: ParentSpanIds | MultiParentSpanIds | undefined =
    undefined;
  let argPropagatedEvent: StartSpanEventArgs | undefined = undefined;
  if (args.parent) {
    if (args.parentSpanIds) {
      throw new Error("Cannot specify both parent and parentSpanIds");
    }
    const parentComponents = SpanComponentsV3.fromStr(args.parent);
    if (args.parentObjectType !== parentComponents.data.object_type) {
      throw new Error(
        `Mismatch between expected span parent object type ${args.parentObjectType} and provided type ${parentComponents.data.object_type}`,
      );
    }

    const parentComponentsObjectIdLambda = spanComponentsToObjectIdLambda(
      args.state,
      parentComponents,
    );
    const computeParentObjectId = async () => {
      const parentComponentsObjectId = await parentComponentsObjectIdLambda();
      if ((await args.parentObjectId.get()) !== parentComponentsObjectId) {
        throw new Error(
          `Mismatch between expected span parent object id ${await args.parentObjectId.get()} and provided id ${parentComponentsObjectId}`,
        );
      }
      return await args.parentObjectId.get();
    };
    argParentObjectId = new LazyValue(computeParentObjectId);
    if (parentComponents.data.row_id) {
      argParentSpanIds = {
        spanId: parentComponents.data.span_id,
        rootSpanId: parentComponents.data.root_span_id,
      };
    }
    argPropagatedEvent =
      args.propagatedEvent ??
      ((parentComponents.data.propagated_event ?? undefined) as
        | StartSpanEventArgs
        | undefined);
  } else {
    argParentObjectId = args.parentObjectId;
    argParentSpanIds = args.parentSpanIds;
    argPropagatedEvent = args.propagatedEvent;
  }

  return {
    parentObjectType: args.parentObjectType,
    parentObjectId: argParentObjectId,
    parentComputeObjectMetadataArgs: args.parentComputeObjectMetadataArgs,
    parentSpanIds: argParentSpanIds,
    propagatedEvent: argPropagatedEvent,
  };
}

export class Logger<IsAsyncFlush extends boolean> implements Exportable {
  private state: BraintrustState;
  private lazyMetadata: LazyValue<OrgProjectMetadata>;
  private _asyncFlush: IsAsyncFlush | undefined;
  private computeMetadataArgs: Record<string, any> | undefined;
  private lastStartTime: number;
  private lazyId: LazyValue<string>;
  private calledStartSpan: boolean;

  // For type identification.
  public kind: "logger" = "logger";

  constructor(
    state: BraintrustState,
    lazyMetadata: LazyValue<OrgProjectMetadata>,
    logOptions: LogOptions<IsAsyncFlush> = {},
  ) {
    this.lazyMetadata = lazyMetadata;
    this._asyncFlush = logOptions.asyncFlush;
    this.computeMetadataArgs = logOptions.computeMetadataArgs;
    this.lastStartTime = getCurrentUnixTimestamp();
    this.lazyId = new LazyValue(async () => await this.id);
    this.calledStartSpan = false;
    this.state = state;
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

  public get id(): Promise<string> {
    return (async () => (await this.project).id)();
  }

  private parentObjectType() {
    return SpanObjectTypeV3.PROJECT_LOGS;
  }

  /**
   * Log a single event. The event will be batched and uploaded behind the scenes if `logOptions.asyncFlush` is true.
   *
   * @param event The event to log.
   * @param event.input: (Optional) the arguments that uniquely define a user input (an arbitrary, JSON serializable object).
   * @param event.output: (Optional) the output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
   * @param event.expected: (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
   * @param event.error: (Optional) The error that occurred, if any. If you use tracing to run an experiment, errors are automatically logged when your code throws an exception.
   * @param event.scores: (Optional) a dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare logs.
   * @param event.metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
   * @param event.metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically: "start", "end".
   * @param event.id: (Optional) a unique identifier for the event. If you don't provide one, BrainTrust will generate one for you.
   * @param options Additional logging options
   * @param options.allowConcurrentWithSpans in rare cases where you need to log at the top level separately from spans on the logger elsewhere, set this to true.
   * @returns The `id` of the logged event.
   */
  public log(
    event: Readonly<StartSpanEventArgs>,
    options?: { allowConcurrentWithSpans?: boolean },
  ): PromiseUnless<IsAsyncFlush, string> {
    if (this.calledStartSpan && !options?.allowConcurrentWithSpans) {
      throw new Error(
        "Cannot run toplevel `log` method while using spans. To log to the span, call `logger.traced` and then log with `span.log`",
      );
    }

    const span = this.startSpanImpl({ startTime: this.lastStartTime, event });
    this.lastStartTime = span.end();
    const ret = span.id;
    type Ret = PromiseUnless<IsAsyncFlush, string>;
    if (this.asyncFlush === true) {
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
   * See {@link Span.traced} for full details.
   */
  public traced<R>(
    callback: (span: Span) => R,
    args?: StartSpanArgs & SetCurrentArg,
  ): PromiseUnless<IsAsyncFlush, R> {
    const { setCurrent, ...argsRest } = args ?? {};
    const span = this.startSpan(argsRest);

    const ret = runCatchFinally(
      () => {
        if (setCurrent ?? true) {
          return withCurrent(span, callback);
        } else {
          return callback(span);
        }
      },
      (e) => {
        logError(span, e);
        throw e;
      },
      () => span.end(),
    );
    type Ret = PromiseUnless<IsAsyncFlush, R>;

    if (this.asyncFlush) {
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
   * Lower-level alternative to `traced`. This allows you to start a span yourself, and can be useful in situations
   * where you cannot use callbacks. However, spans started with `startSpan` will not be marked as the "current span",
   * so `currentSpan()` and `traced()` will be no-ops. If you want to mark a span as current, use `traced` instead.
   *
   * See {@link traced} for full details.
   */
  public startSpan(args?: StartSpanArgs): Span {
    this.calledStartSpan = true;
    return this.startSpanImpl(args);
  }

  private startSpanImpl(args?: StartSpanArgs): Span {
    return new SpanImpl({
      ...args,
      // Sometimes `args` gets passed directly into this function, and it contains an undefined value for `state`.
      // To ensure that we always use this logger's state, we override the `state` argument no matter what.
      state: this.state,
      ...startSpanParentArgs({
        state: this.state,
        parent: args?.parent,
        parentObjectType: this.parentObjectType(),
        parentObjectId: this.lazyId,
        parentComputeObjectMetadataArgs: this.computeMetadataArgs,
        parentSpanIds: undefined,
        propagatedEvent: args?.propagatedEvent,
      }),
      defaultRootType: SpanTypeAttribute.TASK,
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
   * @param event.metadata (Optional) a dictionary with additional data about the feedback. If you have a `user_id`, you can log it here and access it in the Braintrust UI. Note, this metadata does not correspond to the main event itself, but rather the audit log attached to the event.
   * @param event.source (Optional) the source of the feedback. Must be one of "external" (default), "app", or "api".
   */
  public logFeedback(event: LogFeedbackFullArgs): void {
    logFeedbackImpl(this.state, this.parentObjectType(), this.lazyId, event);
  }

  /**
   * Update a span in the experiment using its id. It is important that you only update a span once the original span has been fully written and flushed,
   * since otherwise updates to the span may conflict with the original span.
   *
   * @param event The event data to update the span with. Must include `id`. See {@link Experiment.log} for a full list of valid fields.
   */
  public updateSpan(
    event: Omit<Partial<ExperimentEvent>, "id"> &
      Required<Pick<ExperimentEvent, "id">>,
  ): void {
    const { id, ...eventRest } = event;
    if (!id) {
      throw new Error("Span id is required to update a span");
    }
    updateSpanImpl({
      state: this.state,
      parentObjectType: this.parentObjectType(),
      parentObjectId: this.lazyId,
      id,
      event: eventRest,
    });
  }

  /**
   * Return a serialized representation of the logger that can be used to start subspans in other places.
   *
   * See {@link Span.startSpan} for more details.
   */
  public async export(): Promise<string> {
    // Note: it is important that the object id we are checking for
    // `has_computed` is the same as the one we are passing into the span
    // logging functions. So that if the spans actually do get logged, then this
    // `_lazy_id` object specifically will also be marked as computed.
    return new SpanComponentsV3({
      object_type: this.parentObjectType(),
      ...(this.computeMetadataArgs && !this.lazyId.hasSucceeded
        ? { compute_object_metadata_args: this.computeMetadataArgs }
        : { object_id: await this.lazyId.get() }),
    }).toStr();
  }

  /*
   * Flush any pending logs to the server.
   */
  async flush(): Promise<void> {
    return await this.state.bgLogger().flush();
  }

  get asyncFlush(): IsAsyncFlush | undefined {
    return this._asyncFlush;
  }
}

function castLogger<ToB extends boolean, FromB extends boolean>(
  logger: Logger<FromB> | undefined,
  asyncFlush?: ToB,
): Logger<ToB> | undefined {
  if (logger === undefined) return undefined;
  if (asyncFlush !== undefined && !!asyncFlush !== !!logger.asyncFlush) {
    throw new Error(
      `Asserted asyncFlush setting ${asyncFlush} does not match stored logger's setting ${logger.asyncFlush}`,
    );
  }
  return logger as unknown as Logger<ToB>;
}

function constructLogs3Data(items: string[]) {
  return `{"rows": ${constructJsonArray(items)}, "api_version": 2}`;
}

function now() {
  return new Date().getTime();
}

export interface BackgroundLoggerOpts {
  noExitFlush?: boolean;
  onFlushError?: (error: unknown) => void;
}

interface BackgroundLogger {
  log(items: LazyValue<BackgroundLogEvent>[]): void;
  flush(): Promise<void>;
}

export class TestBackgroundLogger implements BackgroundLogger {
  private items: LazyValue<BackgroundLogEvent>[][] = [];

  log(items: LazyValue<BackgroundLogEvent>[]): void {
    this.items.push(items);
  }

  async flush(): Promise<void> {
    return Promise.resolve();
  }

  async drain(): Promise<BackgroundLogEvent[]> {
    const items = this.items;
    this.items = [];

    // get all the values
    const events: BackgroundLogEvent[] = [];
    for (const item of items) {
      for (const event of item) {
        events.push(await event.get());
      }
    }

    const batch = mergeRowBatch(events);
    return batch.flat();
  }
}

const BACKGROUND_LOGGER_BASE_SLEEP_TIME_S = 1.0;

// We should only have one instance of this object per state object in
// 'BraintrustState._bgLogger'. Be careful about spawning multiple
// instances of this class, because concurrent BackgroundLoggers will not log to
// the backend in a deterministic order.
class HTTPBackgroundLogger implements BackgroundLogger {
  private apiConn: LazyValue<HTTPConnection>;
  private items: LazyValue<BackgroundLogEvent>[] = [];
  private activeFlush: Promise<void> = Promise.resolve();
  private activeFlushResolved = true;
  private activeFlushError: unknown = undefined;
  private onFlushError?: (error: unknown) => void;

  public syncFlush: boolean = false;
  // 6 MB for the AWS lambda gateway (from our own testing).
  public maxRequestSize: number = 6 * 1024 * 1024;
  public defaultBatchSize: number = 100;
  public numTries: number = 3;
  public queueDropExceedingMaxsize: number | undefined = undefined;
  public queueDropLoggingPeriod: number = 60;
  public failedPublishPayloadsDir: string | undefined = undefined;
  public allPublishPayloadsDir: string | undefined = undefined;

  private _disabled = false;

  private queueDropLoggingState = {
    numDropped: 0,
    lastLoggedTimestamp: 0,
  };

  constructor(apiConn: LazyValue<HTTPConnection>, opts?: BackgroundLoggerOpts) {
    opts = opts ?? {};
    this.apiConn = apiConn;

    const syncFlushEnv = Number(iso.getEnv("BRAINTRUST_SYNC_FLUSH"));
    if (!isNaN(syncFlushEnv)) {
      this.syncFlush = Boolean(syncFlushEnv);
    }

    const defaultBatchSizeEnv = Number(
      iso.getEnv("BRAINTRUST_DEFAULT_BATCH_SIZE"),
    );
    if (!isNaN(defaultBatchSizeEnv)) {
      this.defaultBatchSize = defaultBatchSizeEnv;
    }

    const maxRequestSizeEnv = Number(iso.getEnv("BRAINTRUST_MAX_REQUEST_SIZE"));
    if (!isNaN(maxRequestSizeEnv)) {
      this.maxRequestSize = maxRequestSizeEnv;
    }

    const numTriesEnv = Number(iso.getEnv("BRAINTRUST_NUM_RETRIES"));
    if (!isNaN(numTriesEnv)) {
      this.numTries = numTriesEnv + 1;
    }

    const queueDropExceedingMaxsizeEnv = Number(
      iso.getEnv("BRAINTRUST_QUEUE_DROP_EXCEEDING_MAXSIZE"),
    );
    if (!isNaN(queueDropExceedingMaxsizeEnv)) {
      this.queueDropExceedingMaxsize = queueDropExceedingMaxsizeEnv;
    }

    const queueDropLoggingPeriodEnv = Number(
      iso.getEnv("BRAINTRUST_QUEUE_DROP_LOGGING_PERIOD"),
    );
    if (!isNaN(queueDropLoggingPeriodEnv)) {
      this.queueDropLoggingPeriod = queueDropLoggingPeriodEnv;
    }

    const failedPublishPayloadsDirEnv = iso.getEnv(
      "BRAINTRUST_FAILED_PUBLISH_PAYLOADS_DIR",
    );
    if (failedPublishPayloadsDirEnv) {
      this.failedPublishPayloadsDir = failedPublishPayloadsDirEnv;
    }

    const allPublishPayloadsDirEnv = iso.getEnv(
      "BRAINTRUST_ALL_PUBLISH_PAYLOADS_DIR",
    );
    if (allPublishPayloadsDirEnv) {
      this.allPublishPayloadsDir = allPublishPayloadsDirEnv;
    }

    // Note that this will not run for explicit termination events, such as
    // calls to `process.exit()` or uncaught exceptions. Thus it is a
    // "best-effort" flush.
    if (!opts.noExitFlush) {
      iso.processOn("beforeExit", async () => {
        await this.flush();
      });
    }
    this.onFlushError = opts.onFlushError;
  }

  log(items: LazyValue<BackgroundLogEvent>[]) {
    if (this._disabled) {
      return;
    }

    const [addedItems, droppedItems] = (() => {
      if (this.queueDropExceedingMaxsize === undefined) {
        return [items, []];
      }
      const numElementsToAdd = Math.min(
        Math.max(this.queueDropExceedingMaxsize - this.items.length, 0),
        items.length,
      );
      return [items.slice(0, numElementsToAdd), items.slice(numElementsToAdd)];
    })();
    this.items.push(...addedItems);
    if (!this.syncFlush) {
      this.triggerActiveFlush();
    }

    if (droppedItems.length) {
      this.registerDroppedItemCount(droppedItems.length);
      if (this.allPublishPayloadsDir || this.failedPublishPayloadsDir) {
        this.dumpDroppedEvents(droppedItems);
      }
    }
  }

  async flush(): Promise<void> {
    if (this.syncFlush) {
      this.triggerActiveFlush();
    }
    await this.activeFlush;
    if (this.activeFlushError) {
      const err = this.activeFlushError;
      this.activeFlushError = undefined;
      if (this.syncFlush) {
        throw err;
      }
    }
  }

  private async flushOnce(args?: { batchSize?: number }): Promise<void> {
    if (this._disabled) {
      this.items = [];
      return;
    }

    const batchSize = args?.batchSize ?? this.defaultBatchSize;

    // Drain the queue.
    const wrappedItems = this.items;
    this.items = [];

    const [allItems, attachments] = await this.unwrapLazyValues(wrappedItems);
    if (allItems.length === 0) {
      return;
    }

    // Construct batches of records to flush in parallel and in sequence.
    const allItemsStr = allItems.map((bucket) =>
      bucket.map((item) => JSON.stringify(item)),
    );
    const batchSets = batchItems({
      items: allItemsStr,
      batchMaxNumItems: batchSize,
      batchMaxNumBytes: this.maxRequestSize / 2,
    });

    for (const batchSet of batchSets) {
      const postPromises = batchSet.map((batch) =>
        (async () => {
          try {
            await this.submitLogsRequest(batch);
            return { type: "success" } as const;
          } catch (e) {
            return { type: "error", value: e } as const;
          }
        })(),
      );
      const results = await Promise.all(postPromises);
      const failingResultErrors = results
        .map((r) => (r.type === "success" ? undefined : r.value))
        .filter((r) => r !== undefined);
      if (failingResultErrors.length) {
        throw new AggregateError(
          failingResultErrors,
          `Encountered the following errors while logging:`,
        );
      }
    }

    const attachmentErrors: unknown[] = [];
    // For now, upload attachments serially.
    for (const attachment of attachments) {
      try {
        const result = await attachment.upload();
        if (result.upload_status === "error") {
          throw new Error(result.error_message);
        }
      } catch (error) {
        attachmentErrors.push(error);
      }
    }
    if (attachmentErrors.length === 1) {
      throw attachmentErrors[0];
    } else if (attachmentErrors.length > 1) {
      throw new AggregateError(
        attachmentErrors,
        `Encountered the following errors while uploading attachments:`,
      );
    }

    // If more items were added while we were flushing, flush again
    if (this.items.length > 0) {
      await this.flushOnce(args);
    }
  }

  private async unwrapLazyValues(
    wrappedItems: LazyValue<BackgroundLogEvent>[],
  ): Promise<[BackgroundLogEvent[][], Attachment[]]> {
    for (let i = 0; i < this.numTries; ++i) {
      try {
        const items = await Promise.all(wrappedItems.map((x) => x.get()));

        // TODO(kevin): `extractAttachments` should ideally come after
        // `mergeRowBatch`, since merge-overwriting could result in some
        // attachments that no longer need to be uploaded. This would require
        // modifying the merge logic to treat the Attachment object as a "leaf"
        // rather than attempting to merge the keys of the Attachment.
        const attachments: Attachment[] = [];
        items.forEach((item) => extractAttachments(item, attachments));

        return [mergeRowBatch(items), attachments];
      } catch (e) {
        let errmsg = "Encountered error when constructing records to flush";
        const isRetrying = i + 1 < this.numTries;
        if (isRetrying) {
          errmsg += ". Retrying";
        }

        console.warn(errmsg);
        if (!isRetrying) {
          console.warn(
            `Failed to construct log records to flush after ${this.numTries} attempts. Dropping batch`,
          );
          throw e;
        } else {
          console.warn(e);
          const sleepTimeS = BACKGROUND_LOGGER_BASE_SLEEP_TIME_S * 2 ** i;
          console.info(`Sleeping for ${sleepTimeS}s`);
          await new Promise((resolve) =>
            setTimeout(resolve, sleepTimeS * 1000),
          );
        }
      }
    }
    throw new Error("Impossible");
  }

  private async submitLogsRequest(items: string[]): Promise<void> {
    const conn = await this.apiConn.get();
    const dataStr = constructLogs3Data(items);
    if (this.allPublishPayloadsDir) {
      await HTTPBackgroundLogger.writePayloadToDir({
        payloadDir: this.allPublishPayloadsDir,
        payload: dataStr,
      });
    }

    for (let i = 0; i < this.numTries; i++) {
      const startTime = now();
      let error: unknown = undefined;
      try {
        await conn.post_json("logs3", dataStr);
      } catch (e) {
        error = e;
      }
      if (error === undefined) {
        return;
      }

      const isRetrying = i + 1 < this.numTries;
      const retryingText = isRetrying ? "" : " Retrying";
      const errorText = (() => {
        if (error instanceof FailedHTTPResponse) {
          return `${error.status} (${error.text}): ${error.data}`;
        } else {
          return `${error}`;
        }
      })();
      const errMsg = `log request failed. Elapsed time: ${
        (now() - startTime) / 1000
      } seconds. Payload size: ${
        dataStr.length
      }.${retryingText}\nError: ${errorText}`;

      if (!isRetrying && this.failedPublishPayloadsDir) {
        await HTTPBackgroundLogger.writePayloadToDir({
          payloadDir: this.failedPublishPayloadsDir,
          payload: dataStr,
        });
        this.logFailedPayloadsDir();
      }

      if (!isRetrying) {
        console.warn(
          `log request failed after ${this.numTries} retries. Dropping batch`,
        );
        throw new Error(errMsg);
      } else {
        console.warn(errMsg);
        if (isRetrying) {
          const sleepTimeS = BACKGROUND_LOGGER_BASE_SLEEP_TIME_S * 2 ** i;
          console.info(`Sleeping for ${sleepTimeS}s`);
          await new Promise((resolve) =>
            setTimeout(resolve, sleepTimeS * 1000),
          );
        }
      }
    }
  }

  private registerDroppedItemCount(numItems: number) {
    if (numItems <= 0) {
      return;
    }
    this.queueDropLoggingState.numDropped += numItems;
    const timeNow = getCurrentUnixTimestamp();
    if (
      timeNow - this.queueDropLoggingState.lastLoggedTimestamp >
      this.queueDropLoggingPeriod
    ) {
      console.warn(
        `Dropped ${this.queueDropLoggingState.numDropped} elements due to full queue`,
      );
      if (this.failedPublishPayloadsDir) {
        this.logFailedPayloadsDir();
      }
      this.queueDropLoggingState.numDropped = 0;
      this.queueDropLoggingState.lastLoggedTimestamp = timeNow;
    }
  }

  private async dumpDroppedEvents(
    wrappedItems: LazyValue<BackgroundLogEvent>[],
  ) {
    const publishPayloadsDir = [
      this.allPublishPayloadsDir,
      this.failedPublishPayloadsDir,
    ].reduce((acc, x) => (x ? acc.concat([x]) : acc), new Array<string>());
    if (!(wrappedItems.length && publishPayloadsDir.length)) {
      return;
    }
    try {
      const [allItems, allAttachments] =
        await this.unwrapLazyValues(wrappedItems);

      const dataStr = constructLogs3Data(
        allItems.map((x) => JSON.stringify(x)),
      );
      const attachmentStr = JSON.stringify(
        allAttachments.map((a) => a.debugInfo()),
      );

      const payload = `{"data": ${dataStr}, "attachments": ${attachmentStr}}\n`;

      for (const payloadDir of publishPayloadsDir) {
        await HTTPBackgroundLogger.writePayloadToDir({ payloadDir, payload });
      }
    } catch (e) {
      console.error(e);
    }
  }

  private static async writePayloadToDir({
    payloadDir,
    payload,
  }: {
    payloadDir: string;
    payload: string;
  }) {
    if (!(iso.pathJoin && iso.mkdir && iso.writeFile)) {
      console.warn(
        "Cannot dump payloads: filesystem-operations not supported on this platform",
      );
      return;
    }
    const payloadFile = iso.pathJoin(
      payloadDir,
      `payload_${getCurrentUnixTimestamp()}_${uuidv4().slice(0, 8)}.json`,
    );
    try {
      await iso.mkdir(payloadDir, { recursive: true });
      await iso.writeFile(payloadFile, payload);
    } catch (e) {
      console.error(
        `Failed to write failed payload to output file ${payloadFile}:\n`,
        e,
      );
    }
  }

  private triggerActiveFlush() {
    if (this.activeFlushResolved) {
      this.activeFlushResolved = false;
      this.activeFlushError = undefined;
      this.activeFlush = (async () => {
        try {
          await this.flushOnce();
        } catch (err) {
          if (err instanceof AggregateError) {
            for (const e of err.errors) {
              this.onFlushError?.(e);
            }
          } else {
            this.onFlushError?.(err);
          }

          this.activeFlushError = err;
        } finally {
          this.activeFlushResolved = true;
        }
      })();

      waitUntil(this.activeFlush);
    }
  }

  private logFailedPayloadsDir() {
    console.warn(`Logging failed payloads to ${this.failedPublishPayloadsDir}`);
  }

  // Should only be called by BraintrustState.
  public internalReplaceApiConn(apiConn: HTTPConnection) {
    this.apiConn = new LazyValue(async () => apiConn);
  }

  public disable() {
    this._disabled = true;
  }
}

type InitOpenOption<IsOpen extends boolean> = {
  open?: IsOpen;
};

export type InitOptions<IsOpen extends boolean> = FullLoginOptions & {
  experiment?: string;
  description?: string;
  dataset?: AnyDataset;
  update?: boolean;
  baseExperiment?: string;
  isPublic?: boolean;
  metadata?: Record<string, unknown>;
  gitMetadataSettings?: GitMetadataSettings;
  projectId?: string;
  baseExperimentId?: string;
  repoInfo?: RepoInfo;
  setCurrent?: boolean;
  state?: BraintrustState;
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
 * @param options.update If the experiment already exists, continue logging to it. If it does not exist, creates the experiment with the specified arguments.
 * @param options.baseExperiment An optional experiment name to use as a base. If specified, the new experiment will be summarized and compared to this experiment. Otherwise, it will pick an experiment by finding the closest ancestor on the default (e.g. main) branch.
 * @param options.isPublic An optional parameter to control whether the experiment is publicly visible to anybody with the link or privately visible to only members of the organization. Defaults to private.
 * @param options.appUrl The URL of the Braintrust App. Defaults to https://www.braintrust.dev.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @param options.metadata (Optional) A dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
 * @param options.gitMetadataSettings (Optional) Settings for collecting git metadata. By default, will collect all git metadata fields allowed in org-level settings.
 * @param setCurrent If true (the default), set the global current-experiment to the newly-created one.
 * @param options.open If the experiment already exists, open it in read-only mode. Throws an error if the experiment does not already exist.
 * @param options.projectId The id of the project to create the experiment in. This takes precedence over `project` if specified.
 * @param options.baseExperimentId An optional experiment id to use as a base. If specified, the new experiment will be summarized and compared to this. This takes precedence over `baseExperiment` if specified.
 * @param options.repoInfo (Optional) Explicitly specify the git metadata for this experiment. This takes precedence over `gitMetadataSettings` if specified.
 * @returns The newly created Experiment.
 */
export function init<IsOpen extends boolean = false>(
  options: Readonly<FullInitOptions<IsOpen>>,
): InitializedExperiment<IsOpen>;

/**
 * Legacy form of `init` which accepts the project name as the first parameter,
 * separately from the remaining options. See `init(options)` for full details.
 */
export function init<IsOpen extends boolean = false>(
  project: string,
  options?: Readonly<InitOptions<IsOpen>>,
): InitializedExperiment<IsOpen>;

/**
 * Combined overload implementation of `init`. Do not call this directly.
 * Instead, call `init(options)` or `init(project, options)`.
 */
export function init<IsOpen extends boolean = false>(
  projectOrOptions: string | Readonly<FullInitOptions<IsOpen>>,
  optionalOptions?: Readonly<InitOptions<IsOpen>>,
): InitializedExperiment<IsOpen> {
  const options = ((): Readonly<FullInitOptions<IsOpen>> => {
    if (typeof projectOrOptions === "string") {
      return { ...optionalOptions, project: projectOrOptions };
    } else {
      if (optionalOptions !== undefined) {
        throw new Error(
          "Cannot specify options struct as both parameters. Must call either init(project, options) or init(options).",
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
    forceLogin,
    fetch,
    metadata,
    gitMetadataSettings,
    projectId,
    baseExperimentId,
    repoInfo,
    state: stateArg,
  } = options;

  if (!project && !projectId) {
    throw new Error("Must specify at least one of project or projectId");
  }

  if (open && update) {
    throw new Error("Cannot open and update an experiment at the same time");
  }

  const state = stateArg ?? _globalState;

  if (open) {
    if (isEmpty(experiment)) {
      throw new Error(`Cannot open an experiment without specifying its name`);
    }

    const lazyMetadata: LazyValue<ProjectExperimentMetadata> = new LazyValue(
      async () => {
        await state.login({ apiKey, appUrl, orgName, fetch, forceLogin });
        const args: Record<string, unknown> = {
          project_name: project,
          project_id: projectId,
          org_name: state.orgName,
          experiment_name: experiment,
        };

        const response = await state
          .appConn()
          .post_json("api/experiment/get", args);

        if (response.length === 0) {
          throw new Error(
            `Experiment ${experiment} not found in project ${
              projectId ?? project
            }.`,
          );
        }

        const info = response[0];
        return {
          project: {
            id: info.project_id,
            name: project ?? "UNKNOWN_PROJECT",
            fullInfo: {},
          },
          experiment: {
            id: info.id,
            name: info.name,
            fullInfo: info,
          },
        };
      },
    );

    return new ReadonlyExperiment(
      stateArg ?? _globalState,
      lazyMetadata,
    ) as InitializedExperiment<IsOpen>;
  }

  const lazyMetadata: LazyValue<ProjectExperimentMetadata> = new LazyValue(
    async () => {
      await state.login({ apiKey, appUrl, orgName });
      const args: Record<string, unknown> = {
        project_name: project,
        project_id: projectId,
        org_id: state.orgId,
        update,
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
          ...(state.gitMetadataSettings || {
            collect: "all",
          }),
        };
        if (gitMetadataSettings) {
          mergedGitMetadataSettings = mergeGitMetadataSettings(
            mergedGitMetadataSettings,
            gitMetadataSettings,
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
          response = await state
            .appConn()
            .post_json("api/experiment/register", args);
          break;
        } catch (e: any) {
          if (
            args["base_experiment"] &&
            `${"data" in e && e.data}`.includes("base experiment")
          ) {
            console.warn(
              `Base experiment ${args["base_experiment"]} not found.`,
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
          created: response.experiment.created,
          fullInfo: response.experiment,
        },
      };
    },
  );

  const ret = new Experiment(state, lazyMetadata, dataset);
  if (options.setCurrent ?? true) {
    state.currentExperiment = ret;
  }
  return ret as InitializedExperiment<IsOpen>;
}

/**
 * Alias for init(options).
 */
export function initExperiment<IsOpen extends boolean = false>(
  options: Readonly<InitOptions<IsOpen>>,
): InitializedExperiment<IsOpen>;

/**
 * Alias for init(project, options).
 */
export function initExperiment<IsOpen extends boolean = false>(
  project: string,
  options?: Readonly<InitOptions<IsOpen>>,
): InitializedExperiment<IsOpen>;

/**
 * Combined overload implementation of `initExperiment`, which is an alias for
 * `init`. Do not call this directly. Instead, call `initExperiment(options)` or
 * `initExperiment(project, options)`.
 */
export function initExperiment<IsOpen extends boolean = false>(
  projectOrOptions: string | Readonly<InitOptions<IsOpen>>,
  optionalOptions?: Readonly<InitOptions<IsOpen>>,
): InitializedExperiment<IsOpen> {
  const options = ((): Readonly<FullInitOptions<IsOpen>> => {
    if (typeof projectOrOptions === "string") {
      return { ...optionalOptions, project: projectOrOptions };
    } else {
      if (optionalOptions !== undefined) {
        throw new Error(
          "Cannot specify options struct as both parameters. Must call either init(project, options) or init(options).",
        );
      }
      return projectOrOptions;
    }
  })();
  return init(options);
}

/**
 * @deprecated Use {@link init} instead.
 */
export function withExperiment<R>(
  project: string,
  callback: (experiment: Experiment) => R,
  options: Readonly<InitOptions<false> & SetCurrentArg> = {},
): R {
  console.warn(
    "withExperiment is deprecated and will be removed in a future version of braintrust. Simply create the experiment with `init`.",
  );
  const experiment = init(project, options);
  return callback(experiment);
}

/**
 * @deprecated Use {@link initLogger} instead.
 */
export function withLogger<IsAsyncFlush extends boolean = false, R = void>(
  callback: (logger: Logger<IsAsyncFlush>) => R,
  options: Readonly<InitLoggerOptions<IsAsyncFlush> & SetCurrentArg> = {},
): R {
  console.warn(
    "withLogger is deprecated and will be removed in a future version of braintrust. Simply create the logger with `initLogger`.",
  );
  const logger = initLogger(options);
  return callback(logger);
}

type UseOutputOption<IsLegacyDataset extends boolean> = {
  useOutput?: IsLegacyDataset;
};

type InitDatasetOptions<IsLegacyDataset extends boolean> = FullLoginOptions & {
  dataset?: string;
  description?: string;
  version?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  state?: BraintrustState;
  _internal_btql?: Record<string, unknown>;
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
 * @param options.appUrl The URL of the Braintrust App. Defaults to https://www.braintrust.dev.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @param options.projectId The id of the project to create the dataset in. This takes precedence over `project` if specified.
 * @param options.metadata A dictionary with additional data about the dataset. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
 * @param options.useOutput (Deprecated) If true, records will be fetched from this dataset in the legacy format, with the "expected" field renamed to "output". This option will be removed in a future version of Braintrust.
 * @returns The newly created Dataset.
 */
export function initDataset<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET,
>(
  options: Readonly<FullInitDatasetOptions<IsLegacyDataset>>,
): Dataset<IsLegacyDataset>;

/**
 * Legacy form of `initDataset` which accepts the project name as the first
 * parameter, separately from the remaining options.
 *
 * See `initDataset(options)` for full details.
 */
export function initDataset<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET,
>(
  project: string,
  options?: Readonly<InitDatasetOptions<IsLegacyDataset>>,
): Dataset<IsLegacyDataset>;

/**
 * Combined overload implementation of `initDataset`. Do not call this
 * directly. Instead, call `initDataset(options)` or `initDataset(project,
 * options)`.
 */
export function initDataset<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET,
>(
  projectOrOptions: string | Readonly<FullInitDatasetOptions<IsLegacyDataset>>,
  optionalOptions?: Readonly<InitDatasetOptions<IsLegacyDataset>>,
): Dataset<IsLegacyDataset> {
  const options = ((): Readonly<FullInitDatasetOptions<IsLegacyDataset>> => {
    if (typeof projectOrOptions === "string") {
      return { ...optionalOptions, project: projectOrOptions };
    } else {
      if (optionalOptions !== undefined) {
        throw new Error(
          "Cannot specify options struct as both parameters. Must call either initDataset(project, options) or initDataset(options).",
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
    fetch,
    forceLogin,
    projectId,
    metadata,
    useOutput: legacy,
    state: stateArg,
    _internal_btql,
  } = options;

  const state = stateArg ?? _globalState;

  const lazyMetadata: LazyValue<ProjectDatasetMetadata> = new LazyValue(
    async () => {
      await state.login({
        orgName,
        apiKey,
        appUrl,
        fetch,
        forceLogin,
      });

      const args: Record<string, unknown> = {
        org_id: state.orgId,
        project_name: project,
        project_id: projectId,
        dataset_name: dataset,
        description,
        metadata,
      };
      const response = await state
        .appConn()
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
    },
  );

  return new Dataset(
    stateArg ?? _globalState,
    lazyMetadata,
    version,
    legacy,
    _internal_btql,
  );
}

/**
 * @deprecated Use {@link initDataset} instead.
 */
export function withDataset<
  R,
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET,
>(
  project: string,
  callback: (dataset: Dataset<IsLegacyDataset>) => R,
  options: Readonly<InitDatasetOptions<IsLegacyDataset>> = {},
): R {
  console.warn(
    "withDataset is deprecated and will be removed in a future version of braintrust. Simply create the dataset with `initDataset`.",
  );
  const dataset = initDataset<IsLegacyDataset>(project, options);
  return callback(dataset);
}

// Note: the argument names *must* serialize the same way as the argument names
// for the corresponding python function, because this function may be invoked
// from arguments serialized elsewhere.
async function computeLoggerMetadata(
  state: BraintrustState,
  {
    project_name,
    project_id,
  }: {
    project_name?: string;
    project_id?: string;
  },
) {
  await state.login({});
  const org_id = state.orgId!;
  if (isEmpty(project_id)) {
    const response = await state.appConn().post_json("api/project/register", {
      project_name: project_name || GLOBAL_PROJECT,
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
  } else if (isEmpty(project_name)) {
    const response = await state.appConn().get_json("api/project", {
      id: project_id,
    });
    return {
      org_id,
      project: {
        id: project_id,
        name: response.name,
        fullInfo: response.project,
      },
    };
  } else {
    return {
      org_id,
      project: { id: project_id, name: project_name, fullInfo: {} },
    };
  }
}

type AsyncFlushArg<IsAsyncFlush> = {
  asyncFlush?: IsAsyncFlush;
};

type InitLoggerOptions<IsAsyncFlush> = FullLoginOptions & {
  projectName?: string;
  projectId?: string;
  setCurrent?: boolean;
  state?: BraintrustState;
  orgProjectMetadata?: OrgProjectMetadata;
} & AsyncFlushArg<IsAsyncFlush>;

/**
 * Create a new logger in a specified project. If the project does not exist, it will be created.
 *
 * @param options Additional options for configuring init().
 * @param options.projectName The name of the project to log into. If unspecified, will default to the Global project.
 * @param options.projectId The id of the project to log into. This takes precedence over projectName if specified.
 * @param options.asyncFlush If true, will log asynchronously in the background. Otherwise, will log synchronously. (true by default)
 * @param options.appUrl The URL of the Braintrust App. Defaults to https://www.braintrust.dev.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
 * key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @param options.forceLogin Login again, even if you have already logged in (by default, the logger will not login if you are already logged in)
 * @param setCurrent If true (the default), set the global current-experiment to the newly-created one.
 * @returns The newly created Logger.
 */
export function initLogger<IsAsyncFlush extends boolean = true>(
  options: Readonly<InitLoggerOptions<IsAsyncFlush>> = {},
) {
  const {
    projectName,
    projectId,
    asyncFlush: asyncFlushArg,
    appUrl,
    apiKey,
    orgName,
    forceLogin,
    fetch,
    state: stateArg,
  } = options || {};

  const asyncFlush =
    asyncFlushArg === undefined ? (true as IsAsyncFlush) : asyncFlushArg;

  const computeMetadataArgs = {
    project_name: projectName,
    project_id: projectId,
  };
  const state = stateArg ?? _globalState;
  const lazyMetadata: LazyValue<OrgProjectMetadata> = new LazyValue(
    async () => {
      // Otherwise actually log in.
      await state.login({
        orgName,
        apiKey,
        appUrl,
        forceLogin,
        fetch,
      });
      return computeLoggerMetadata(state, computeMetadataArgs);
    },
  );

  const ret = new Logger<IsAsyncFlush>(state, lazyMetadata, {
    asyncFlush,
    computeMetadataArgs,
  });
  if (options.setCurrent ?? true) {
    state.currentLogger = ret as Logger<false>;
  }
  return ret;
}

type LoadPromptOptions = FullLoginOptions & {
  projectName?: string;
  projectId?: string;
  slug?: string;
  version?: string;
  defaults?: DefaultPromptArgs;
  noTrace?: boolean;
  state?: BraintrustState;
};

/**
 * Load a prompt from the specified project.
 *
 * @param options Options for configuring loadPrompt().
 * @param options.projectName The name of the project to load the prompt from. Must specify at least one of `projectName` or `projectId`.
 * @param options.projectId The id of the project to load the prompt from. This takes precedence over `projectName` if specified.
 * @param options.slug The slug of the prompt to load.
 * @param options.version An optional version of the prompt (to read). If not specified, the latest version will be used.
 * @param options.defaults (Optional) A dictionary of default values to use when rendering the prompt. Prompt values will override these defaults.
 * @param options.noTrace If true, do not include logging metadata for this prompt when build() is called.
 * @param options.appUrl The URL of the Braintrust App. Defaults to https://www.braintrust.dev.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
 * key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @returns The prompt object.
 * @throws If the prompt is not found.
 * @throws If multiple prompts are found with the same slug in the same project (this should never happen).
 *
 * @example
 * ```javascript
 * const prompt = await loadPrompt({
 *  projectName: "My Project",
 *  slug: "my-prompt",
 * });
 * ```
 */
export async function loadPrompt({
  projectName,
  projectId,
  slug,
  version,
  defaults,
  noTrace = false,
  appUrl,
  apiKey,
  orgName,
  fetch,
  forceLogin,
  state: stateArg,
}: LoadPromptOptions) {
  if (isEmpty(projectName) && isEmpty(projectId)) {
    throw new Error("Must specify either projectName or projectId");
  }

  if (isEmpty(slug)) {
    throw new Error("Must specify slug");
  }

  const state = stateArg ?? _globalState;
  let response;
  try {
    await state.login({
      orgName,
      apiKey,
      appUrl,
      fetch,
      forceLogin,
    });
    response = await state.apiConn().get_json("v1/prompt", {
      project_name: projectName,
      project_id: projectId,
      slug,
      version,
    });
  } catch (e) {
    console.warn("Failed to load prompt, attempting to fall back to cache:", e);
    const prompt = await state.promptCache.get({
      slug,
      projectId,
      projectName,
      version: version ?? "latest",
    });
    if (!prompt) {
      throw new Error(
        `Prompt ${slug} (version ${version ?? "latest"}) not found in ${[
          projectName ?? projectId,
        ]} (not found on server or in local cache): ${e}`,
      );
    }
    return prompt;
  }

  if (!("objects" in response) || response.objects.length === 0) {
    throw new Error(
      `Prompt ${slug} not found in ${[projectName ?? projectId]}`,
    );
  } else if (response.objects.length > 1) {
    throw new Error(
      `Multiple prompts found with slug ${slug} in project ${
        projectName ?? projectId
      }. This should never happen.`,
    );
  }

  const metadata = promptSchema.parse(response["objects"][0]);
  const prompt = new Prompt(metadata, defaults || {}, noTrace);
  try {
    await state.promptCache.set(
      { slug, projectId, projectName, version: version ?? "latest" },
      prompt,
    );
  } catch (e) {
    console.warn("Failed to set prompt in cache:", e);
  }
  return prompt;
}

/**
 * Options for logging in to Braintrust.
 */
export interface LoginOptions {
  /**
   * The URL of the Braintrust App. Defaults to https://www.braintrust.dev. You should not need
   * to change this unless you are doing the "Full" deployment.
   */
  appUrl?: string;
  /**
   * The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable.
   */
  apiKey?: string;
  /**
   * The name of a specific organization to connect to. Since API keys are scoped to organizations, this parameter is usually
   * unnecessary unless you are logging in with a JWT.
   */
  orgName?: string;
  /**
   * A custom fetch implementation to use.
   */
  fetch?: typeof globalThis.fetch;
  /**
   * By default, the SDK installs an event handler that flushes pending writes on the `beforeExit` event.
   * If true, this event handler will _not_ be installed.
   */
  noExitFlush?: boolean;
  /**
   * Calls this function if there's an error in the background flusher.
   */
  onFlushError?: (error: unknown) => void;
}

export type FullLoginOptions = LoginOptions & {
  forceLogin?: boolean;
};

/**
 * Log into Braintrust. This will prompt you for your API token, which you can find at
 * https://www.braintrust.dev/app/token. This method is called automatically by `init()`.
 *
 * @param options Options for configuring login().
 * @param options.appUrl The URL of the Braintrust App. Defaults to https://www.braintrust.dev.
 * @param options.apiKey The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
 * key is specified, will prompt the user to login.
 * @param options.orgName (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
 * @param options.forceLogin Login again, even if you have already logged in (by default, this function will exit quickly if you have already logged in)
 */
export async function login(
  options: LoginOptions & { forceLogin?: boolean } = {},
): Promise<BraintrustState> {
  const { forceLogin = false } = options || {};

  if (_globalState.loggedIn && !forceLogin) {
    // We have already logged in. If any provided login inputs disagree with our
    // existing settings, raise an Exception warning the user to try again with
    // `forceLogin: true`.
    function checkUpdatedParam(
      varname: string,
      arg: string | undefined,
      orig: string | null,
    ) {
      if (!isEmpty(arg) && !isEmpty(orig) && arg !== orig) {
        throw new Error(
          `Re-logging in with different ${varname} (${arg}) than original (${orig}). To force re-login, pass \`forceLogin: true\``,
        );
      }
    }
    checkUpdatedParam("appUrl", options.appUrl, _globalState.appUrl);
    checkUpdatedParam(
      "apiKey",
      options.apiKey
        ? HTTPConnection.sanitize_token(options.apiKey)
        : undefined,
      _globalState.loginToken,
    );
    checkUpdatedParam("orgName", options.orgName, _globalState.orgName);
    return _globalState;
  }

  await _globalState.login(options);
  globalThis.__inherited_braintrust_state = _globalState;
  return _globalState;
}

export async function loginToState(options: LoginOptions = {}) {
  const {
    appUrl = iso.getEnv("BRAINTRUST_APP_URL") || "https://www.braintrust.dev",
    apiKey = iso.getEnv("BRAINTRUST_API_KEY"),
    orgName = iso.getEnv("BRAINTRUST_ORG_NAME"),
    fetch = globalThis.fetch,
  } = options || {};

  const appPublicUrl = iso.getEnv("BRAINTRUST_APP_PUBLIC_URL") || appUrl;

  const state = new BraintrustState(options);
  state.resetLoginInfo();

  state.appUrl = appUrl;
  state.appPublicUrl = appPublicUrl;

  let conn = null;

  if (!apiKey) {
    throw new Error(
      "Please specify an api key (e.g. by setting BRAINTRUST_API_KEY).",
    );
  } else if (apiKey === TEST_API_KEY) {
    // This is a weird hook that lets us skip logging in and mocking out the org info.
    const testOrgInfo = [
      {
        id: "test-org-id",
        name: "test-org-name",
        api_url: "https://braintrust.dev/fake-api-url",
      },
    ];
    state.loggedIn = true;
    state.loginToken = TEST_API_KEY;
    _saveOrgInfo(state, testOrgInfo, testOrgInfo[0].name);
    return state;
  } else {
    const resp = await checkResponse(
      await fetch(_urljoin(state.appUrl, `/api/apikey/login`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      }),
    );
    const info = await resp.json();

    _saveOrgInfo(state, info.org_info, orgName);
    if (!state.apiUrl) {
      if (orgName) {
        throw new Error(
          `Unable to log into organization '${orgName}'. Are you sure this credential is scoped to the organization?`,
        );
      } else {
        throw new Error(
          "Unable to log into any organization with the provided credential.",
        );
      }
    }

    conn = state.apiConn();
    conn.set_token(apiKey);

    if (!conn) {
      throw new Error("Conn should be set at this point (a bug)");
    }

    conn.make_long_lived();

    // Set the same token in the API
    state.appConn().set_token(apiKey);
    if (state.proxyUrl) {
      state.proxyConn().set_token(apiKey);
    }
    state.loginToken = conn.token;
    state.loggedIn = true;

    // Replace the global logger's apiConn with this one.
    state.loginReplaceApiConn(conn);
  }

  return state;
}

// XXX We should remove these global functions now
/**
 * Log a single event to the current experiment. The event will be batched and uploaded behind the scenes.
 *
 * @param event The event to log. See {@link Experiment.log} for full details.
 * @returns The `id` of the logged event.
 */
export function log(event: ExperimentLogFullArgs): string {
  console.warn(
    "braintrust.log is deprecated and will be removed in a future version of braintrust. Use `experiment.log` instead.",
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
  } = {},
): Promise<ExperimentSummary> {
  console.warn(
    "braintrust.summarize is deprecated and will be removed in a future version of braintrust. Use `experiment.summarize` instead.",
  );
  const e = currentExperiment();
  if (!e) {
    throw new Error("Not initialized. Please call init() first");
  }
  return await e.summarize(options);
}

type OptionalStateArg = {
  state?: BraintrustState;
};

/**
 * Returns the currently-active experiment (set by {@link init}). Returns undefined if no current experiment has been set.
 */
export function currentExperiment(
  options?: OptionalStateArg,
): Experiment | undefined {
  const state = options?.state ?? _globalState;
  return state.currentExperiment;
}

/**
 * Returns the currently-active logger (set by {@link initLogger}). Returns undefined if no current logger has been set.
 */
export function currentLogger<IsAsyncFlush extends boolean>(
  options?: AsyncFlushArg<IsAsyncFlush> & OptionalStateArg,
): Logger<IsAsyncFlush> | undefined {
  const state = options?.state ?? _globalState;
  return castLogger(state.currentLogger, options?.asyncFlush);
}

/**
 * Return the currently-active span for logging (set by one of the `traced` methods). If there is no active span, returns a no-op span object, which supports the same interface as spans but does no logging.
 *
 * See {@link Span} for full details.
 */
export function currentSpan(options?: OptionalStateArg): Span {
  const state = options?.state ?? _globalState;
  return state.currentSpan.getStore() ?? NOOP_SPAN;
}

/**
 * Mainly for internal use. Return the parent object for starting a span in a global context.
 */
export function getSpanParentObject<IsAsyncFlush extends boolean>(
  options?: AsyncFlushArg<IsAsyncFlush> & OptionalStateArg,
): Span | Experiment | Logger<IsAsyncFlush> {
  const state = options?.state ?? _globalState;
  const parentSpan = currentSpan({ state });
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

export function logError(span: Span, error: unknown) {
  let errorMessage = "<error>";
  let stackTrace = "";
  if (error instanceof Error) {
    errorMessage = error.message;
    stackTrace = error.stack || "";
  } else {
    errorMessage = String(error);
  }
  span.log({ error: `${errorMessage}\n\n${stackTrace}` });
}

/**
 * Toplevel function for starting a span. It checks the following (in precedence order):
 *  * Currently-active span
 *  * Currently-active experiment
 *  * Currently-active logger
 *
 * and creates a span under the first one that is active. Alternatively, if `parent` is specified, it creates a span under the specified parent row. If none of these are active, it returns a no-op span object.
 *
 * See {@link Span.traced} for full details.
 */
export function traced<IsAsyncFlush extends boolean = true, R = void>(
  callback: (span: Span) => R,
  args?: StartSpanArgs &
    SetCurrentArg &
    AsyncFlushArg<IsAsyncFlush> &
    OptionalStateArg,
): PromiseUnless<IsAsyncFlush, R> {
  const { span, isSyncFlushLogger } = startSpanAndIsLogger(args);

  const ret = runCatchFinally(
    () => {
      if (args?.setCurrent ?? true) {
        return withCurrent(span, callback);
      } else {
        return callback(span);
      }
    },
    (e) => {
      logError(span, e);
      throw e;
    },
    () => span.end(),
  );

  type Ret = PromiseUnless<IsAsyncFlush, R>;

  if (args?.asyncFlush === undefined || args?.asyncFlush) {
    return ret as Ret;
  } else {
    return (async () => {
      const awaitedRet = await ret;
      if (isSyncFlushLogger) {
        await span.flush();
      }
      return awaitedRet;
    })() as Ret;
  }
}

/**
 * Wrap a function with `traced`, using the arguments as `input` and return value as `output`.
 * Any functions wrapped this way will automatically be traced, similar to the `@traced` decorator
 * in Python. If you want to correctly propagate the function's name and define it in one go, then
 * you can do so like this:
 *
 * ```ts
 * const myFunc = wrapTraced(async function myFunc(input) {
 *  const result = await client.chat.completions.create({
 *    model: "gpt-3.5-turbo",
 *    messages: [{ role: "user", content: input }],
 *  });
 *  return result.choices[0].message.content ?? "unknown";
 * },
 * // Optional: if you're using a framework like NextJS that minifies your code, specify the function name and it will be used for the span name
 * { name: "myFunc" },
 * );
 * ```
 * Now, any calls to `myFunc` will be traced, and the input and output will be logged automatically.
 * If tracing is inactive, i.e. there is no active logger or experiment, it's just a no-op.
 *
 * @param fn The function to wrap.
 * @param args Span-level arguments (e.g. a custom name or type) to pass to `traced`.
 * @returns The wrapped function.
 */
export function wrapTraced<
  F extends (...args: any[]) => any,
  IsAsyncFlush extends boolean = true,
>(
  fn: F,
  args?: StartSpanArgs & SetCurrentArg & AsyncFlushArg<IsAsyncFlush>,
): IsAsyncFlush extends false
  ? (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>
  : F {
  const spanArgs: typeof args = {
    name: fn.name,
    type: "function",
    ...args,
  };
  const hasExplicitInput =
    args &&
    args.event &&
    "input" in args.event &&
    args.event.input !== undefined;
  const hasExplicitOutput =
    args && args.event && args.event.output !== undefined;

  if (args?.asyncFlush) {
    return ((...fnArgs: Parameters<F>) =>
      traced((span) => {
        if (!hasExplicitInput) {
          span.log({ input: fnArgs });
        }

        const output = fn(...fnArgs);

        if (!hasExplicitOutput) {
          if (output instanceof Promise) {
            return (async () => {
              const result = await output;
              span.log({ output: result });
              return result;
            })();
          } else {
            span.log({ output: output });
          }
        }

        return output;
      }, spanArgs)) as IsAsyncFlush extends false ? never : F;
  } else {
    return ((...fnArgs: Parameters<F>) =>
      traced(async (span) => {
        if (!hasExplicitInput) {
          span.log({ input: fnArgs });
        }

        const outputResult = fn(...fnArgs);

        const output = await outputResult;

        if (!hasExplicitOutput) {
          span.log({ output });
        }

        return output;
      }, spanArgs)) as IsAsyncFlush extends false
      ? (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>
      : never;
  }
}

/**
 * A synonym for `wrapTraced`. If you're porting from systems that use `traceable`, you can use this to
 * make your codebase more consistent.
 */
export const traceable = wrapTraced;

/**
 * Lower-level alternative to `traced`. This allows you to start a span yourself, and can be useful in situations
 * where you cannot use callbacks. However, spans started with `startSpan` will not be marked as the "current span",
 * so `currentSpan()` and `traced()` will be no-ops. If you want to mark a span as current, use `traced` instead.
 *
 * See {@link traced} for full details.
 */
export function startSpan<IsAsyncFlush extends boolean = true>(
  args?: StartSpanArgs & AsyncFlushArg<IsAsyncFlush> & OptionalStateArg,
): Span {
  return startSpanAndIsLogger(args).span;
}

/**
 * Flush any pending rows to the server.
 */
export async function flush(options?: OptionalStateArg): Promise<void> {
  const state = options?.state ?? _globalState;
  return await state.bgLogger().flush();
}

/**
 * Set the fetch implementation to use for requests. You can specify it here,
 * or when you call `login`.
 *
 * @param fetch The fetch implementation to use.
 */
export function setFetch(fetch: typeof globalThis.fetch): void {
  _globalState.setFetch(fetch);
}

function startSpanAndIsLogger<IsAsyncFlush extends boolean = true>(
  args?: StartSpanArgs & AsyncFlushArg<IsAsyncFlush> & OptionalStateArg,
): { span: Span; isSyncFlushLogger: boolean } {
  const state = args?.state ?? _globalState;

  const parentStr = args?.parent ?? state.currentParent.getStore();

  const components: SpanComponentsV3 | undefined = parentStr
    ? SpanComponentsV3.fromStr(parentStr)
    : undefined;

  if (components) {
    const parentSpanIds: ParentSpanIds | undefined = components.data.row_id
      ? {
          spanId: components.data.span_id,
          rootSpanId: components.data.root_span_id,
        }
      : undefined;
    const span = new SpanImpl({
      state,
      ...args,
      parentObjectType: components.data.object_type,
      parentObjectId: new LazyValue(
        spanComponentsToObjectIdLambda(state, components),
      ),
      parentComputeObjectMetadataArgs:
        components.data.compute_object_metadata_args ?? undefined,
      parentSpanIds,
      propagatedEvent:
        args?.propagatedEvent ??
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        ((components.data.propagated_event ?? undefined) as
          | StartSpanEventArgs
          | undefined),
    });
    return {
      span,
      isSyncFlushLogger:
        components.data.object_type === SpanObjectTypeV3.PROJECT_LOGS &&
        // Since there's no parent logger here, we're free to choose the async flush
        // behavior, and therefore propagate along whatever we get from the arguments
        args?.asyncFlush === false,
    };
  } else {
    const parentObject = getSpanParentObject<IsAsyncFlush>({
      asyncFlush: args?.asyncFlush,
    });
    const span = parentObject.startSpan(args);
    return {
      span,
      isSyncFlushLogger:
        parentObject.kind === "logger" && parentObject.asyncFlush === false,
    };
  }
}

/**
 * Runs the provided callback with the span as the current span.
 */
export function withCurrent<R>(
  span: Span,
  callback: (span: Span) => R,
  state: BraintrustState | undefined = undefined,
): R {
  return (state ?? _globalState).currentSpan.run(span, () => callback(span));
}

export function withParent<R>(
  parent: string,
  callback: () => R,
  state: BraintrustState | undefined = undefined,
): R {
  return (state ?? _globalState).currentParent.run(parent, () => callback());
}

function _saveOrgInfo(
  state: BraintrustState,
  org_info: any,
  org_name: string | undefined,
) {
  if (org_info.length === 0) {
    throw new Error("This user is not part of any organizations.");
  }

  for (const org of org_info) {
    if (org_name === undefined || org.name === org_name) {
      state.orgId = org.id;
      state.orgName = org.name;
      state.apiUrl = iso.getEnv("BRAINTRUST_API_URL") ?? org.api_url;
      state.proxyUrl = iso.getEnv("BRAINTRUST_PROXY_URL") ?? org.proxy_url;
      state.gitMetadataSettings = org.git_metadata || undefined;
      break;
    }
  }

  if (state.orgId === undefined) {
    throw new Error(
      `Organization ${org_name} not found. Must be one of ${org_info
        .map((x: any) => x.name)
        .join(", ")}`,
    );
  }
}

function validateTags(tags: readonly string[]) {
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") {
      throw new Error("tags must be strings");
    }

    if (seen.has(tag)) {
      throw new Error(`duplicate tag: ${tag}`);
    }
  }
}

function validateAndSanitizeExperimentLogPartialArgs(
  event: ExperimentLogPartialArgs,
): SanitizedExperimentLogPartialArgs {
  if (event.scores) {
    if (Array.isArray(event.scores)) {
      throw new Error("scores must be an object, not an array");
    }
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

      if (value !== undefined && typeof value !== "number") {
        throw new Error("metric values must be numbers");
      }
    }
  }

  if ("input" in event && event.input && "inputs" in event && event.inputs) {
    throw new Error(
      "Only one of input or inputs (deprecated) can be specified. Prefer input.",
    );
  }

  if ("tags" in event && event.tags) {
    validateTags(event.tags);
  }

  if ("inputs" in event) {
    const { inputs, ...rest } = event;
    return { input: inputs, ...rest };
  } else {
    return { ...event };
  }
}

/**
 * Creates a deep copy of the given event. Replaces references to user objects
 * with placeholder strings to ensure serializability, except for
 * {@link Attachment} and {@link ExternalAttachment} objects, which are preserved
 * and not deep-copied.
 */
function deepCopyEvent<T extends Partial<BackgroundLogEvent>>(event: T): T {
  const attachments: BaseAttachment[] = [];
  const IDENTIFIER = "_bt_internal_saved_attachment";
  const savedAttachmentSchema = z.strictObject({ [IDENTIFIER]: z.number() });

  // We both check for serializability and round-trip `event` through JSON in
  // order to create a "deep copy". This has the benefit of cutting out any
  // reference to user objects when the object is logged asynchronously, so that
  // in case the objects are modified, the logging is unaffected. In the future,
  // this could be changed to a "real" deep copy so that immutable types (long
  // strings) do not have to be copied.
  const serialized = JSON.stringify(event, (_k, v) => {
    if (v instanceof SpanImpl || v instanceof NoopSpan) {
      return `<span>`;
    } else if (v instanceof Experiment) {
      return `<experiment>`;
    } else if (v instanceof Dataset) {
      return `<dataset>`;
    } else if (v instanceof Logger) {
      return `<logger>`;
    } else if (v instanceof BaseAttachment) {
      const idx = attachments.push(v);
      return { [IDENTIFIER]: idx - 1 };
    } else if (v instanceof ReadonlyAttachment) {
      return v.reference;
    }
    return v;
  });
  const x = JSON.parse(serialized, (_k, v) => {
    const parsedAttachment = savedAttachmentSchema.safeParse(v);
    if (parsedAttachment.success) {
      return attachments[parsedAttachment.data[IDENTIFIER]];
    }
    return v;
  });
  return x;
}

/**
 * Helper function for uploading attachments. Recursively extracts `Attachment`
 * and `ExternalAttachment` objects and replaces them with their associated
 * `AttachmentReference` objects.
 *
 * @param event The event to filter. Will be modified in-place.
 * @param attachments Flat array of extracted attachments (output parameter).
 */
function extractAttachments(
  event: Record<string, any>,
  attachments: BaseAttachment[],
): void {
  for (const [key, value] of Object.entries(event)) {
    // Base case: Attachment or ExternalAttachment.
    if (value instanceof BaseAttachment) {
      attachments.push(value);
      event[key] = value.reference;
      continue; // Attachment cannot be nested.
    }

    // Base case: non-object.
    if (!(value instanceof Object)) {
      continue; // Nothing to explore recursively.
    }

    // Recursive case: object or array.
    extractAttachments(value, attachments);
  }
}

/**
 * Recursively hydrates any `AttachmentReference` into `Attachment` by modifying
 * the input in-place.
 *
 * @returns The same event instance as the input.
 */
function enrichAttachments<T extends Record<string, any>>(
  event: T,
  state: BraintrustState | undefined,
): T {
  for (const [key, value] of Object.entries(event)) {
    // Base case: AttachmentReference.
    const parsedValue = attachmentReferenceSchema.safeParse(value);
    if (parsedValue.success) {
      (event as any)[key] = new ReadonlyAttachment(parsedValue.data, state);
      continue;
    }

    // Base case: non-object.
    if (!(value instanceof Object)) {
      continue;
    }

    // Recursive case: object or array:
    enrichAttachments(value, state);
  }

  return event;
}

// Note that this only checks properties that are expected of a complete event.
// validateAndSanitizeExperimentLogPartialArgs should still be invoked (after
// handling special fields like 'id').
function validateAndSanitizeExperimentLogFullArgs(
  event: ExperimentLogFullArgs,
  hasDataset: boolean,
): ExperimentLogFullArgs {
  if (
    ("input" in event &&
      !isEmpty(event.input) &&
      "inputs" in event &&
      !isEmpty(event.inputs)) ||
    (!("input" in event) && !("inputs" in event))
  ) {
    throw new Error(
      "Exactly one of input or inputs (deprecated) must be specified. Prefer input.",
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
      "datasetRecordId cannot be specified when not using a dataset",
    );
  }

  return event;
}

export type WithTransactionId<R> = R & {
  [TRANSACTION_ID_FIELD]: TransactionId;
};

export const INTERNAL_BTQL_LIMIT = 1000;
const MAX_BTQL_ITERATIONS = 10000;

class ObjectFetcher<RecordType>
  implements AsyncIterable<WithTransactionId<RecordType>>
{
  private _fetchedData: WithTransactionId<RecordType>[] | undefined = undefined;

  constructor(
    private objectType: "dataset" | "experiment",
    private pinnedVersion: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private mutateRecord?: (r: any) => WithTransactionId<RecordType>,
    private _internal_btql?: Record<string, unknown>,
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
      let data: WithTransactionId<RecordType>[] | undefined = undefined;
      let cursor = undefined;
      let iterations = 0;
      while (true) {
        const resp = await state.apiConn().post(
          `btql`,
          {
            query: {
              ...this._internal_btql,
              select: [
                {
                  op: "star",
                },
              ],
              from: {
                op: "function",
                name: {
                  op: "ident",
                  name: [this.objectType],
                },
                args: [
                  {
                    op: "literal",
                    value: await this.id,
                  },
                ],
              },
              cursor,
              limit: INTERNAL_BTQL_LIMIT,
            },
            use_columnstore: false,
            brainstore_realtime: true,
          },
          { headers: { "Accept-Encoding": "gzip" } },
        );
        const respJson = await resp.json();
        data = (data ?? []).concat(respJson.data);
        if (!respJson.cursor) {
          break;
        }
        cursor = respJson.cursor;
        iterations++;
        if (iterations > MAX_BTQL_ITERATIONS) {
          throw new Error("Too many BTQL iterations");
        }
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
      let maxVersion: string | undefined = undefined;
      for (const record of fetchedData) {
        const xactId = String(record[TRANSACTION_ID_FIELD] ?? "0");
        if (maxVersion === undefined || xactId > maxVersion) {
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
  tags?: string[];
  // These fields are only set if the EvalCase is part of a Dataset.
  id?: string;
  _xact_id?: TransactionId;
  created?: string | null;
  // This field is used to help re-run a particular experiment row.
  upsert_id?: string;
} & (Expected extends void ? object : { expected: Expected }) &
  (Metadata extends void ? object : { metadata: Metadata });

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
export class Experiment
  extends ObjectFetcher<ExperimentEvent>
  implements Exportable
{
  private readonly lazyMetadata: LazyValue<ProjectExperimentMetadata>;
  public readonly dataset?: AnyDataset;
  private lastStartTime: number;
  private lazyId: LazyValue<string>;
  private calledStartSpan: boolean;
  private state: BraintrustState;

  // For type identification.
  public kind = "experiment" as const;

  constructor(
    state: BraintrustState,
    lazyMetadata: LazyValue<ProjectExperimentMetadata>,
    dataset?: AnyDataset,
  ) {
    super("experiment", undefined, (r) => enrichAttachments(r, state));
    this.lazyMetadata = lazyMetadata;
    this.dataset = dataset;
    this.lastStartTime = getCurrentUnixTimestamp();
    this.lazyId = new LazyValue(async () => await this.id);
    this.calledStartSpan = false;
    this.state = state;
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

  private parentObjectType() {
    return SpanObjectTypeV3.EXPERIMENT;
  }

  protected async getState(): Promise<BraintrustState> {
    // Ensure the login state is populated by awaiting lazyMetadata.
    await this.lazyMetadata.get();
    return this.state;
  }

  /**
   * Log a single event to the experiment. The event will be batched and uploaded behind the scenes.
   *
   * @param event The event to log.
   * @param event.input: The arguments that uniquely define a test case (an arbitrary, JSON serializable object). Later on, Braintrust will use the `input` to know whether two test cases are the same between experiments, so they should not contain experiment-specific state. A simple rule of thumb is that if you run the same experiment twice, the `input` should be identical.
   * @param event.output: The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
   * @param event.expected: (Optional) The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate your experiments while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
   * @param event.error: (Optional) The error that occurred, if any. If you use tracing to run an experiment, errors are automatically logged when your code throws an exception.
   * @param event.scores: A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare experiments.
   * @param event.metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
   * @param event.metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically: "start", "end".
   * @param event.id: (Optional) a unique identifier for the event. If you don't provide one, BrainTrust will generate one for you.
   * @param event.dataset_record_id: (Optional) the id of the dataset record that this event is associated with. This field is required if and only if the experiment is associated with a dataset. This field is unused and will be removed in a future version.
   * @param options Additional logging options
   * @param options.allowConcurrentWithSpans in rare cases where you need to log at the top level separately from spans on the experiment elsewhere, set this to true.
   * @returns The `id` of the logged event.
   */
  public log(
    event: Readonly<ExperimentLogFullArgs>,
    options?: { allowConcurrentWithSpans?: boolean },
  ): string {
    if (this.calledStartSpan && !options?.allowConcurrentWithSpans) {
      throw new Error(
        "Cannot run toplevel `log` method while using spans. To log to the span, call `experiment.traced` and then log with `span.log`",
      );
    }

    event = validateAndSanitizeExperimentLogFullArgs(event, !!this.dataset);
    const span = this.startSpanImpl({ startTime: this.lastStartTime, event });
    this.lastStartTime = span.end();
    return span.id;
  }

  /**
   * Create a new toplevel span underneath the experiment. The name defaults to "root".
   *
   * See {@link Span.traced} for full details.
   */
  public traced<R>(
    callback: (span: Span) => R,
    args?: StartSpanArgs & SetCurrentArg,
  ): R {
    const { setCurrent, ...argsRest } = args ?? {};
    const span = this.startSpan(argsRest);

    const ret = runCatchFinally(
      () => {
        if (setCurrent ?? true) {
          return withCurrent(span, callback);
        } else {
          return callback(span);
        }
      },
      (e) => {
        logError(span, e);
        throw e;
      },
      () => span.end(),
    );

    return ret as R;
  }

  /**
   * Lower-level alternative to `traced`. This allows you to start a span yourself, and can be useful in situations
   * where you cannot use callbacks. However, spans started with `startSpan` will not be marked as the "current span",
   * so `currentSpan()` and `traced()` will be no-ops. If you want to mark a span as current, use `traced` instead.
   *
   * See {@link traced} for full details.
   */
  public startSpan(args?: StartSpanArgs): Span {
    this.calledStartSpan = true;
    return this.startSpanImpl(args);
  }

  private startSpanImpl(args?: StartSpanArgs): Span {
    return new SpanImpl({
      ...args,
      // Sometimes `args` gets passed directly into this function, and it contains an undefined value for `state`.
      // To ensure that we always use this experiment's state, we override the `state` argument no matter what.
      state: this.state,
      ...startSpanParentArgs({
        state: this.state,
        parent: args?.parent,
        parentObjectType: this.parentObjectType(),
        parentObjectId: this.lazyId,
        parentComputeObjectMetadataArgs: undefined,
        parentSpanIds: undefined,
        propagatedEvent: args?.propagatedEvent,
      }),
      defaultRootType: SpanTypeAttribute.EVAL,
    });
  }

  public async fetchBaseExperiment() {
    const state = await this.getState();
    const conn = state.appConn();

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
    } = {},
  ): Promise<ExperimentSummary> {
    let { summarizeScores = true, comparisonExperimentId = undefined } =
      options || {};

    const state = await this.getState();
    const projectUrl = `${state.appPublicUrl}/app/${encodeURIComponent(
      state.orgName!,
    )}/p/${encodeURIComponent((await this.project).name)}`;
    const experimentUrl = `${projectUrl}/experiments/${encodeURIComponent(
      await this.name,
    )}`;

    let scores: Record<string, ScoreSummary> | undefined = undefined;
    let metrics: Record<string, MetricSummary> | undefined = undefined;
    let comparisonExperimentName = undefined;
    if (summarizeScores) {
      await this.flush();
      if (comparisonExperimentId === undefined) {
        const baseExperiment = await this.fetchBaseExperiment();
        if (baseExperiment !== null) {
          comparisonExperimentId = baseExperiment.id;
          comparisonExperimentName = baseExperiment.name;
        }
      }

      try {
        const results = await state.apiConn().get_json(
          "/experiment-comparison2",
          {
            experiment_id: await this.id,
            base_experiment_id: comparisonExperimentId,
          },
          3,
        );

        scores = results["scores"];
        metrics = results["metrics"];
      } catch (e) {
        console.warn(
          `Failed to fetch experiment scores and metrics: ${e}\n\nView complete results in Braintrust or run experiment.summarize() again.`,
        );
        scores = {};
        metrics = {};
      }
    }

    return {
      projectName: (await this.project).name,
      experimentName: await this.name,
      projectId: (await this.project).id,
      experimentId: await this.id,
      projectUrl: projectUrl,
      experimentUrl: experimentUrl,
      comparisonExperimentName: comparisonExperimentName,
      scores: scores ?? {},
      metrics: metrics ?? {},
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
   * @param event.metadata (Optional) a dictionary with additional data about the feedback. If you have a `user_id`, you can log it here and access it in the Braintrust UI. Note, this metadata does not correspond to the main event itself, but rather the audit log attached to the event.
   * @param event.source (Optional) the source of the feedback. Must be one of "external" (default), "app", or "api".
   */
  public logFeedback(event: LogFeedbackFullArgs): void {
    logFeedbackImpl(this.state, this.parentObjectType(), this.lazyId, event);
  }

  /**
   * Update a span in the experiment using its id. It is important that you only update a span once the original span has been fully written and flushed,
   * since otherwise updates to the span may conflict with the original span.
   *
   * @param event The event data to update the span with. Must include `id`. See {@link Experiment.log} for a full list of valid fields.
   */
  public updateSpan(
    event: Omit<Partial<ExperimentEvent>, "id"> &
      Required<Pick<ExperimentEvent, "id">>,
  ): void {
    const { id, ...eventRest } = event;
    if (!id) {
      throw new Error("Span id is required to update a span");
    }
    updateSpanImpl({
      state: this.state,
      parentObjectType: this.parentObjectType(),
      parentObjectId: this.lazyId,
      id,
      event: eventRest,
    });
  }

  /**
   * Return a serialized representation of the experiment that can be used to start subspans in other places.
   *
   * See {@link Span.startSpan} for more details.
   */
  public async export(): Promise<string> {
    return new SpanComponentsV3({
      object_type: this.parentObjectType(),
      object_id: await this.id,
    }).toStr();
  }

  /**
   * Flush any pending rows to the server.
   */
  async flush(): Promise<void> {
    return await this.state.bgLogger().flush();
  }

  /**
   * @deprecated This function is deprecated. You can simply remove it from your code.
   */
  public async close(): Promise<string> {
    console.warn(
      "close is deprecated and will be removed in a future version of braintrust. It is now a no-op and can be removed",
    );
    return this.id;
  }
}

/**
 * A read-only view of an experiment, initialized by passing `open: true` to `init()`.
 */
export class ReadonlyExperiment extends ObjectFetcher<ExperimentEvent> {
  constructor(
    private state: BraintrustState,
    private readonly lazyMetadata: LazyValue<ProjectExperimentMetadata>,
  ) {
    super("experiment", undefined, (r) => enrichAttachments(r, state));
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
    return this.state;
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
          tags: record.tags,
        } as EvalCase<Input, Expected, void>;
      } else {
        yield {
          input: record.input as Input,
          expected: expected,
          tags: record.tags,
        } as unknown as EvalCase<Input, Expected, void>;
      }
    }
  }
}

let executionCounter = 0;

export function newId() {
  return uuidv4();
}

/**
 * Primary implementation of the `Span` interface. See {@link Span} for full details on each method.
 *
 * We suggest using one of the various `traced` methods, instead of creating Spans directly. See {@link Span.startSpan} for full details.
 */
export class SpanImpl implements Span {
  private _state: BraintrustState;

  private isMerge: boolean;
  private loggedEndTime: number | undefined;
  private propagatedEvent: StartSpanEventArgs | undefined;

  // For internal use only.
  private parentObjectType: SpanObjectTypeV3;
  private parentObjectId: LazyValue<string>;
  private parentComputeObjectMetadataArgs: Record<string, any> | undefined;
  private _id: string;
  private _spanId: string;
  private _rootSpanId: string;
  private _spanParents: string[] | undefined;

  public kind: "span" = "span";

  constructor(
    args: {
      state: BraintrustState;
      parentObjectType: SpanObjectTypeV3;
      parentObjectId: LazyValue<string>;
      parentComputeObjectMetadataArgs: Record<string, any> | undefined;
      parentSpanIds: ParentSpanIds | MultiParentSpanIds | undefined;
      defaultRootType?: SpanType;
      spanId?: string;
    } & Omit<StartSpanArgs, "parent">,
  ) {
    this._state = args.state;

    const spanAttributes = args.spanAttributes ?? {};
    const rawEvent = args.event ?? {};
    const type =
      args.type ?? (args.parentSpanIds ? undefined : args.defaultRootType);

    this.loggedEndTime = undefined;
    this.parentObjectType = args.parentObjectType;
    this.parentObjectId = args.parentObjectId;
    this.parentComputeObjectMetadataArgs = args.parentComputeObjectMetadataArgs;

    // Merge propagatedEvent into event. The propagatedEvent data will get
    // propagated-and-merged into every subspan.
    this.propagatedEvent = args.propagatedEvent;
    if (this.propagatedEvent) {
      mergeDicts(rawEvent, this.propagatedEvent);
    }
    const { id: eventId, ...event } = rawEvent;

    const callerLocation = iso.getCallerLocation();
    const name = (() => {
      if (args.name) return args.name;
      if (!args.parentSpanIds) return "root";
      if (callerLocation) {
        const pathComponents = callerLocation.caller_filename.split("/");
        const filename = pathComponents[pathComponents.length - 1];
        return [callerLocation.caller_functionname]
          .concat(
            filename ? [`${filename}:${callerLocation.caller_lineno}`] : [],
          )
          .join(":");
      }
      return "subspan";
    })();

    const internalData = {
      metrics: {
        start: args.startTime ?? getCurrentUnixTimestamp(),
      },
      context: { ...callerLocation },
      span_attributes: {
        name,
        type,
        ...spanAttributes,
        exec_counter: executionCounter++,
      },
      created: new Date().toISOString(),
    };

    this._id = eventId ?? uuidv4();
    this._spanId = args.spanId ?? uuidv4();
    if (args.parentSpanIds) {
      this._rootSpanId = args.parentSpanIds.rootSpanId;
      this._spanParents =
        "parentSpanIds" in args.parentSpanIds
          ? args.parentSpanIds.parentSpanIds
          : [args.parentSpanIds.spanId];
    } else {
      this._rootSpanId = this._spanId;
      this._spanParents = undefined;
    }

    // The first log is a replacement, but subsequent logs to the same span
    // object will be merges.
    this.isMerge = false;
    this.logInternal({ event, internalData });
    this.isMerge = true;
  }

  public get id(): string {
    return this._id;
  }

  public get spanId(): string {
    return this._spanId;
  }

  public get rootSpanId(): string {
    return this._rootSpanId;
  }

  public get spanParents(): string[] {
    return this._spanParents ?? [];
  }

  public setAttributes(args: Omit<StartSpanArgs, "event">): void {
    this.logInternal({ internalData: { span_attributes: args } });
  }

  public setSpanParents(parents: string[]): void {
    this.logInternal({ internalData: { span_parents: parents } });
  }

  public log(event: ExperimentLogPartialArgs): void {
    this.logInternal({ event });
  }

  private logInternal({
    event,
    internalData,
  }: {
    event?: ExperimentLogPartialArgs;
    // `internalData` contains fields that are not part of the "user-sanitized"
    // set of fields which we want to log in just one of the span rows.
    internalData?: Partial<ExperimentEvent>;
  }): void {
    const [serializableInternalData, lazyInternalData] = splitLoggingData({
      event,
      internalData,
    });

    // Deep copy mutable user data.
    const partialRecord = deepCopyEvent({
      id: this.id,
      span_id: this._spanId,
      root_span_id: this._rootSpanId,
      span_parents: this._spanParents,
      ...serializableInternalData,
      [IS_MERGE_FIELD]: this.isMerge,
    });

    if (partialRecord.metrics?.end) {
      this.loggedEndTime = partialRecord.metrics?.end as number;
    }

    if ((partialRecord.tags ?? []).length > 0 && this._spanParents?.length) {
      throw new Error("Tags can only be logged to the root span");
    }

    const computeRecord = async () => ({
      ...partialRecord,
      ...Object.fromEntries(
        await Promise.all(
          Object.entries(lazyInternalData).map(async ([key, value]) => [
            key,
            await value.get(),
          ]),
        ),
      ),
      ...new SpanComponentsV3({
        object_type: this.parentObjectType,
        object_id: await this.parentObjectId.get(),
      }).objectIdFields(),
    });
    this._state.bgLogger().log([new LazyValue(computeRecord)]);
  }

  public logFeedback(event: Omit<LogFeedbackFullArgs, "id">): void {
    logFeedbackImpl(this._state, this.parentObjectType, this.parentObjectId, {
      ...event,
      id: this.id,
    });
  }

  public traced<R>(
    callback: (span: Span) => R,
    args?: StartSpanArgs & SetCurrentArg,
  ): R {
    const { setCurrent, ...argsRest } = args ?? {};
    const span = this.startSpan(argsRest);
    return runCatchFinally(
      () => {
        if (setCurrent ?? true) {
          return withCurrent(span, callback);
        } else {
          return callback(span);
        }
      },
      (e) => {
        logError(span, e);
        throw e;
      },
      () => span.end(),
    );
  }

  public startSpan(args?: StartSpanArgs): Span {
    const parentSpanIds: ParentSpanIds | undefined = args?.parent
      ? undefined
      : { spanId: this._spanId, rootSpanId: this._rootSpanId };
    return new SpanImpl({
      state: this._state,
      ...args,
      ...startSpanParentArgs({
        state: this._state,
        parent: args?.parent,
        parentObjectType: this.parentObjectType,
        parentObjectId: this.parentObjectId,
        parentComputeObjectMetadataArgs: this.parentComputeObjectMetadataArgs,
        parentSpanIds,
        propagatedEvent: args?.propagatedEvent ?? this.propagatedEvent,
      }),
    });
  }

  public startSpanWithParents(
    spanId: string,
    spanParents: string[],
    args?: StartSpanArgs,
  ): Span {
    const parentSpanIds: MultiParentSpanIds = {
      parentSpanIds: spanParents,
      rootSpanId: this._rootSpanId,
    };
    return new SpanImpl({
      state: this._state,
      ...args,
      ...startSpanParentArgs({
        state: this._state,
        parent: args?.parent,
        parentObjectType: this.parentObjectType,
        parentObjectId: this.parentObjectId,
        parentComputeObjectMetadataArgs: this.parentComputeObjectMetadataArgs,
        parentSpanIds,
        propagatedEvent: args?.propagatedEvent ?? this.propagatedEvent,
      }),
      spanId,
    });
  }

  public end(args?: EndSpanArgs): number {
    let endTime: number;
    let internalData: Partial<ExperimentEvent> = {};
    if (!this.loggedEndTime) {
      endTime = args?.endTime ?? getCurrentUnixTimestamp();
      internalData = { metrics: { end: endTime } };
    } else {
      endTime = this.loggedEndTime;
    }
    this.logInternal({ internalData });
    return endTime;
  }

  public async export(): Promise<string> {
    return new SpanComponentsV3({
      object_type: this.parentObjectType,
      ...(this.parentComputeObjectMetadataArgs &&
      !this.parentObjectId.hasSucceeded
        ? { compute_object_metadata_args: this.parentComputeObjectMetadataArgs }
        : { object_id: await this.parentObjectId.get() }),
      row_id: this.id,
      span_id: this._spanId,
      root_span_id: this._rootSpanId,
      propagated_event: this.propagatedEvent,
    }).toStr();
  }

  public async permalink(): Promise<string> {
    return await permalink(await this.export(), {
      state: this._state,
    });
  }

  public link(): string {
    if (!this.id) {
      return NOOP_SPAN_PERMALINK;
    }

    try {
      const orgName = this._state.orgName;
      if (!orgName) {
        throw new Error("log-in-or-provide-org-name");
      }

      return this._link(orgName);
    } catch (e) {
      return getErrPermlink(e instanceof Error ? e.message : String(e));
    }
  }

  _link(orgName: string): string {
    const appUrl = this._state.appUrl || "https://www.braintrust.dev";
    const baseUrl = `${appUrl}/app/${orgName}`;

    // NOTE[matt]: I believe lazy values should not exist in the span or the logger.
    // Nothing in this module should have the possibility of blocking with the lone exception of
    // flush() which should be a clear exception. We shouldn't build on it and
    // plan to remove it in the future.
    const args = this.parentComputeObjectMetadataArgs;

    switch (this.parentObjectType) {
      case SpanObjectTypeV3.PROJECT_LOGS: {
        // Links to spans require a project id or name. We might not either, so use whatever
        // we can to make a link without making a roundtrip to the server.
        const projectID =
          args?.project_id || this.parentObjectId.getSync().value;
        const projectName = args?.project_name;
        if (projectID) {
          return `${baseUrl}/object?object_type=project_logs&object_id=${projectID}&id=${this._id}`;
        } else if (projectName) {
          return `${baseUrl}/p/${projectName}/logs?oid=${this._id}`;
        } else {
          return getErrPermlink("provide-project-name-or-id");
        }
      }
      case SpanObjectTypeV3.EXPERIMENT: {
        // Experiment links require an id, so the sync version will only work after the experiment is
        // resolved.
        const expID =
          args?.experiment_id || this.parentObjectId?.getSync()?.value;
        if (!expID) {
          return getErrPermlink("provide-experiment-id");
        } else {
          return `${baseUrl}/object?object_type=experiment&object_id=${expID}&id=${this._id}`;
        }
      }
      case SpanObjectTypeV3.PLAYGROUND_LOGS: {
        // FIXME[matt] I dont believe these are used in the SDK.
        return NOOP_SPAN_PERMALINK;
      }
      default: {
        // trigger a compile-time error if we add a new object type
        const _exhaustive: never = this.parentObjectType;
        _exhaustive;
        return NOOP_SPAN_PERMALINK;
      }
    }
  }

  async flush(): Promise<void> {
    return await this._state.bgLogger().flush();
  }

  public close(args?: EndSpanArgs): number {
    return this.end(args);
  }

  public state(): BraintrustState {
    return this._state;
  }
}

function splitLoggingData({
  event,
  internalData,
}: {
  event?: ExperimentLogPartialArgs;
  // `internalData` contains fields that are not part of the "user-sanitized"
  // set of fields which we want to log in just one of the span rows.
  internalData?: Partial<ExperimentEvent>;
}): [Partial<typeof internalData>, Record<string, LazyValue<unknown>>] {
  // There should be no overlap between the dictionaries being merged,
  // except for `sanitized` and `internalData`, where the former overrides
  // the latter.
  const sanitized = validateAndSanitizeExperimentLogPartialArgs(event ?? {});

  const sanitizedAndInternalData: Partial<typeof internalData> &
    Partial<typeof sanitized> = {};
  mergeDicts(sanitizedAndInternalData, internalData || {});
  mergeDicts(sanitizedAndInternalData, sanitized);

  const serializableInternalData: typeof sanitizedAndInternalData = {};
  const lazyInternalData: Record<string, LazyValue<unknown>> = {};

  for (const [key, value] of Object.entries(sanitizedAndInternalData) as [
    keyof typeof sanitizedAndInternalData,
    any,
  ][]) {
    if (value instanceof BraintrustStream) {
      const streamCopy = value.copy();
      lazyInternalData[key] = new LazyValue(async () => {
        return await new Promise((resolve, reject) => {
          streamCopy
            .toReadableStream()
            .pipeThrough(createFinalValuePassThroughStream(resolve, reject))
            .pipeTo(devNullWritableStream());
        });
      });
    } else if (value instanceof ReadableStream) {
      lazyInternalData[key] = new LazyValue(async () => {
        return await new Promise((resolve, reject) => {
          value
            .pipeThrough(createFinalValuePassThroughStream(resolve, reject))
            .pipeTo(devNullWritableStream());
        });
      });
    } else {
      serializableInternalData[key] = value;
    }
  }

  return [serializableInternalData, lazyInternalData];
}

/**
 * A dataset is a collection of records, such as model inputs and expected outputs, which represent
 * data you can use to evaluate and fine-tune models. You can log production data to datasets,
 * curate them with interesting examples, edit/delete records, and run evaluations against them.
 *
 * You should not create `Dataset` objects directly. Instead, use the `braintrust.initDataset()` method.
 */
export class Dataset<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET,
> extends ObjectFetcher<DatasetRecord<IsLegacyDataset>> {
  private readonly lazyMetadata: LazyValue<ProjectDatasetMetadata>;
  private readonly __braintrust_dataset_marker = true;
  private newRecords = 0;

  constructor(
    private state: BraintrustState,
    lazyMetadata: LazyValue<ProjectDatasetMetadata>,
    pinnedVersion?: string,
    legacy?: IsLegacyDataset,
    _internal_btql?: Record<string, unknown>,
  ) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const isLegacyDataset = (legacy ??
      DEFAULT_IS_LEGACY_DATASET) as IsLegacyDataset;
    if (isLegacyDataset) {
      console.warn(
        `Records will be fetched from this dataset in the legacy format, with the "expected" field renamed to "output". Please update your code to use "expected", and use \`braintrust.initDataset()\` with \`{ useOutput: false }\`, which will become the default in a future version of Braintrust.`,
      );
    }
    super(
      "dataset",
      pinnedVersion,
      (r: AnyDatasetRecord) =>
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        ensureDatasetRecord(
          enrichAttachments(r, this.state),
          isLegacyDataset,
        ) as WithTransactionId<DatasetRecord<IsLegacyDataset>>,
      _internal_btql,
    );
    this.lazyMetadata = lazyMetadata;
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
    return this.state;
  }

  private validateEvent({
    metadata,
    expected,
    output,
    tags,
  }: {
    metadata?: Record<string, unknown>;
    expected?: unknown;
    output?: unknown;
    tags?: string[];
  }) {
    if (metadata !== undefined) {
      for (const key of Object.keys(metadata)) {
        if (typeof key !== "string") {
          throw new Error("metadata keys must be strings");
        }
      }
    }

    if (expected !== undefined && output !== undefined) {
      throw new Error(
        "Only one of expected or output (deprecated) can be specified. Prefer expected.",
      );
    }

    if (tags) {
      validateTags(tags);
    }
  }

  private createArgs({
    id,
    input,
    expected,
    metadata,
    tags,
    output,
    isMerge,
  }: {
    id: string;
    input?: unknown;
    expected?: unknown;
    metadata?: Record<string, unknown>;
    tags?: string[];
    output?: unknown;
    isMerge?: boolean;
  }): LazyValue<BackgroundLogEvent> {
    return new LazyValue(async () => {
      const dataset_id = await this.id;
      const expectedValue = expected === undefined ? output : expected;

      const args: BackgroundLogEvent = {
        id,
        input,
        expected: expectedValue,
        tags,
        dataset_id,
        created: !isMerge ? new Date().toISOString() : undefined, //if we're merging/updating an event we will not add this ts
        metadata,
        ...(!!isMerge
          ? {
              [IS_MERGE_FIELD]: true,
            }
          : {}),
      };

      return args;
    });
  }

  /**
   * Insert a single record to the dataset. The record will be batched and uploaded behind the scenes. If you pass in an `id`,
   * and a record with that `id` already exists, it will be overwritten (upsert).
   *
   * @param event The event to log.
   * @param event.input The argument that uniquely define an input case (an arbitrary, JSON serializable object).
   * @param event.expected The output of your application, including post-processing (an arbitrary, JSON serializable object).
   * @param event.tags (Optional) a list of strings that you can use to filter and group records later.
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
    tags,
    id,
    output,
  }: {
    readonly input?: unknown;
    readonly expected?: unknown;
    readonly tags?: string[];
    readonly metadata?: Record<string, unknown>;
    readonly id?: string;
    readonly output?: unknown;
  }): string {
    this.validateEvent({ metadata, expected, output, tags });

    const rowId = id || uuidv4();
    const args = this.createArgs(
      deepCopyEvent({
        id: rowId,
        input,
        expected,
        metadata,
        tags,
        output,
        isMerge: false,
      }),
    );

    this.state.bgLogger().log([args]);
    this.newRecords++;
    return rowId;
  }

  /**
   * Update fields of a single record in the dataset. The updated fields will be batched and uploaded behind the scenes.
   * You must pass in an `id` of the record to update. Only the fields provided will be updated; other fields will remain unchanged.
   *
   * @param event The fields to update in the record.
   * @param event.id The unique identifier of the record to update.
   * @param event.input (Optional) The new input value for the record (an arbitrary, JSON serializable object).
   * @param event.expected (Optional) The new expected output value for the record (an arbitrary, JSON serializable object).
   * @param event.tags (Optional) A list of strings to update the tags of the record.
   * @param event.metadata (Optional) A dictionary to update the metadata of the record. The values in `metadata` can be any
   * JSON-serializable type, but its keys must be strings.
   * @returns The `id` of the updated record.
   */
  public update({
    input,
    expected,
    metadata,
    tags,
    id,
  }: {
    readonly id: string;
    readonly input?: unknown;
    readonly expected?: unknown;
    readonly tags?: string[];
    readonly metadata?: Record<string, unknown>;
  }): string {
    this.validateEvent({ metadata, expected, tags });

    const args = this.createArgs(
      deepCopyEvent({
        id,
        input,
        expected,
        metadata,
        tags,
        isMerge: true,
      }),
    );

    this.state.bgLogger().log([args]);
    return id;
  }

  public delete(id: string): string {
    const args = new LazyValue(async () => ({
      id,
      dataset_id: await this.id,
      created: new Date().toISOString(),
      _object_delete: true,
    }));

    this.state.bgLogger().log([args]);
    return id;
  }

  /**
   * Summarize the dataset, including high level metrics about its size and other metadata.
   * @param summarizeData Whether to summarize the data. If false, only the metadata will be returned.
   * @returns `DatasetSummary`
   * @returns A summary of the dataset.
   */
  public async summarize(
    options: { readonly summarizeData?: boolean } = {},
  ): Promise<DatasetSummary> {
    const { summarizeData = true } = options || {};

    await this.flush();
    const state = await this.getState();
    const projectUrl = `${state.appPublicUrl}/app/${encodeURIComponent(
      state.orgName!,
    )}/p/${encodeURIComponent((await this.project).name)}`;
    const datasetUrl = `${projectUrl}/datasets/${encodeURIComponent(
      await this.name,
    )}`;

    let dataSummary: DataSummary | undefined;
    if (summarizeData) {
      const rawDataSummary = z
        .object({
          total_records: z.number(),
        })
        .parse(
          await state.apiConn().get_json(
            "dataset-summary",
            {
              dataset_id: await this.id,
            },
            3,
          ),
        );
      dataSummary = {
        newRecords: this.newRecords,
        totalRecords: rawDataSummary.total_records,
      };
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
    return await this.state.bgLogger().flush();
  }

  /**
   * @deprecated This function is deprecated. You can simply remove it from your code.
   */
  public async close(): Promise<string> {
    console.warn(
      "close is deprecated and will be removed in a future version of braintrust. It is now a no-op and can be removed",
    );
    return this.id;
  }

  public static isDataset(data: unknown): data is Dataset {
    return (
      typeof data === "object" &&
      data !== null &&
      "__braintrust_dataset_marker" in data
    );
  }
}

export type CompiledPromptParams = Omit<
  NonNullable<PromptData["options"]>["params"],
  "use_cache"
> & { model: NonNullable<NonNullable<PromptData["options"]>["model"]> };

export type ChatPrompt = {
  messages: OpenAIMessage[];
  tools?: Tools;
};
export type CompletionPrompt = {
  prompt: string;
};

export type CompiledPrompt<Flavor extends "chat" | "completion"> =
  CompiledPromptParams & {
    span_info?: {
      name?: string;
      spanAttributes?: Record<any, any>;
      metadata: {
        prompt: {
          variables: Record<string, unknown>;
          id: string;
          project_id: string;
          version: string;
        };
      };
    };
  } & (Flavor extends "chat"
      ? ChatPrompt
      : Flavor extends "completion"
        ? CompletionPrompt
        : {});

export type DefaultPromptArgs = Partial<
  CompiledPromptParams & AnyModelParam & ChatPrompt & CompletionPrompt
>;

export function renderMessage<T extends Message>(
  render: (template: string) => string,
  message: T,
): T {
  return {
    ...message,
    ...("content" in message
      ? {
          content: isEmpty(message.content)
            ? undefined
            : typeof message.content === "string"
              ? render(message.content)
              : message.content.map((c) => {
                  switch (c.type) {
                    case "text":
                      return { ...c, text: render(c.text) };
                    case "image_url":
                      return {
                        ...c,
                        image_url: {
                          ...c.image_url,
                          url: render(c.image_url.url),
                        },
                      };
                    default:
                      const _exhaustiveCheck: never = c;
                      return _exhaustiveCheck;
                  }
                }),
        }
      : {}),
    ...("tool_calls" in message
      ? {
          tool_calls: isEmpty(message.tool_calls)
            ? undefined
            : message.tool_calls.map((t) => {
                return {
                  type: t.type,
                  id: render(t.id),
                  function: {
                    name: render(t.function.name),
                    arguments: render(t.function.arguments),
                  },
                };
              }),
        }
      : {}),
    ...("tool_call_id" in message
      ? {
          tool_call_id: render(message.tool_call_id),
        }
      : {}),
  };
}

export type PromptRowWithId<
  HasId extends boolean = true,
  HasVersion extends boolean = true,
> = Omit<PromptRow, "log_id" | "org_id" | "project_id" | "id" | "_xact_id"> &
  Partial<Pick<PromptRow, "project_id">> &
  (HasId extends true
    ? Pick<PromptRow, "id">
    : Partial<Pick<PromptRow, "id">>) &
  (HasVersion extends true
    ? Pick<PromptRow, "_xact_id">
    : Partial<Pick<PromptRow, "_xact_id">>);

export function deserializePlainStringAsJSON(s: string) {
  if (s.trim() === "") {
    return { value: null, error: undefined };
  }

  try {
    return { value: JSON.parse(s), error: undefined };
  } catch (e) {
    return { value: s, error: e };
  }
}

function renderTemplatedObject(
  obj: unknown,
  args: Record<string, unknown>,
  options: { strict?: boolean },
): unknown {
  if (typeof obj === "string") {
    if (options.strict) {
      lintTemplate(obj, args);
    }
    return Mustache.render(obj, args, undefined, {
      escape: (value) => {
        if (typeof value === "string") {
          return value;
        } else {
          return JSON.stringify(value);
        }
      },
    });
  } else if (isArray(obj)) {
    return obj.map((item) => renderTemplatedObject(item, args, options));
  } else if (isObject(obj)) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key,
        renderTemplatedObject(value, args, options),
      ]),
    );
  }
  return obj;
}

export function renderPromptParams(
  params: ModelParams | undefined,
  args: Record<string, unknown>,
  options: { strict?: boolean },
): ModelParams | undefined {
  const schemaParsed = z
    .object({
      response_format: z.object({
        type: z.literal("json_schema"),
        json_schema: responseFormatJsonSchemaSchema
          .omit({ schema: true })
          .extend({
            schema: z.unknown(),
          }),
      }),
    })
    .safeParse(params);
  if (schemaParsed.success) {
    const rawSchema = schemaParsed.data.response_format.json_schema.schema;
    const templatedSchema = renderTemplatedObject(rawSchema, args, options);
    const parsedSchema =
      typeof templatedSchema === "string"
        ? deserializePlainStringAsJSON(templatedSchema).value
        : templatedSchema;

    return {
      ...params,
      response_format: {
        ...schemaParsed.data.response_format,
        json_schema: {
          ...schemaParsed.data.response_format.json_schema,
          schema: parsedSchema,
        },
      },
    };
  }
  return params;
}

export class Prompt<
  HasId extends boolean = true,
  HasVersion extends boolean = true,
> {
  private parsedPromptData: PromptData | undefined;
  private hasParsedPromptData = false;
  private readonly __braintrust_prompt_marker = true;

  constructor(
    private metadata: PromptRowWithId<HasId, HasVersion> | PromptSessionEvent,
    private defaults: DefaultPromptArgs,
    private noTrace: boolean,
  ) {}

  public get id(): HasId extends true ? string : string | undefined {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return this.metadata.id as HasId extends true ? string : string | undefined;
  }

  public get projectId(): string | undefined {
    return this.metadata.project_id;
  }

  public get name(): string {
    return "name" in this.metadata
      ? this.metadata.name
      : `Playground function ${this.metadata.id}`;
  }

  public get slug(): string {
    return "slug" in this.metadata ? this.metadata.slug : this.metadata.id;
  }

  public get prompt(): PromptData["prompt"] {
    return this.getParsedPromptData()?.prompt;
  }

  public get version(): HasId extends true
    ? TransactionId
    : TransactionId | undefined {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return this.metadata[TRANSACTION_ID_FIELD] as HasId extends true
      ? TransactionId
      : TransactionId | undefined;
  }

  public get options(): NonNullable<PromptData["options"]> {
    return this.getParsedPromptData()?.options || {};
  }

  public get promptData(): PromptData {
    return this.getParsedPromptData()!;
  }

  /**
   * Build the prompt with the given formatting options. The args you pass in will
   * be forwarded to the mustache template that defines the prompt and rendered with
   * the `mustache-js` library.
   *
   * @param buildArgs Args to forward along to the prompt template.
   */
  public build<Flavor extends "chat" | "completion" = "chat">(
    buildArgs: unknown,
    options: {
      flavor?: Flavor;
      messages?: Message[];
      strict?: boolean;
    } = {},
  ): CompiledPrompt<Flavor> {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return this.runBuild(buildArgs, {
      flavor: options.flavor ?? "chat",
      messages: options.messages,
      strict: options.strict,
    }) as CompiledPrompt<Flavor>;
  }

  private runBuild<Flavor extends "chat" | "completion">(
    buildArgs: unknown,
    options: {
      flavor: Flavor;
      messages?: Message[];
      strict?: boolean;
    },
  ): CompiledPrompt<Flavor> {
    const { flavor } = options;

    const params = {
      ...this.defaults,
      ...Object.fromEntries(
        Object.entries(this.options.params || {}).filter(
          ([k, _v]) => !BRAINTRUST_PARAMS.includes(k),
        ),
      ),
      ...(!isEmpty(this.options.model)
        ? {
            model: this.options.model,
          }
        : {}),
    };

    if (!("model" in params) || isEmpty(params.model)) {
      throw new Error(
        "No model specified. Either specify it in the prompt or as a default",
      );
    }

    const spanInfo = this.noTrace
      ? {}
      : {
          span_info: {
            metadata: {
              prompt: this.id
                ? {
                    variables: buildArgs,
                    id: this.id,
                    project_id: this.projectId,
                    version: this.version,
                    ...("prompt_session_id" in this.metadata
                      ? { prompt_session_id: this.metadata.prompt_session_id }
                      : {}),
                  }
                : undefined,
            },
          },
        };

    const prompt = this.prompt;

    if (!prompt) {
      throw new Error("Empty prompt");
    }

    const escape = (v: unknown) => {
      if (v === undefined) {
        throw new Error("Missing!");
      } else if (typeof v === "string") {
        return v;
      } else {
        return JSON.stringify(v);
      }
    };

    const dictArgParsed = z.record(z.unknown()).safeParse(buildArgs);
    const variables: Record<string, unknown> = {
      input: buildArgs,
      ...(dictArgParsed.success ? dictArgParsed.data : {}),
    };

    const renderedPrompt = Prompt.renderPrompt({
      prompt,
      buildArgs,
      options,
    });

    if (flavor === "chat") {
      if (renderedPrompt.type !== "chat") {
        throw new Error(
          "Prompt is a completion prompt. Use buildCompletion() instead",
        );
      }

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return {
        ...renderPromptParams(params, variables, { strict: options.strict }),
        ...spanInfo,
        messages: renderedPrompt.messages,
        ...(renderedPrompt.tools
          ? {
              tools: toolsSchema.parse(JSON.parse(renderedPrompt.tools)),
            }
          : undefined),
      } as CompiledPrompt<Flavor>;
    } else if (flavor === "completion") {
      if (renderedPrompt.type !== "completion") {
        throw new Error(`Prompt is a chat prompt. Use flavor: 'chat' instead`);
      }

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return {
        ...renderPromptParams(params, variables, { strict: options.strict }),
        ...spanInfo,
        prompt: renderedPrompt.content,
      } as CompiledPrompt<Flavor>;
    } else {
      throw new Error("never!");
    }
  }

  static renderPrompt({
    prompt,
    buildArgs,
    options,
  }: {
    prompt: PromptBlockData;
    buildArgs: unknown;
    options: {
      strict?: boolean;
      messages?: Message[];
    };
  }): PromptBlockData {
    const escape = (v: unknown) => {
      if (v === undefined) {
        throw new Error("Missing!");
      } else if (typeof v === "string") {
        return v;
      } else {
        return JSON.stringify(v);
      }
    };

    const dictArgParsed = z.record(z.unknown()).safeParse(buildArgs);
    const variables: Record<string, unknown> = {
      input: buildArgs,
      ...(dictArgParsed.success ? dictArgParsed.data : {}),
    };

    if (prompt.type === "chat") {
      const render = (template: string) => {
        if (options.strict) {
          lintTemplate(template, variables);
        }

        return Mustache.render(template, variables, undefined, {
          escape,
        });
      };

      const baseMessages = (prompt.messages || []).map((m) =>
        renderMessage(render, m),
      );
      const hasSystemPrompt = baseMessages.some((m) => m.role === "system");

      const messages: Message[] = [
        ...baseMessages,
        ...(options.messages ?? []).filter(
          (m) => !(hasSystemPrompt && m.role === "system"),
        ),
      ];

      return {
        type: "chat",
        messages: messages,
        ...(prompt.tools?.trim()
          ? {
              tools: render(prompt.tools),
            }
          : undefined),
      };
    } else if (prompt.type === "completion") {
      if (options.messages) {
        throw new Error(
          "extra messages are not supported for completion prompts",
        );
      }

      if (options.strict) {
        lintTemplate(prompt.content, variables);
      }

      return {
        type: "completion",
        content: Mustache.render(prompt.content, variables, undefined, {
          escape,
        }),
      };
    } else {
      const _: never = prompt;
      throw new Error("never!");
    }
  }

  private getParsedPromptData(): PromptData | undefined {
    if (!this.hasParsedPromptData) {
      this.parsedPromptData = promptDataSchema.parse(this.metadata.prompt_data);
      this.hasParsedPromptData = true;
    }
    return this.parsedPromptData!;
  }

  public static isPrompt(data: unknown): data is Prompt<boolean, boolean> {
    return (
      typeof data === "object" &&
      data !== null &&
      "__braintrust_prompt_marker" in data
    );
  }
  public static fromPromptData(
    name: string,
    promptData: PromptData,
  ): Prompt<false, false> {
    return new Prompt(
      {
        name: name,
        slug: name,
        prompt_data: promptData,
      },
      {},
      false,
    );
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
  diff?: number;
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
  diff?: number;
  improvements: number;
  regressions: number;
}

/**
 * Summary of an experiment's scores and metadata.
 * @property projectName Name of the project that the experiment belongs to.
 * @property experimentName Name of the experiment.
 * @property experimentId ID of the experiment. May be `undefined` if the eval was run locally.
 * @property projectUrl URL to the project's page in the Braintrust app.
 * @property experimentUrl URL to the experiment's page in the Braintrust app.
 * @property comparisonExperimentName The experiment scores are baselined against.
 * @property scores Summary of the experiment's scores.
 */
export interface ExperimentSummary {
  projectName: string;
  experimentName: string;
  projectId?: string;
  experimentId?: string;
  projectUrl?: string;
  experimentUrl?: string;
  comparisonExperimentName?: string;
  scores: Record<string, ScoreSummary>;
  metrics?: Record<string, MetricSummary>;
}

/**
 * Summary of a dataset's data.
 *
 * @property totalRecords Total records in the dataset.
 */
export interface DataSummary {
  /**
   * New or updated records added in this session.
   */
  newRecords: number;
  /**
   * Total records in the dataset.
   */
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
  dataSummary: DataSummary | undefined;
}

/**
 * Allows accessing helper functions for testing.
 * @internal
 */

// it's used to circumvent login for testing, but won't actually work
// on the server side.
const TEST_API_KEY = "___TEST_API_KEY__THIS_IS_NOT_REAL___";

// This is a helper function to simulate a login for testing.
async function simulateLoginForTests() {
  return await login({
    apiKey: TEST_API_KEY,
    appUrl: "https://braintrust.dev",
  });
}

// This is a helper function to simulate a logout for testing.
function simulateLogoutForTests() {
  _globalState.resetLoginInfo();
  _globalState.appUrl = "https://www.braintrust.dev";
  return _globalState;
}

export const _exportsForTestingOnly = {
  extractAttachments,
  deepCopyEvent,
  useTestBackgroundLogger,
  clearTestBackgroundLogger,
  simulateLoginForTests,
  simulateLogoutForTests,
};
