import { initLogger } from "braintrust";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const OPENAI_MODEL = "gpt-4o-mini";

function getTestRunId() {
  return process.env.BRAINTRUST_E2E_RUN_ID;
}

function scopedName(base, testRunId = getTestRunId()) {
  const suffix = testRunId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `${base}-${suffix}`;
}

export async function getInstalledPackageVersion(_importMetaUrl, packageName) {
  let currentDir = path.dirname(require.resolve(packageName));

  while (true) {
    const manifestPath = path.join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest && typeof manifest.version === "string") {
        return manifest.version;
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error(`Could not resolve installed version for ${packageName}`);
}

export async function runOpenAIAutoInstrumentationNodeHook(
  OpenAI,
  openaiSdkVersion,
) {
  const testRunId = getTestRunId();
  const logger = initLogger({
    projectName: scopedName("e2e-openai-auto-instrumentation-hook", testRunId),
  });
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  });

  await logger.traced(
    async () => {
      await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "user",
            content: "Auto-instrument this request.",
          },
        ],
        max_tokens: 8,
        temperature: 0,
      });
    },
    {
      name: "openai-auto-hook-root",
      event: {
        metadata: {
          scenario: "openai-auto-instrumentation-node-hook",
          openaiSdkVersion,
          testRunId,
        },
      },
    },
  );

  await logger.flush();
}

export function runOpenAIAutoInstrumentationNodeHookOrExit(
  OpenAI,
  openaiSdkVersion,
) {
  void runOpenAIAutoInstrumentationNodeHook(OpenAI, openaiSdkVersion).catch(
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
