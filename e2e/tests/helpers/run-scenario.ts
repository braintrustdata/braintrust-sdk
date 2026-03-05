import { spawn } from "node:child_process";
import * as path from "node:path";

export interface ScenarioResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const tsxCliPath = require.resolve("tsx/cli");
const packageRoot = process.cwd();
const DEFAULT_SCENARIO_TIMEOUT_MS = 15_000;

export async function runScenario(
  relativeScenarioPath: string,
  env: Record<string, string>,
  timeoutMs = DEFAULT_SCENARIO_TIMEOUT_MS,
): Promise<ScenarioResult> {
  const scenarioPath = path.join(packageRoot, relativeScenarioPath);

  return await new Promise<ScenarioResult>((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCliPath, scenarioPath], {
      cwd: packageRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `Scenario ${relativeScenarioPath} timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

export async function runScenarioOrThrow(
  relativeScenarioPath: string,
  env: Record<string, string>,
  timeoutMs?: number,
): Promise<ScenarioResult> {
  const result = await runScenario(relativeScenarioPath, env, timeoutMs);

  if (result.exitCode !== 0) {
    throw new Error(
      `Scenario ${relativeScenarioPath} failed with exit code ${result.exitCode}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  return result;
}
