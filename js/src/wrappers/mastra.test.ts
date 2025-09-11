import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { wrapMastraAgent } from "./mastra";
import {
  _exportsForTestingOnly,
  Logger,
  TestBackgroundLogger,
  initLogger,
} from "../logger";

// Initialize test state for logger utilities
_exportsForTestingOnly.setInitialTestState();

class FakeTool {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
  async execute(ctx: any): Promise<any> {
    return { ok: true, ctx };
  }
}

function makeTextStream(chunks: string[]): AsyncIterable<string> {
  return (async function* () {
    for (const ch of chunks) {
      yield ch;
    }
  })();
}

class FakeAgent {
  name: string;
  tools: Record<string, any>;
  constructor(name: string) {
    this.name = name;
    this.tools = { math: new FakeTool("math") };
  }

  async generate(params: any): Promise<any> {
    // Use a tool to ensure tool wrapping creates child spans
    await this.tools.math.execute({ value: 42 });
    return {
      text: `ok:${params?.prompt ?? ""}`,
      finishReason: "stop",
      request: { body: { model: "fake-model" } },
      providerMetadata: { openai: {} },
    };
  }

  async generateVNext(params: any): Promise<any> {
    // Mirror generate
    return this.generate(params);
  }

  async stream(
    params: any,
    opts?: {
      onChunk?: (c: any) => void;
      onFinish?: (e: any) => Promise<void> | void;
    },
  ): Promise<any> {
    const chunks = ["hello ", "world"];
    const self = this;
    async function* gen() {
      let full = "";
      for (const ch of chunks) {
        opts?.onChunk?.(ch);
        full += ch;
        yield ch;
      }
      const event = {
        text: full,
        finishReason: "stop",
        request: { body: { model: "fake-model" } },
        providerMetadata: { openai: {} },
      };
      await opts?.onFinish?.(event);
    }
    const textStream = gen();
    return {
      textStream,
      // Provide finish info here too (some implementations include it)
      finishReason: "stop",
      request: { body: { model: "fake-model" } },
      providerMetadata: { openai: {} },
    };
  }

  async streamVNext(
    params: any,
    opts?: {
      onChunk?: (c: any) => void;
      onFinish?: (e: any) => Promise<void> | void;
    },
  ): Promise<any> {
    return this.stream(params, opts);
  }
}

describe("wrapMastraAgent", () => {
  let testLogger: TestBackgroundLogger;
  let logger: Logger<true>;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(() => {
    testLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    logger = initLogger({
      projectName: "mastra.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("generate wraps and logs", async () => {
    expect(await testLogger.drain()).toHaveLength(0);

    const agent = new FakeAgent("demo");
    wrapMastraAgent(agent, { name: "demoAgent" });

    const res = await agent.generate({ prompt: "2+2" });
    expect(typeof res.text).toBe("string");

    const spans = (await testLogger.drain()) as any[];
    expect(spans.length).toBeGreaterThan(0);
    const wrapperSpan = spans.find(
      (s) => s?.span_attributes?.name === "demoAgent.generate",
    );
    expect(wrapperSpan).toBeTruthy();
    expect(wrapperSpan.output).toBe(res.text);
    expect(wrapperSpan.metadata?.model).toBe("fake-model");
    const fr = (wrapperSpan.metadata ?? {}).finish_reason;
    expect(fr === undefined || typeof fr === "string").toBe(true);
  });

  test("generateVNext wraps and logs", async () => {
    expect(await testLogger.drain()).toHaveLength(0);
    const agent = new FakeAgent("demo");
    wrapMastraAgent(agent, { name: "demoAgent" });

    const res = await agent.generateVNext({ prompt: "ping" });
    expect(typeof res.text).toBe("string");

    const spans = (await testLogger.drain()) as any[];
    const wrapperSpan = spans.find(
      (s) => s?.span_attributes?.name === "demoAgent.generateVNext",
    );
    expect(wrapperSpan).toBeTruthy();
    expect(wrapperSpan.output).toBe(res.text);
  });

  test("stream wraps, logs ttfb and aggregates output", async () => {
    expect(await testLogger.drain()).toHaveLength(0);
    const agent = new FakeAgent("demo");
    wrapMastraAgent(agent, { name: "demoAgent" });

    const { textStream } = await agent.stream({ prompt: "stream please" });
    let full = "";
    for await (const ch of textStream) full += ch;

    const spans = (await testLogger.drain()) as any[];
    const wrapperSpan = spans.find(
      (s) => s?.span_attributes?.name === "demoAgent.stream",
    );
    expect(wrapperSpan).toBeTruthy();
    expect(wrapperSpan.output).toBe(full);
    expect(typeof wrapperSpan.metrics?.time_to_first_token).toBe("number");
  });

  test("streamVNext wraps similarly", async () => {
    expect(await testLogger.drain()).toHaveLength(0);
    const agent = new FakeAgent("demo");
    wrapMastraAgent(agent, { name: "demoAgent" });

    const { textStream } = await agent.streamVNext({ prompt: "go" });
    for await (const _ of textStream) {
      // drain
    }

    const spans = (await testLogger.drain()) as any[];
    const wrapperSpan = spans.find(
      (s) => s?.span_attributes?.name === "demoAgent.streamVNext",
    );
    expect(wrapperSpan).toBeTruthy();
  });
});
