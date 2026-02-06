/**
 * SSE (Server-Sent Events) utilities for the two-process eval architecture.
 *
 * The orchestrator (braintrust eval CLI) creates a Unix domain socket and
 * listens for the child process (eval-runner) to connect and stream
 * SSE-framed events back.
 */

import net from "net";
import os from "os";
import path from "path";
import { createInterface } from "readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoreSummary {
  name: string;
  score: number;
  diff?: number;
  improvements: number;
  regressions: number;
}

export interface MetricSummary {
  name: string;
  metric: number;
  unit: string;
  diff?: number;
  improvements: number;
  regressions: number;
}

export interface ExperimentSummaryEvent {
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

export interface SseProgressEventData {
  id: string;
  object_type: string;
  format: string;
  output_type: string;
  name: string;
  event: string;
  data: string;
}

export interface EvalProgressData {
  type: string;
  kind: string;
  total?: number;
}

export interface ConsoleEventData {
  stream: "stdout" | "stderr";
  message: string;
}

export interface ErrorEventData {
  message: string;
  stack?: string;
}

export interface ListEventData {
  name: string;
}

export interface DevReadyEventData {
  host: string;
  port: number;
}

export type SseEvent =
  | { type: "start"; data: ExperimentSummaryEvent }
  | { type: "summary"; data: ExperimentSummaryEvent }
  | { type: "progress"; data: SseProgressEventData }
  | { type: "console"; data: ConsoleEventData }
  | { type: "error"; data: ErrorEventData }
  | { type: "list"; data: ListEventData }
  | { type: "dev-ready"; data: DevReadyEventData }
  | { type: "done"; data: string };

// ---------------------------------------------------------------------------
// Socket path generation
// ---------------------------------------------------------------------------

export function buildSseSocketPath(): string {
  const pid = process.pid;
  const now = Date.now();
  return path.join(os.tmpdir(), `bt-eval-${pid}-${now}.sock`);
}

// ---------------------------------------------------------------------------
// SSE Server (orchestrator side)
// ---------------------------------------------------------------------------

/**
 * Creates a Unix domain socket server that accepts exactly one connection
 * from the eval runner and parses SSE-framed events from it.
 *
 * @param socketPath The Unix socket path to listen on.
 * @param onEvent Called for each parsed SSE event.
 * @returns An object with a `close` method to shut down the server.
 */
export function createSseServer(
  socketPath: string,
  onEvent: (event: SseEvent) => void,
): { server: net.Server; close: () => void } {
  const server = net.createServer((socket) => {
    let currentEvent: string | null = null;
    let dataLines: string[] = [];

    const rl = createInterface({ input: socket });

    rl.on("line", (line) => {
      if (line === "") {
        // Empty line = end of SSE frame
        if (currentEvent !== null || dataLines.length > 0) {
          const data = dataLines.join("\n");
          dispatchSseEvent(currentEvent, data, onEvent);
          currentEvent = null;
          dataLines = [];
        }
        return;
      }

      if (line.startsWith("event:")) {
        currentEvent = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    });

    rl.on("close", () => {
      // Flush any remaining event
      if (currentEvent !== null || dataLines.length > 0) {
        const data = dataLines.join("\n");
        dispatchSseEvent(currentEvent, data, onEvent);
      }
    });
  });

  server.listen(socketPath);

  return {
    server,
    close: () => {
      server.close();
      try {
        require("fs").unlinkSync(socketPath);
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

function dispatchSseEvent(
  eventName: string | null,
  data: string,
  onEvent: (event: SseEvent) => void,
) {
  const name = eventName ?? "";

  switch (name) {
    case "start": {
      try {
        const parsed = JSON.parse(data) as ExperimentSummaryEvent;
        onEvent({ type: "start", data: parsed });
      } catch {
        // Skip malformed events
      }
      break;
    }
    case "summary": {
      try {
        const parsed = JSON.parse(data) as ExperimentSummaryEvent;
        onEvent({ type: "summary", data: parsed });
      } catch {
        // Skip malformed events
      }
      break;
    }
    case "progress": {
      try {
        const parsed = JSON.parse(data) as SseProgressEventData;
        onEvent({ type: "progress", data: parsed });
      } catch {
        // Skip malformed events
      }
      break;
    }
    case "console": {
      try {
        const parsed = JSON.parse(data) as ConsoleEventData;
        onEvent({ type: "console", data: parsed });
      } catch {
        // Skip malformed events
      }
      break;
    }
    case "error": {
      try {
        const parsed = JSON.parse(data) as ErrorEventData;
        onEvent({ type: "error", data: parsed });
      } catch {
        onEvent({ type: "error", data: { message: data } });
      }
      break;
    }
    case "list": {
      try {
        const parsed = JSON.parse(data) as ListEventData;
        onEvent({ type: "list", data: parsed });
      } catch {
        // Skip malformed events
      }
      break;
    }
    case "dev-ready": {
      try {
        const parsed = JSON.parse(data) as DevReadyEventData;
        onEvent({ type: "dev-ready", data: parsed });
      } catch {
        // Skip malformed events
      }
      break;
    }
    case "done": {
      onEvent({ type: "done", data });
      break;
    }
    default:
      // Ignore unknown events
      break;
  }
}

// ---------------------------------------------------------------------------
// Runtime resolution
// ---------------------------------------------------------------------------

interface ProjectContext {
  root: string;
  hasVite: boolean;
  hasTsNode: boolean;
  hasTypeModule: boolean;
  hasTsx: boolean;
  hasBun: boolean;
  hasDeno: boolean;
  nodeModulesBin: string;
}

/**
 * Phase 1: Discover project root by traversing upward from the current directory.
 * Stops at package.json, lockfiles, .git, or system boundaries.
 */
function findProjectRoot(startDir: string): string | null {
  const fs = require("fs");
  const homeDir = require("os").homedir();
  let current = path.resolve(startDir);
  let depth = 0;
  const maxDepth = 8;

  while (depth < maxDepth) {
    // Stop at system boundaries
    if (current === "/" || current === homeDir) {
      return null;
    }

    // Check for project indicators
    try {
      const entries = fs.readdirSync(current);
      const hasPackageJson = entries.includes("package.json");
      const hasLockfile =
        entries.includes("package-lock.json") ||
        entries.includes("pnpm-lock.yaml") ||
        entries.includes("yarn.lock") ||
        entries.includes("bun.lock");
      const hasGit = entries.includes(".git");
      const hasDenoJson =
        entries.includes("deno.json") || entries.includes("deno.jsonc");

      if (hasPackageJson || hasLockfile || hasGit || hasDenoJson) {
        return current;
      }
    } catch {
      // Cannot read directory, continue upward
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Reached root
      return null;
    }
    current = parent;
    depth++;
  }

  return null;
}

/**
 * Phase 2: Classify the environment based on project signals.
 */
function classifyEnvironment(projectRoot: string): ProjectContext {
  const fs = require("fs");
  const ctx: ProjectContext = {
    root: projectRoot,
    hasVite: false,
    hasTsNode: false,
    hasTypeModule: false,
    hasTsx: false,
    hasBun: false,
    hasDeno: false,
    nodeModulesBin: path.join(projectRoot, "node_modules", ".bin"),
  };

  // Check for Deno
  const denoJsonPath = path.join(projectRoot, "deno.json");
  const denoJsoncPath = path.join(projectRoot, "deno.jsonc");
  try {
    if (fs.existsSync(denoJsonPath) || fs.existsSync(denoJsoncPath)) {
      ctx.hasDeno = true;
      return ctx; // Deno takes priority
    }
  } catch {
    // Ignore
  }

  // Check for Bun
  const bunLockPath = path.join(projectRoot, "bun.lock");
  try {
    if (fs.existsSync(bunLockPath)) {
      ctx.hasBun = true;
      return ctx; // Bun takes priority
    }
  } catch {
    // Ignore
  }

  // Check package.json
  const packageJsonPath = path.join(projectRoot, "package.json");
  try {
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      // Check for Vite
      if (
        allDeps.vite ||
        allDeps.vitest ||
        fs.existsSync(path.join(projectRoot, "vite.config.ts")) ||
        fs.existsSync(path.join(projectRoot, "vite.config.js")) ||
        fs.existsSync(path.join(projectRoot, "vitest.config.ts")) ||
        fs.existsSync(path.join(projectRoot, "vitest.config.js"))
      ) {
        ctx.hasVite = true;
      }

      // Check for ts-node
      if (allDeps["ts-node"]) {
        ctx.hasTsNode = true;
      }

      // Check for tsx
      if (allDeps.tsx) {
        ctx.hasTsx = true;
      }

      // Check for type: "module"
      if (packageJson.type === "module") {
        ctx.hasTypeModule = true;
      }
    }
  } catch {
    // Ignore parsing errors
  }

  // Check tsconfig.json for ts-node config
  const tsconfigPath = path.join(projectRoot, "tsconfig.json");
  try {
    if (fs.existsSync(tsconfigPath)) {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
      if (tsconfig["ts-node"]) {
        ctx.hasTsNode = true;
      }
    }
  } catch {
    // Ignore parsing errors
  }

  return ctx;
}

/**
 * Phase 3: Select the appropriate runner based on environment classification.
 */
function selectRunner(ctx: ProjectContext): {
  command: string;
  prefixArgs: string[];
} {
  const fs = require("fs");

  // Deno takes highest priority (but fall back to tsx if not available)
  if (ctx.hasDeno) {
    const denoPath = findOnPath("deno");
    if (denoPath) {
      return { command: denoPath, prefixArgs: ["run", "-A"] };
    }
    // Deno not available, fall back to tsx for compatibility
  }

  // Bun takes second priority (but fall back to tsx if not available)
  if (ctx.hasBun) {
    const bunPath = findOnPath("bun");
    if (bunPath) {
      return { command: bunPath, prefixArgs: [] };
    }
    // Check local bun
    const localBun = path.join(ctx.nodeModulesBin, "bun");
    try {
      fs.accessSync(localBun, fs.constants.X_OK);
      return { command: localBun, prefixArgs: [] };
    } catch {
      // Bun not available, fall back to tsx for compatibility
    }
  }

  // Vite signal
  if (ctx.hasVite) {
    // Check for local vite-node
    const localViteNode = path.join(ctx.nodeModulesBin, "vite-node");
    try {
      fs.accessSync(localViteNode, fs.constants.X_OK);
      return { command: localViteNode, prefixArgs: [] };
    } catch {
      // Fall through to npx
    }
    return { command: "npx", prefixArgs: ["--yes", "vite-node"] };
  }

  // Legacy/strict ts-node signal
  if (ctx.hasTsNode) {
    // Check for local ts-node
    const localTsNode = path.join(ctx.nodeModulesBin, "ts-node");
    try {
      fs.accessSync(localTsNode, fs.constants.X_OK);
      return { command: localTsNode, prefixArgs: [] };
    } catch {
      // Fall through to npx
    }
    return { command: "npx", prefixArgs: ["--yes", "ts-node"] };
  }

  // Modern/generic tsx signal (default)
  // Check for local tsx
  const localTsx = path.join(ctx.nodeModulesBin, "tsx");
  try {
    fs.accessSync(localTsx, fs.constants.X_OK);
    return { command: localTsx, prefixArgs: [] };
  } catch {
    // Fall through
  }

  // Check for tsx on PATH
  const tsxOnPath = findOnPath("tsx");
  if (tsxOnPath) {
    return { command: tsxOnPath, prefixArgs: [] };
  }

  // Fallback: npx tsx (universal runner)
  return { command: "npx", prefixArgs: ["--yes", "tsx"] };
}

/**
 * Resolve which runtime binary to use for spawning the eval runner.
 *
 * Phase 4: User overrides take absolute priority.
 * Then auto-detect based on project environment.
 *
 * Returns { command, prefixArgs } where prefixArgs should be prepended before the
 * eval-runner script path.
 */
export function resolveRuntime(runnerOverride?: string): {
  command: string;
  prefixArgs: string[];
} {
  // Phase 4: User overrides
  if (runnerOverride) {
    return { command: runnerOverride, prefixArgs: [] };
  }

  // Check BT_EVAL_JS_RUNNER env var for manual override
  const envRunner = process.env.BT_EVAL_JS_RUNNER;
  if (envRunner) {
    return { command: envRunner, prefixArgs: [] };
  }

  // Phase 1: Discover project root
  const projectRoot = findProjectRoot(process.cwd());

  if (!projectRoot) {
    // Safety net: default to tsx
    const tsxOnPath = findOnPath("tsx");
    if (tsxOnPath) {
      return { command: tsxOnPath, prefixArgs: [] };
    }
    return { command: "npx", prefixArgs: ["--yes", "tsx"] };
  }

  // Phase 2 & 3: Classify and select runner
  const ctx = classifyEnvironment(projectRoot);
  return selectRunner(ctx);
}

function findOnPath(binary: string): string | null {
  const pathEnv = process.env.PATH;
  if (!pathEnv) {
    return null;
  }
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, binary);
    try {
      require("fs").accessSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}
