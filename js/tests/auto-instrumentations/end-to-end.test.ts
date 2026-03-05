/**
 * END-TO-END AUTO-INSTRUMENTATION TESTS
 *
 * These tests verify the COMPLETE auto-instrumentation system:
 * 1. Load the hook.mjs with --import flag
 * 2. Use REAL AI SDK packages
 * 3. Code-transformer actually transforms the SDK code
 * 4. Transformed code emits events on diagnostics_channel
 * 5. Plugins subscribe to correct channels
 * 6. Plugins create REAL spans with correct data
 *
 * This is a true end-to-end test of the entire system.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const hookPath = path.join(
  __dirname,
  "../../dist/auto-instrumentations/hook.mjs",
);

/**
 * Run a test script with the auto-instrumentation hook loaded.
 * Returns the spans that were created.
 */
async function runWithAutoInstrumentation(
  scriptPath: string,
  env: Record<string, string> = {},
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  spans: any[];
}> {
  return new Promise((resolve, reject) => {
    const hookUrl = pathToFileURL(hookPath).href;
    const child = spawn(process.execPath, [`--import=${hookUrl}`, scriptPath], {
      env: {
        ...process.env,
        ...env,
        // Disable actual API calls
        NODE_ENV: "test",
      },
      cwd: fixturesDir,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      // Extract spans from output
      const spans: any[] = [];
      const spanMatches = stdout.matchAll(/SPAN_DATA: (.+)/g);
      for (const match of spanMatches) {
        try {
          spans.push(JSON.parse(match[1]));
        } catch (e) {
          // Ignore parse errors
        }
      }

      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
        spans,
      });
    });

    child.on("error", reject);
  });
}

describe("End-to-End Auto-Instrumentation", () => {
  beforeAll(() => {
    // Ensure hook is built
    if (!fs.existsSync(hookPath)) {
      throw new Error(`Hook not found at ${hookPath}. Run 'pnpm build' first.`);
    }
  });

  describe("Anthropic SDK", () => {
    it("should instrument Anthropic messages.create and create spans", async () => {
      const testScript = path.join(fixturesDir, "anthropic-e2e-test.mjs");

      // Create test script
      fs.writeFileSync(
        testScript,
        `
import Anthropic from '@anthropic-ai/sdk';
import { initLogger, _exportsForTestingOnly } from '../../../dist/index.mjs';

// Use test background logger to capture spans
const backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();

// Simulate login
await _exportsForTestingOnly.simulateLoginForTests();

// Initialize logger
const logger = initLogger({
  projectName: 'auto-instrumentation-test',
  projectId: 'test-project-id',
});

// Create Anthropic client with mocked fetch
const mockFetch = async (url, options) => {
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      'content-type': 'application/json',
    }),
    json: async () => ({
      id: 'msg_test123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Test response' }],
      model: 'claude-3-sonnet-20240229',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
      },
    }),
  };
};

const client = new Anthropic({
  apiKey: 'test-key',
  fetch: mockFetch,
});

try {
  // Make API call - auto-instrumentation should create a span
  const message = await client.messages.create({
    model: 'claude-3-sonnet-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }],
  });

  // Debug: Log what we got back
  console.log('MESSAGE RESULT:', JSON.stringify(message, null, 2));

  // Drain spans
  const spans = await backgroundLogger.drain();

  // Output spans for validation
  for (const span of spans) {
    console.log('SPAN_DATA:', JSON.stringify(span));
  }

  console.log('SUCCESS: API call completed');
  process.exit(0);
} catch (error) {
  console.error('ERROR:', error.message);
  process.exit(1);
}
`,
      );

      const result = await runWithAutoInstrumentation(testScript);

      // Verify script succeeded
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("SUCCESS");

      // Verify spans were created
      expect(result.spans.length).toBeGreaterThan(0);

      const span = result.spans[0];

      // Verify span name (critical - proves correct channel name)
      expect(span.span_attributes?.name).toBe("anthropic.messages.create");

      // Verify span has input
      expect(span.input).toBeDefined();
      expect(Array.isArray(span.input)).toBe(true);

      // Verify span has output
      expect(span.output).toBeDefined();

      // Verify span has metrics
      expect(span.metrics).toBeDefined();
      expect(span.metrics.prompt_tokens).toBe(10);
      expect(span.metrics.completion_tokens).toBe(5);

      // Clean up
      fs.unlinkSync(testScript);
    }, 30000); // 30s timeout for real SDK loading

    it("should use correct channel name orchestrion:@anthropic-ai/sdk:messages.create", async () => {
      const testScript = path.join(
        fixturesDir,
        "anthropic-channel-name-test.mjs",
      );

      // Create test script that verifies channel name
      fs.writeFileSync(
        testScript,
        `
import Anthropic from '@anthropic-ai/sdk';
import { _internalIso as iso } from '../../../dist/index.mjs';

// Subscribe to the channel we expect to be used
let eventReceived = false;
const channel = iso.newTracingChannel('orchestrion:@anthropic-ai/sdk:messages.create');

channel.subscribe({
  start: (event) => {
    eventReceived = true;
    console.log('CHANNEL_EVENT_RECEIVED: true');
  },
});

// Create client with mocked fetch
const mockFetch = async () => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Test' }],
    model: 'claude-3-sonnet-20240229',
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  }),
});

const client = new Anthropic({
  apiKey: 'test-key',
  fetch: mockFetch,
});

try {
  await client.messages.create({
    model: 'claude-3-sonnet-20240229',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'Hi' }],
  });

  if (eventReceived) {
    console.log('SUCCESS: Channel event received on correct channel');
    process.exit(0);
  } else {
    console.error('ERROR: Channel event NOT received - name mismatch!');
    process.exit(1);
  }
} catch (error) {
  console.error('ERROR:', error.message);
  process.exit(1);
}
`,
      );

      const result = await runWithAutoInstrumentation(testScript);

      // Verify channel event was received
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("CHANNEL_EVENT_RECEIVED: true");
      expect(result.stdout).toContain("SUCCESS");

      // Clean up
      fs.unlinkSync(testScript);
    }, 30000);
  });

  describe("OpenAI SDK", () => {
    it("should instrument OpenAI chat.completions.create and create spans", async () => {
      const testScript = path.join(fixturesDir, "openai-e2e-test.mjs");

      fs.writeFileSync(
        testScript,
        `
import OpenAI from 'openai';
import { initLogger, _exportsForTestingOnly } from '../../../dist/index.mjs';

const backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
await _exportsForTestingOnly.simulateLoginForTests();

const logger = initLogger({
  projectName: 'auto-instrumentation-test',
  projectId: 'test-project-id',
});

// Create OpenAI client with mocked fetch
const mockFetch = async (url, options) => {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({
      id: 'chatcmpl-test123',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Test response' },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    }),
  };
};

const client = new OpenAI({
  apiKey: 'test-key',
  fetch: mockFetch,
});

try {
  const completion = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello!' }],
  });

  const spans = await backgroundLogger.drain();

  for (const span of spans) {
    console.log('SPAN_DATA:', JSON.stringify(span));
  }

  console.log('SUCCESS: API call completed');
  process.exit(0);
} catch (error) {
  console.error('ERROR:', error.message);
  process.exit(1);
}
`,
      );

      const result = await runWithAutoInstrumentation(testScript);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("SUCCESS");
      expect(result.spans.length).toBeGreaterThan(0);

      const span = result.spans[0];
      expect(span.span_attributes?.name).toBe("Chat Completion");
      expect(span.metrics?.prompt_tokens).toBe(10);
      expect(span.metrics?.completion_tokens).toBe(5);

      fs.unlinkSync(testScript);
    }, 30000);
  });

  describe("Channel Name Validation", () => {
    it("should fail if plugin subscribes to wrong channel name", async () => {
      const testScript = path.join(fixturesDir, "wrong-channel-test.mjs");

      fs.writeFileSync(
        testScript,
        `
import Anthropic from '@anthropic-ai/sdk';
import { _internalIso as iso } from '../../../dist/index.mjs';

// Subscribe to WRONG channel name (old bug)
let eventReceived = false;
const wrongChannel = iso.newTracingChannel('orchestrion:anthropic:messages.create');

wrongChannel.subscribe({
  start: () => {
    eventReceived = true;
  },
});

const mockFetch = async () => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Test' }],
    model: 'claude-3-sonnet-20240229',
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  }),
});

const client = new Anthropic({
  apiKey: 'test-key',
  fetch: mockFetch,
});

await client.messages.create({
  model: 'claude-3-sonnet-20240229',
  max_tokens: 10,
  messages: [{ role: 'user', content: 'Hi' }],
});

if (eventReceived) {
  console.error('ERROR: Event received on WRONG channel!');
  process.exit(1);
} else {
  console.log('SUCCESS: Event correctly NOT received on wrong channel');
  process.exit(0);
}
`,
      );

      const result = await runWithAutoInstrumentation(testScript);

      // Should succeed - the event should NOT be received on wrong channel
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("SUCCESS");

      fs.unlinkSync(testScript);
    }, 30000);
  });
});
