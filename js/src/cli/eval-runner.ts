#!/usr/bin/env node

/**
 * eval-runner.ts — Standalone eval runner for the two-process architecture.
 *
 * This script is spawned as a child process by the `braintrust eval` CLI orchestrator.
 * It loads user eval files via native `import()` (with CJS fallback), collects
 * registered evaluators, runs them, and streams progress/results back to the
 * orchestrator over a Unix socket (or TCP) using SSE framing.
 *
 * Environment variables:
 *   BT_EVAL_SSE_SOCK — Unix socket path for SSE communication
 *   BT_EVAL_SSE_ADDR — TCP host:port alternative to socket
 *   BT_EVAL_NO_SEND_LOGS / BT_EVAL_LOCAL — run without sending logs
 *   BT_EVAL_FILTERS — JSON-serialized filter expressions
 *   BT_EVAL_LIST — "1" to list evaluator names and exit
 *   BT_EVAL_DEV — "1" to start dev server instead of running evals
 *   BT_EVAL_DEV_HOST — dev server host (default: localhost)
 *   BT_EVAL_DEV_PORT — dev server port (default: 8300)
 *   BT_EVAL_DEV_ORG_NAME — dev server org name restriction
 *   BT_EVAL_CJS — "1" to force CJS loading
 *   BRAINTRUST_API_KEY, BRAINTRUST_API_URL, BRAINTRUST_DEFAULT_PROJECT — auth
 */

import { createRequire } from "module";
import net from "net";
import path from "path";
import { pathToFileURL } from "url";

import {
  Eval as BraintrustEval,
  _initializeSpanContext,
  parseFilters,
} from "../framework";
import type { EvaluatorDef, Filter } from "../framework";
import type { ReporterDef } from "../reporters/types";
import type { ProgressReporter } from "../reporters/types";
import { login } from "../logger";
import type { BaseMetadata } from "../logger";
import { configureNode } from "../node";

// Initialize Node.js adapters at module load time
configureNode();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EvaluatorEntry = {
  evaluator: EvaluatorDef<unknown, unknown, unknown, BaseMetadata>;
  reporter?: ReporterDef<unknown> | string;
};

type EvalResult = {
  results: Array<{ error?: unknown }>;
  summary: unknown;
};

type EvalOptions = Record<string, unknown> & {
  progress?: Partial<ProgressReporter>;
  stream?: (data: unknown) => void;
  onStart?: (data: unknown) => void;
  reporter?: unknown;
  noSendLogs?: boolean;
  filters?: Filter[];
};

type EvalFunction = (
  projectName: string,
  evaluator: Record<string, unknown>,
  options?: EvalOptions,
) => Promise<EvalResult>;

type BtEvalMain = (context: BtEvalContext) => void | Promise<void>;

type BtEvalContext = {
  Eval: EvalFunction;
  runEval: (
    projectName: string,
    evaluator: Record<string, unknown>,
    options?: EvalOptions,
  ) => Promise<EvalResult>;
  runRegisteredEvals: () => Promise<boolean>;
  makeEvalOptions: (
    evaluatorName: string,
    options?: EvalOptions,
  ) => EvalOptions | undefined;
  sendConsole: (message: string, stream?: "stdout" | "stderr") => void;
  sendEvent: (event: string, data: unknown) => void;
};

type SseWriter = {
  send: (event: string, data: unknown) => void;
  close: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeFiles(files: string[]): string[] {
  return files.map((file) => path.resolve(process.cwd(), file));
}

function serializeSseEvent(event: { event?: string; data: string }): string {
  return (
    Object.entries(event)
      .filter(([_key, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n") + "\n\n"
  );
}

function createSseWriter(): SseWriter | null {
  const sock = process.env.BT_EVAL_SSE_SOCK;
  if (sock) {
    const socket = net.createConnection({ path: sock });
    socket.on("error", (err) => {
      console.error(`Failed to connect to SSE socket: ${err.message}`);
      process.exitCode = 1;
    });
    const send = (event: string, payload: unknown) => {
      if (!socket.writable) {
        return;
      }
      const data =
        typeof payload === "string" ? payload : JSON.stringify(payload);
      socket.write(serializeSseEvent({ event, data }));
    };
    const close = () => {
      socket.end();
    };
    return { send, close };
  }

  const addr = process.env.BT_EVAL_SSE_ADDR;
  if (!addr) {
    return null;
  }

  const [host, portStr] = addr.split(":");
  const port = Number(portStr);
  if (!host || !Number.isFinite(port)) {
    throw new Error(`Invalid BT_EVAL_SSE_ADDR: ${addr}`);
  }

  const socket = net.createConnection({ host, port });
  socket.setNoDelay(true);

  const send = (event: string, payload: unknown) => {
    if (!socket.writable) {
      return;
    }
    const data =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    socket.write(serializeSseEvent({ event, data }));
  };

  const close = () => {
    socket.end();
  };

  return { send, close };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

function initRegistry() {
  globalThis._evals = {
    functions: [],
    prompts: [],
    parameters: [],
    evaluators: {},
    reporters: {},
  };
  globalThis._lazy_load = true;
}

function getEvaluators(): EvaluatorEntry[] {
  const evals = globalThis._evals;
  if (!evals || !evals.evaluators) {
    return [];
  }
  return Object.values(evals.evaluators) as EvaluatorEntry[];
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

async function loadFiles(files: string[]): Promise<unknown[]> {
  const modules: unknown[] = [];
  for (const file of files) {
    const fileUrl = pathToFileURL(file).href;
    try {
      const mod = await import(fileUrl);
      modules.push(mod);
    } catch (err) {
      if (shouldTryRequire(file, err)) {
        try {
          const require = createRequire(fileUrl);
          const mod = require(file);
          modules.push(mod);
          continue;
        } catch (requireErr) {
          throw new Error(
            `Failed to load ${file} as ESM (${formatError(err)}) or CJS (${formatError(requireErr)}).`,
          );
        }
      }
      throw err;
    }
  }
  return modules;
}

function shouldTryRequire(file: string, err: unknown): boolean {
  if (process.env.BT_EVAL_CJS === "1" || file.endsWith(".cjs")) {
    return true;
  }
  if (!(err instanceof Error)) {
    return false;
  }
  const message = err.message || "";
  return (
    message.includes("require is not defined") ||
    message.includes("exports is not defined") ||
    message.includes("module is not defined") ||
    message.includes("Cannot use import statement outside a module")
  );
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// btEvalMain detection
// ---------------------------------------------------------------------------

function extractBtEvalMain(mod: unknown): BtEvalMain | null {
  if (!mod || typeof mod !== "object") {
    return null;
  }
  const candidate = mod as Record<string, unknown>;
  if (typeof candidate.btEvalMain === "function") {
    return candidate.btEvalMain as BtEvalMain;
  }
  const defaultExport = candidate.default as
    | Record<string, unknown>
    | undefined;
  if (defaultExport && typeof defaultExport.btEvalMain === "function") {
    return defaultExport.btEvalMain as BtEvalMain;
  }
  return null;
}

function collectBtEvalMains(mods: unknown[]): BtEvalMain[] {
  const mains: BtEvalMain[] = [];
  for (const mod of mods) {
    const main = extractBtEvalMain(mod);
    if (main) {
      mains.push(main);
    }
  }
  return mains;
}

// ---------------------------------------------------------------------------
// SSE progress helpers
// ---------------------------------------------------------------------------

function createEvalProgressReporter(
  sse: SseWriter | null,
  evaluatorName: string,
): ProgressReporter {
  let activeName = evaluatorName;
  return {
    start: (name: string, total: number) => {
      activeName = name;
      sendEvalProgress(sse, name, "start", total);
    },
    stop: () => {
      if (activeName) {
        sendEvalProgress(sse, activeName, "stop");
      }
    },
    increment: (name: string) => {
      sendEvalProgress(sse, name, "increment");
    },
    setTotal: (name: string, total: number) => {
      sendEvalProgress(sse, name, "set_total", total);
    },
  };
}

function sendEvalProgress(
  sse: SseWriter | null,
  evaluatorName: string,
  kind: "start" | "increment" | "set_total" | "stop",
  total?: number,
) {
  if (!sse) {
    return;
  }
  sse.send("progress", {
    id: `eval-progress:${evaluatorName}`,
    object_type: "task",
    format: "global",
    output_type: "any",
    name: evaluatorName,
    event: "progress",
    data: JSON.stringify({
      type: "eval_progress",
      kind,
      ...(total !== undefined ? { total } : {}),
    }),
  });
}

function serializeError(err: unknown) {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

function sendConsole(
  sse: SseWriter | null,
  message: string,
  stream: "stdout" | "stderr" = "stderr",
) {
  if (!sse) {
    if (stream === "stderr") {
      console.error(message);
    } else {
      console.log(message);
    }
    return;
  }
  sse.send("console", { stream, message });
}

// ---------------------------------------------------------------------------
// Env-based configuration
// ---------------------------------------------------------------------------

function shouldDisableSendLogs(): boolean {
  return (
    process.env.BT_EVAL_NO_SEND_LOGS === "1" ||
    process.env.BT_EVAL_LOCAL === "1"
  );
}

function getFiltersFromEnv(): Filter[] {
  const raw = process.env.BT_EVAL_FILTERS;
  if (!raw) {
    return [];
  }
  try {
    const filterStrings: string[] = JSON.parse(raw);
    return parseFilters(filterStrings);
  } catch {
    return [];
  }
}

function isListMode(): boolean {
  return process.env.BT_EVAL_LIST === "1";
}

function isDevMode(): boolean {
  return process.env.BT_EVAL_DEV === "1";
}

// ---------------------------------------------------------------------------
// Eval option merging
// ---------------------------------------------------------------------------

function getEvaluatorName(
  evaluator: Record<string, unknown>,
  fallback: string,
): string {
  const candidate = evaluator.evalName ?? evaluator.name ?? evaluator.task;
  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }
  return fallback;
}

function mergeEvalOptions(
  base: EvalOptions,
  overrides?: EvalOptions,
): EvalOptions {
  if (!overrides) {
    return base;
  }

  const merged: EvalOptions = { ...base, ...overrides };

  const baseProgress = base.progress as Record<string, unknown> | undefined;
  const overrideProgress = overrides.progress as
    | Record<string, unknown>
    | undefined;
  if (baseProgress || overrideProgress) {
    merged.progress = mergeProgress(baseProgress, overrideProgress);
  }

  const baseStream = base.stream as ((data: unknown) => void) | undefined;
  const overrideStream = overrides.stream as
    | ((data: unknown) => void)
    | undefined;
  if (baseStream || overrideStream) {
    merged.stream = mergeHandlers(baseStream, overrideStream);
  }

  const baseOnStart = base.onStart as ((data: unknown) => void) | undefined;
  const overrideOnStart = overrides.onStart as
    | ((data: unknown) => void)
    | undefined;
  if (baseOnStart || overrideOnStart) {
    merged.onStart = mergeHandlers(baseOnStart, overrideOnStart);
  }

  if (base.reporter && overrides.reporter === undefined) {
    merged.reporter = base.reporter;
  }

  return merged;
}

function mergeHandlers<Args extends unknown[]>(
  base?: (...args: Args) => void,
  override?: (...args: Args) => void,
): ((...args: Args) => void) | undefined {
  if (base && override) {
    return (...args: Args) => {
      base(...args);
      override(...args);
    };
  }
  return base ?? override;
}

function mergeProgress(
  base?: Partial<ProgressReporter>,
  override?: Partial<ProgressReporter>,
): ProgressReporter | undefined {
  if (!base) {
    return override as ProgressReporter | undefined;
  }
  if (!override) {
    return base as ProgressReporter;
  }
  const noopName = (_name: string) => {};
  const noopStart = (_name: string, _total: number) => {};
  return {
    start:
      mergeHandlers(base.start, override.start) ??
      base.start ??
      override.start ??
      noopStart,
    stop:
      mergeHandlers(base.stop, override.stop) ??
      base.stop ??
      override.stop ??
      noopName,
    increment:
      mergeHandlers(base.increment, override.increment) ??
      base.increment ??
      override.increment ??
      noopName,
    setTotal:
      mergeHandlers(base.setTotal, override.setTotal) ??
      base.setTotal ??
      override.setTotal ??
      noopStart,
  };
}

// ---------------------------------------------------------------------------
// Eval runner core
// ---------------------------------------------------------------------------

async function createEvalRunner() {
  const EvalFn = BraintrustEval as unknown as EvalFunction;
  const sse = createSseWriter();
  const noSendLogs = shouldDisableSendLogs();
  const filters = getFiltersFromEnv();

  const makeEvalOptions = (
    evaluatorName: string,
    overrides?: EvalOptions,
  ): EvalOptions | undefined => {
    let base: EvalOptions = {};
    if (noSendLogs) {
      base.noSendLogs = true;
    }
    if (filters.length > 0) {
      base.filters = filters;
    }
    if (sse) {
      base = {
        ...base,
        reporter: {
          name: "bt-silent-reporter",
          reportEval: () => true,
          reportRun: () => true,
        },
        progress: createEvalProgressReporter(sse, evaluatorName),
        stream: (data: unknown) => {
          sse.send("progress", data);
        },
        onStart: (metadata: unknown) => {
          sse.send("start", metadata);
        },
      };
    }

    if (!overrides) {
      return Object.keys(base).length === 0 ? undefined : base;
    }
    return mergeEvalOptions(base, overrides);
  };

  const runEval = async (
    projectName: string,
    evaluator: Record<string, unknown>,
    options?: EvalOptions,
  ) => {
    globalThis._lazy_load = false;
    const evaluatorName = getEvaluatorName(evaluator, projectName);
    const opts = makeEvalOptions(evaluatorName, options);
    const result = await EvalFn(projectName, evaluator, opts);
    const failingResults = result.results.filter(
      (r: { error?: unknown }) => r.error !== undefined,
    );
    if (failingResults.length > 0 && sse) {
      sendConsole(
        sse,
        `Evaluator ${evaluatorName} failed with ${failingResults.length} error${failingResults.length === 1 ? "" : "s"}.`,
      );
    }
    if (sse) {
      sse.send("summary", result.summary);
    }
    return result;
  };

  const runRegisteredEvals = async (evaluators: EvaluatorEntry[]) => {
    const results = await Promise.all(
      evaluators.map(async (entry) => {
        try {
          const options = entry.reporter
            ? ({ reporter: entry.reporter } as EvalOptions)
            : undefined;
          const result = await runEval(
            entry.evaluator.projectName,
            entry.evaluator as unknown as Record<string, unknown>,
            options,
          );
          const failingResults = result.results.filter(
            (r: { error?: unknown }) => r.error !== undefined,
          );
          return failingResults.length === 0;
        } catch (err) {
          if (sse) {
            sse.send("error", serializeError(err));
          } else {
            console.error(err);
          }
          return false;
        }
      }),
    );
    return results.every(Boolean);
  };

  const finish = (ok: boolean) => {
    if (sse) {
      sse.send("done", "");
      sse.close();
    }
    if (!ok) {
      process.exitCode = 1;
    }
  };

  return {
    Eval: EvalFn,
    sse,
    login,
    runEval,
    runRegisteredEvals,
    makeEvalOptions,
    finish,
    noSendLogs,
  };
}

// ---------------------------------------------------------------------------
// List mode
// ---------------------------------------------------------------------------

function handleListMode(sse: SseWriter | null) {
  const evaluators = getEvaluators();
  for (const entry of evaluators) {
    const name = entry.evaluator.evalName;
    if (sse) {
      sse.send("list", { name });
    } else {
      console.log(name);
    }
  }
}

// ---------------------------------------------------------------------------
// Dev mode
// ---------------------------------------------------------------------------

async function handleDevMode(sse: SseWriter | null) {
  const evaluators = getEvaluators();
  const allEvaluators = evaluators.map(
    (e) => e.evaluator as EvaluatorDef<unknown, unknown, unknown, BaseMetadata>,
  );

  const host = process.env.BT_EVAL_DEV_HOST || "localhost";
  const port = Number(process.env.BT_EVAL_DEV_PORT) || 8300;
  const orgName = process.env.BT_EVAL_DEV_ORG_NAME;

  // Dynamic import to avoid pulling in express and friends when not needed
  const { runDevServer } = await import("../../dev/server");
  runDevServer(allEvaluators, { host, port, orgName });

  if (sse) {
    sse.send("dev-ready", { host, port });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("No eval files provided.");
    process.exit(1);
  }

  const normalized = normalizeFiles(files);

  // Initialize the global _evals registry and _lazy_load flag so that
  // Eval() calls during file import register evaluators instead of running them.
  _initializeSpanContext();
  initRegistry();

  const modules = await loadFiles(normalized);
  const btEvalMains = collectBtEvalMains(modules);

  // --list mode: just print evaluator names and exit
  if (isListMode()) {
    const sse = createSseWriter();
    handleListMode(sse);
    if (sse) {
      sse.send("done", "");
      sse.close();
    }
    return;
  }

  // --dev mode: start dev server and keep running
  if (isDevMode()) {
    const sse = createSseWriter();
    await handleDevMode(sse);
    // Dev server keeps the process alive; no "done" event until killed
    return;
  }

  // Normal eval mode
  const runner = await createEvalRunner();
  if (!runner.noSendLogs) {
    try {
      await runner.login({});
    } catch (err) {
      if (runner.sse) {
        runner.sse.send("error", serializeError(err));
      } else {
        console.error(err);
      }
      runner.finish(false);
      return;
    }
  }

  const context: BtEvalContext = {
    Eval: runner.Eval,
    runEval: runner.runEval,
    runRegisteredEvals: () => runner.runRegisteredEvals(getEvaluators()),
    makeEvalOptions: runner.makeEvalOptions,
    sendConsole: (message: string, stream?: "stdout" | "stderr") => {
      sendConsole(runner.sse, message, stream);
    },
    sendEvent: (event: string, data: unknown) => {
      if (runner.sse) {
        runner.sse.send(event, data);
      }
    },
  };

  let ok = true;
  try {
    if (btEvalMains.length > 0) {
      globalThis._lazy_load = false;
      for (const btMain of btEvalMains) {
        try {
          await btMain(context);
        } catch (err) {
          ok = false;
          if (runner.sse) {
            runner.sse.send("error", serializeError(err));
          } else {
            console.error(err);
          }
        }
      }
    } else {
      const evaluators = getEvaluators();
      if (evaluators.length === 0) {
        console.error("No evaluators found. Did you call Eval() in the file?");
        process.exit(1);
      }
      ok = await runner.runRegisteredEvals(evaluators);
    }
  } finally {
    runner.finish(ok);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
