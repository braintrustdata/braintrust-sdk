import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import { create } from "../../auto-instrumentations/orchestrion-js";
import { getDefaultInstrumentationConfigs } from "../../auto-instrumentations/configs/all";
import { readDisabledInstrumentationEnvConfig } from "../config";
import { configureNode } from "../../node/config";
import { registry } from "../registry";
import {
  _exportsForTestingOnly,
  initLogger,
  type TestBackgroundLogger,
} from "../../logger";
import { LettaAgentSDKPlugin } from "./letta-agent-sdk-plugin";
import type { LettaMessage } from "./letta-agent-sdk-channels";
import { wrapLettaAgentSDK } from "../../wrappers/letta-agent-sdk";

const require = createRequire(import.meta.url);
const sdkDir = dirname(require.resolve("@letta-ai/letta-agent-sdk"));
const { version } = JSON.parse(
  readFileSync(join(sdkDir, "../package.json"), "utf8"),
);
const factories = new Map<
  string,
  (require: NodeRequire, module: { exports: unknown }, exports: unknown) => void
>();

// These are SDK contract tests, not provider e2e tests. Run the published SDK
// through the real transformer and hooks, with only its runtime transport stubbed.
async function loadSDK(filePath: string, disabled?: string) {
  const key = `${filePath}:${disabled ?? "enabled"}`;
  let factory = factories.get(key);
  if (!factory) {
    const code = readFileSync(join(sdkDir, "..", filePath), "utf8");
    const matcher = create(
      getDefaultInstrumentationConfigs({
        disabledIntegrationConfig:
          readDisabledInstrumentationEnvConfig(disabled).integrations,
      }),
    );
    const transformed =
      matcher
        .getTransformer("@letta-ai/letta-agent-sdk", version, filePath)
        ?.transform(code, "esm").code ?? code;
    // Evaluate a fresh copy in the test's realm so it sees the same global hooks.
    // Converting only the module syntax also lets this run in Vitest's VM pools.
    const filename = join(sdkDir, "..", filePath);
    const compiled = transformSync(transformed, {
      format: "cjs",
      platform: "node",
      target: "node22",
      define: {
        "import.meta.url": JSON.stringify(pathToFileURL(filename).href),
      },
    }).code;
    factory = new Function(
      "require",
      "module",
      "exports",
      compiled,
    ) as NonNullable<typeof factory>;
    factories.set(key, factory);
  }
  const module = { exports: {} };
  factory(createRequire(join(sdkDir, "..", filePath)), module, module.exports);
  return module.exports as any;
}

function prepareSession(sdk: any, messages: LettaMessage[]) {
  const client = new sdk.LettaAgentClient({
    backend: "remote",
    url: "ws://unused.invalid",
  });
  const session = client.resumeSession("agent-test");
  const sendTurnMessage = vi.fn();
  Object.assign(session, {
    initialized: true,
    _agentId: "agent-test",
    _conversationId: "conv-test",
    runtime: { agent_id: "agent-test", conversation_id: "conv-test" },
    controller: { sendTurnMessage, close: vi.fn() },
    beforeTurn: async () => {},
    recoverIdleTransportIfNeeded: async () => {},
    turns: {
      trackSentTurn: () => ({ otid: "test-turn" }),
      removeTrackedTurn: vi.fn(),
      hasInFlightTurn: () => false,
      nextMessage: async () => messages.shift(),
      close: vi.fn(),
    },
  });
  return { client, session, sendTurnMessage };
}

const result = {
  type: "result",
  success: true,
  result: "Hello",
  durationMs: 20,
  totalCostUsd: 0.001,
  conversationId: "conv-test",
} satisfies LettaMessage;

async function collect(stream: AsyncIterable<unknown>) {
  const messages = [];
  for await (const message of stream) messages.push(message);
  return messages;
}

describe("Letta Agent SDK published package", () => {
  let background: TestBackgroundLogger;
  let plugin: LettaAgentSDKPlugin;

  beforeAll(async () => {
    configureNode();
    registry.disable();
    await _exportsForTestingOnly.simulateLoginForTests();
  });
  beforeEach(() => {
    background = _exportsForTestingOnly.useTestBackgroundLogger();
    initLogger({ projectName: "letta-tests", projectId: "letta-tests" });
    plugin = new LettaAgentSDKPlugin();
    plugin.enable();
  });
  afterEach(() => {
    plugin.disable();
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });
  async function turns() {
    return ((await background.drain()) as any[]).filter(
      (row) => row.span_attributes?.name === "Letta Agent SDK",
    );
  }

  it.each(["dist/index.js", "dist/client-entry.js"])(
    "traces send through completion in %s",
    async (filePath) => {
      const sdk = await loadSDK(filePath);
      const { session, sendTurnMessage } = prepareSession(sdk, [
        { type: "assistant", content: "Hello" },
        result,
      ]);
      await session.send("Hi");
      expect(sendTurnMessage).toHaveBeenCalledOnce();
      const stream = session.stream();
      expect(await collect(stream)).toEqual([
        { type: "assistant", content: "Hello" },
        result,
      ]);
      const rows = await turns();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        input: "Hi",
        output: "Hello",
        metrics: { duration: 0.02, estimated_cost: 0.001 },
        metadata: {
          "letta.agent_id": "agent-test",
          "letta.conversation_id": "conv-test",
          "letta.success": true,
        },
        context: {
          span_origin: { instrumentation: { name: "letta-agent-sdk" } },
        },
      });
      expect(rows[0].metrics.end).toBeTypeOf("number");
    },
  );

  it("traces creation and resumption without serializing credentials or sessions", async () => {
    const sdk = await loadSDK("dist/client-entry.js");
    const client = new sdk.LettaAgentClient({
      backend: "remote",
      url: "ws://unused.invalid",
    });
    const session = client.resumeSession("agent-test", {
      env: { SECRET: "do-not-log" },
    });
    // Agent creation uses the same session class; stub just runtime initialization.
    Object.getPrototypeOf(session).initialize = async () => ({
      agentId: "agent-created",
    });
    expect(
      await client.createAgent({
        systemPrompt: "Be brief",
        model: "test-model",
      }),
    ).toBe("agent-created");
    const rows = await background.drain();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          span_attributes: expect.objectContaining({
            name: "Letta resumeSession",
          }),
          input: { id: "agent-test" },
        }),
        expect.objectContaining({
          span_attributes: expect.objectContaining({
            name: "Letta createAgent",
          }),
          output: "agent-created",
        }),
      ]),
    );
    expect(JSON.stringify(rows)).not.toContain("do-not-log");
    expect(JSON.stringify(rows)).not.toContain("ws://unused.invalid");
  });

  it("traces sendAndWaitForResult once and separates sequential turns", async () => {
    const { session } = prepareSession(await loadSDK("dist/client-entry.js"), [
      result,
      { ...result, result: "Again" },
    ]);
    expect(await session.sendAndWaitForResult("First")).toBe(result);
    expect(await session.sendAndWaitForResult("Second")).toMatchObject({
      result: "Again",
    });
    const rows = await turns();
    expect(rows.map((row) => [row.input, row.output])).toEqual([
      ["First", "Hello"],
      ["Second", "Again"],
    ]);
  });

  it("parents tool spans under the turn and logs tool failures", async () => {
    const { session } = prepareSession(await loadSDK("dist/client-entry.js"), [
      {
        type: "tool_call",
        toolCallId: "tool-1",
        toolName: "lookup",
        toolInput: { query: "a" },
      },
      {
        type: "tool_result",
        toolCallId: "tool-1",
        content: "not found",
        isError: true,
      },
      result,
    ]);
    await session.sendAndWaitForResult("Search");
    const rows = (await background.drain()) as any[];
    const turn = rows.find(
      (row) => row.span_attributes?.name === "Letta Agent SDK",
    );
    const tool = rows.find((row) => row.span_attributes?.name === "Letta tool");
    expect(tool).toMatchObject({
      input: { query: "a" },
      output: "not found",
      error: "not found",
      span_parents: [turn.span_id],
    });
  });

  it("preserves structured results and records terminal errors", async () => {
    const failed = {
      ...result,
      success: false,
      errorDetail: "model unavailable",
      structuredOutput: { answer: 42 },
    };
    const { session } = prepareSession(await loadSDK("dist/client-entry.js"), [
      failed,
    ]);
    expect(await session.sendAndWaitForResult("Question")).toBe(failed);
    expect(await turns()).toEqual([
      expect.objectContaining({
        output: { answer: 42 },
        error: "model unavailable",
      }),
    ]);
  });

  it("preserves send exceptions and finalizes the failed turn", async () => {
    const { session, sendTurnMessage } = prepareSession(
      await loadSDK("dist/client-entry.js"),
      [],
    );
    const error = new Error("transport failed");
    sendTurnMessage.mockImplementation(() => {
      throw error;
    });
    await expect(session.send("Hi")).rejects.toBe(error);
    expect(await turns()).toEqual([
      expect.objectContaining({
        error: expect.stringContaining("transport failed"),
        metrics: expect.objectContaining({ end: expect.any(Number) }),
      }),
    ]);
  });

  it("finalizes a turn when stream consumption fails", async () => {
    const { session } = prepareSession(
      await loadSDK("dist/client-entry.js"),
      [],
    );
    const error = new Error("disconnected");
    session.turns.nextMessage = async () => {
      throw error;
    };
    await session.send("Hi");
    await expect(session.stream().next()).rejects.toBe(error);
    expect(await turns()).toEqual([
      expect.objectContaining({
        error: expect.stringContaining("disconnected"),
      }),
    ]);
  });

  it.each(["cancel", "close", "disable"])(
    "ends unfinished turns on %s",
    async (operation) => {
      const { session } = prepareSession(
        await loadSDK("dist/client-entry.js"),
        [
          {
            type: "tool_call",
            toolCallId: "tool-1",
            toolName: "lookup",
            toolInput: {},
          },
        ],
      );
      await session.send("Hi");
      const stream = session.stream();
      await stream.next();
      if (operation === "cancel") await stream.return();
      else if (operation === "close") session.close();
      else plugin.disable();
      const rows = (await background.drain()) as any[];
      const turn = rows.find(
        (row) => row.span_attributes?.name === "Letta Agent SDK",
      );
      const tool = rows.find(
        (row) => row.span_attributes?.name === "Letta tool",
      );
      expect(turn.metadata["letta.cancelled"]).toBe(true);
      expect(turn.metrics.end).toBeTypeOf("number");
      expect(tool.metrics.end).toBeTypeOf("number");
    },
  );

  it("supports a stream listener created before sending", async () => {
    const { session } = prepareSession(await loadSDK("dist/client-entry.js"), [
      result,
    ]);
    const stream = session.stream();
    await session.send("Hi");
    await collect(stream);
    expect(await turns()).toHaveLength(1);
  });

  it("keeps queued turns and concurrent sessions separate", async () => {
    const sdk = await loadSDK("dist/client-entry.js");
    const first = prepareSession(sdk, [
      result,
      { ...result, result: "Second" },
    ]).session;
    const other = prepareSession(sdk, [{ ...result, result: "Other" }]).session;
    await first.send("One");
    await first.send("Two");
    await other.send("Three");
    await Promise.all([collect(first.stream()), collect(other.stream())]);
    await collect(first.stream());
    expect((await turns()).map((row) => [row.input, row.output])).toEqual([
      ["One", "Hello"],
      ["Two", "Second"],
      ["Three", "Other"],
    ]);
  });

  it("does not finish the span when send resolves", async () => {
    const { session } = prepareSession(await loadSDK("dist/client-entry.js"), [
      result,
    ]);
    await session.send("Hi");
    const rows = await turns();
    expect(rows).toHaveLength(1);
    expect(rows[0].metrics.end).toBeUndefined();
    await collect(session.stream());
    const updates = (await background.drain()) as any[];
    expect(updates.find((row) => row.id === rows[0].id).metrics.end).toBeTypeOf(
      "number",
    );
  });

  it("records a stream that closes without a terminal result as incomplete", async () => {
    const { session } = prepareSession(await loadSDK("dist/client-entry.js"), [
      { type: "assistant", content: "Partial" },
    ]);
    await session.send("Hi");
    await collect(session.stream());
    expect(await turns()).toEqual([
      expect.objectContaining({
        output: [{ type: "assistant", content: "Partial" }],
        error: "Letta stream ended before a terminal result",
      }),
    ]);
  });

  it("keeps detailed errors and preserves null structured output", async () => {
    const { session } = prepareSession(await loadSDK("dist/client-entry.js"), [
      { type: "error", message: "Model access denied" },
      { ...result, success: false, error: "error", structuredOutput: null },
    ]);
    await session.sendAndWaitForResult("Hi");
    expect(await turns()).toEqual([
      expect.objectContaining({ output: null, error: "Model access denied" }),
    ]);
  });

  it.each([
    "letta",
    "lettaAgentSDK",
    "letta-agent-sdk",
    "@letta-ai/letta-agent-sdk",
  ])("honors disable alias %s", async (alias) => {
    const { session } = prepareSession(
      await loadSDK("dist/client-entry.js", alias),
      [result],
    );
    expect(await session.sendAndWaitForResult("Hi")).toBe(result);
    expect(await background.drain()).toEqual([]);
  });

  it.each([false, true])(
    "manual wrapping is idempotent with automatic instrumentation=%s",
    async (auto) => {
      const sdk = await loadSDK(
        "dist/client-entry.js",
        auto ? undefined : "letta",
      );
      const wrappedSDK = wrapLettaAgentSDK(sdk);
      expect(wrapLettaAgentSDK(wrappedSDK)).toBe(wrappedSDK);
      const { session } = prepareSession(wrappedSDK, [result]);
      expect(wrapLettaAgentSDK(session)).toBe(session);
      expect(await session.sendAndWaitForResult("Wrapped")).toBe(result);
      const rows = await turns();
      expect(rows).toHaveLength(1);
      expect(rows[0].output).toBe("Hello");
    },
  );

  it("omits inline image bytes while preserving the SDK input", async () => {
    const { session, sendTurnMessage } = prepareSession(
      await loadSDK("dist/client-entry.js"),
      [result],
    );
    const input = [
      { type: "text", text: "Describe" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "private-image-bytes",
        },
      },
    ];
    await session.sendAndWaitForResult(input);
    expect(sendTurnMessage.mock.calls[0][1]).toBe(input);
    const rows = await turns();
    expect(JSON.stringify(rows)).not.toContain("private-image-bytes");
    expect(rows[0].input[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png" },
    });
  });
});
