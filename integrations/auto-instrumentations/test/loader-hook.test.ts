import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Worker } from "node:worker_threads";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const nodeModulesDir = path.join(fixturesDir, "node_modules");

// Path to unified loader hook (built dist file)
const hookPath = path.join(__dirname, "../dist/hook.mjs");

// Paths to fixtures
const listenerPath = path.join(fixturesDir, "listener-esm.mjs");
const testAppEsmPath = path.join(fixturesDir, "test-app-esm.mjs");
const testAppCjsPath = path.join(fixturesDir, "test-app-cjs.cjs");

interface TestResult {
  events: { start: any[]; end: any[]; error: any[] };
}

describe("Unified Loader Hook Integration Tests", () => {
  beforeAll(() => {
    // No setup needed - test/fixtures/node_modules/openai is committed to the repo
  });

  afterAll(() => {
    // No cleanup needed - we don't create any temporary files
  });

  describe("Unified hook (--import) handles both ESM and CJS", () => {
    it("should emit diagnostics_channel events for ESM OpenAI calls", async () => {
      const result = await runWithWorker({
        execArgv: ["--import", listenerPath, "--import", hookPath],
        script: testAppEsmPath,
      });

      expect(result.events.start.length).toBeGreaterThan(0);
      expect(result.events.end.length).toBeGreaterThan(0);
      expect(result.events.start[0].args).toBeDefined();
    });

    it("should emit diagnostics_channel events for CJS OpenAI calls", async () => {
      const result = await runWithWorker({
        execArgv: ["--import", listenerPath, "--import", hookPath],
        script: testAppCjsPath,
      });

      expect(result.events.start.length).toBeGreaterThan(0);
      expect(result.events.end.length).toBeGreaterThan(0);
    });
  });
});

async function runWithWorker(options: {
  execArgv: string[];
  script: string;
}): Promise<TestResult> {
  return new Promise((resolve, reject) => {
    let result: TestResult | null = null;

    const worker = new Worker(options.script, {
      execArgv: options.execArgv,
      env: { ...process.env, NODE_OPTIONS: "" },
    });

    worker.on("message", (msg) => {
      if (msg.type === "events") {
        result = { events: msg.events };
      }
    });

    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Worker exited with code ${code}`));
      } else if (result) {
        resolve(result);
      } else {
        reject(new Error("No events received from worker"));
      }
    });
  });
}
