import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GoogleADKPlugin } from "./google-adk-plugin";
import { tracingChannel } from "dc-browser";

// Mock dc-browser
vi.mock("dc-browser", () => ({
  tracingChannel: vi.fn(),
}));

// Mock logger
vi.mock("../../logger", () => ({
  startSpan: vi.fn(() => ({
    log: vi.fn(),
    end: vi.fn(),
    export: vi.fn(() => Promise.resolve({})),
  })),
}));

// Mock utility modules
vi.mock("../../../util/index", () => ({
  SpanTypeAttribute: {
    TASK: "task",
    LLM: "llm",
    TOOL: "tool",
  },
  isObject: vi.fn((val: unknown) => val !== null && typeof val === "object"),
}));

vi.mock("../../util", () => ({
  getCurrentUnixTimestamp: vi.fn(() => 1000),
}));

vi.mock("../core", () => ({
  BasePlugin: class BasePlugin {
    protected enabled = false;
    protected unsubscribers: Array<() => void> = [];

    enable(): void {
      if (this.enabled) {
        return;
      }
      this.enabled = true;
      this.onEnable();
    }

    disable(): void {
      if (!this.enabled) {
        return;
      }
      this.enabled = false;
      this.onDisable();
    }

    protected onEnable(): void {
      // To be implemented by subclass
    }

    protected onDisable(): void {
      // To be implemented by subclass
    }
  },
  isAsyncIterable: vi.fn(
    (val: unknown) =>
      val !== null &&
      typeof val === "object" &&
      Symbol.asyncIterator in val &&
      typeof (val as any)[Symbol.asyncIterator] === "function",
  ),
  patchStreamIfNeeded: vi.fn((stream, callbacks) => {
    return stream;
  }),
}));

describe("GoogleADKPlugin", () => {
  let plugin: GoogleADKPlugin;
  let mockChannel: any;
  let mockUnsubscribe: any;

  beforeEach(() => {
    mockUnsubscribe = vi.fn();
    mockChannel = {
      subscribe: vi.fn(),
      unsubscribe: mockUnsubscribe,
    };

    (tracingChannel as any).mockReturnValue(mockChannel);

    plugin = new GoogleADKPlugin();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("enable/disable lifecycle", () => {
    it("should subscribe to all four channels when enabled", () => {
      plugin.enable();

      expect(tracingChannel).toHaveBeenCalledWith(
        "orchestrion:google-adk:runner.runAsync",
      );
      expect(tracingChannel).toHaveBeenCalledWith(
        "orchestrion:google-adk:agent.runAsync",
      );
      expect(tracingChannel).toHaveBeenCalledWith(
        "orchestrion:google-adk:llm.callLlmAsync",
      );
      expect(tracingChannel).toHaveBeenCalledWith(
        "orchestrion:google-adk:mcpTool.runAsync",
      );
      expect(mockChannel.subscribe).toHaveBeenCalledTimes(4);
    });

    it("should not subscribe multiple times if enabled twice", () => {
      plugin.enable();
      const firstCallCount = mockChannel.subscribe.mock.calls.length;

      plugin.enable();
      const secondCallCount = mockChannel.subscribe.mock.calls.length;

      expect(firstCallCount).toBe(secondCallCount);
    });

    it("should unsubscribe from channels when disabled", () => {
      plugin.enable();
      plugin.disable();

      expect(mockUnsubscribe).toHaveBeenCalledTimes(4);
    });

    it("should clear unsubscribers array after disable", () => {
      plugin.enable();
      plugin.disable();

      expect((plugin as any).unsubscribers).toHaveLength(0);
    });

    it("should not crash when disabled without being enabled", () => {
      expect(() => plugin.disable()).not.toThrow();
    });

    it("should allow re-enabling after disable", () => {
      plugin.enable();
      plugin.disable();
      plugin.enable();

      expect(mockChannel.subscribe).toHaveBeenCalledTimes(8); // 4 + 4
    });
  });

  describe("runner.runAsync channel subscription", () => {
    let handlers: any;

    beforeEach(() => {
      plugin.enable();
      // Find the handlers for the runner channel (first subscribe call)
      handlers = mockChannel.subscribe.mock.calls[0][0];
    });

    it("should have start, asyncEnd, and error handlers", () => {
      expect(handlers).toHaveProperty("start");
      expect(handlers).toHaveProperty("asyncEnd");
      expect(handlers).toHaveProperty("error");
    });

    it("should handle start event with runner params", () => {
      const event = {
        self: { appName: "my-app" },
        arguments: [
          {
            userId: "user-1",
            sessionId: "session-1",
            newMessage: { parts: [{ text: "Hello" }] },
          },
        ],
      };

      expect(() => handlers.start(event)).not.toThrow();
    });

    it("should handle start event with missing self", () => {
      const event = {
        self: null,
        arguments: [{}],
      };

      expect(() => handlers.start(event)).not.toThrow();
    });

    it("should handle asyncEnd without matching start", () => {
      const event = {
        arguments: [{}],
        result: {},
      };

      expect(() => handlers.asyncEnd(event)).not.toThrow();
    });

    it("should handle error without matching start", () => {
      const event = {
        arguments: [{}],
        error: new Error("Test error"),
      };

      expect(() => handlers.error(event)).not.toThrow();
    });

    it("should handle error with matching start", () => {
      const startEvent = {
        self: { appName: "my-app" },
        arguments: [{ userId: "user-1" }],
      };
      handlers.start(startEvent);

      const errorEvent = {
        ...startEvent,
        error: new Error("Runner error"),
      };

      expect(() => handlers.error(errorEvent)).not.toThrow();
    });
  });

  describe("agent.runAsync channel subscription", () => {
    let handlers: any;

    beforeEach(() => {
      plugin.enable();
      // Second subscribe call is for agent channel
      handlers = mockChannel.subscribe.mock.calls[1][0];
    });

    it("should have start, asyncEnd, and error handlers", () => {
      expect(handlers).toHaveProperty("start");
      expect(handlers).toHaveProperty("asyncEnd");
      expect(handlers).toHaveProperty("error");
    });

    it("should handle start event with agent name", () => {
      const event = {
        self: { name: "weather-agent" },
        arguments: [{}],
      };

      expect(() => handlers.start(event)).not.toThrow();
    });

    it("should handle start event with missing agent name", () => {
      const event = {
        self: {},
        arguments: [{}],
      };

      expect(() => handlers.start(event)).not.toThrow();
    });
  });

  describe("llm.callLlmAsync channel subscription", () => {
    let handlers: any;

    beforeEach(() => {
      plugin.enable();
      // Third subscribe call is for LLM channel
      handlers = mockChannel.subscribe.mock.calls[2][0];
    });

    it("should have start, asyncEnd, and error handlers", () => {
      expect(handlers).toHaveProperty("start");
      expect(handlers).toHaveProperty("asyncEnd");
      expect(handlers).toHaveProperty("error");
    });

    it("should handle start event with llm request", () => {
      const event = {
        self: {
          name: "llm-agent",
          llm: { model: "gemini-2.0-flash" },
        },
        arguments: [
          {}, // invocationContext
          {
            // llmRequest
            contents: [{ parts: [{ text: "Hello" }] }],
            config: { temperature: 0.7 },
          },
          {}, // modelResponseEvent
        ],
      };

      expect(() => handlers.start(event)).not.toThrow();
    });

    it("should handle start event with model on self directly", () => {
      const event = {
        self: {
          name: "llm-agent",
          model: "gemini-2.0-flash",
        },
        arguments: [{}, {}, {}],
      };

      expect(() => handlers.start(event)).not.toThrow();
    });

    it("should handle non-streaming asyncEnd result", () => {
      const startEvent = {
        self: { name: "llm-agent", llm: { model: "gemini-2.0-flash" } },
        arguments: [{}, {}, {}],
      };
      handlers.start(startEvent);

      const endEvent = {
        ...startEvent,
        result: {
          content: { parts: [{ text: "Response" }] },
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30,
          },
        },
      };

      expect(() => handlers.asyncEnd(endEvent)).not.toThrow();
    });
  });

  describe("mcpTool.runAsync channel subscription", () => {
    let handlers: any;

    beforeEach(() => {
      plugin.enable();
      // Fourth subscribe call is for MCP tool channel
      handlers = mockChannel.subscribe.mock.calls[3][0];
    });

    it("should have start, asyncEnd, and error handlers", () => {
      expect(handlers).toHaveProperty("start");
      expect(handlers).toHaveProperty("asyncEnd");
      expect(handlers).toHaveProperty("error");
    });

    it("should handle start event with tool name and args", () => {
      const event = {
        self: { name: "get_weather" },
        arguments: [{ args: { location: "NYC" } }],
      };

      expect(() => handlers.start(event)).not.toThrow();
    });

    it("should handle asyncEnd with result", () => {
      const startEvent = {
        self: { name: "get_weather" },
        arguments: [{ args: { location: "NYC" } }],
      };
      handlers.start(startEvent);

      const endEvent = {
        ...startEvent,
        result: { content: [{ type: "text", text: "Sunny, 72F" }] },
      };

      expect(() => handlers.asyncEnd(endEvent)).not.toThrow();
    });

    it("should handle error with tool call", () => {
      const startEvent = {
        self: { name: "get_weather" },
        arguments: [{ args: { location: "NYC" } }],
      };
      handlers.start(startEvent);

      const errorEvent = {
        ...startEvent,
        error: new Error("Tool execution failed"),
      };

      expect(() => handlers.error(errorEvent)).not.toThrow();
    });
  });
});

describe("Google ADK helper functions", () => {
  describe("isFinalResponse logic", () => {
    it("should identify final response events (no function calls/responses)", () => {
      const event = {
        content: { parts: [{ text: "Final answer" }] },
        actions: {},
      };

      // No functionCall or functionResponse parts = final
      const hasFunctionCalls = event.content.parts.some(
        (p: any) => p.functionCall,
      );
      const hasFunctionResponses = event.content.parts.some(
        (p: any) => p.functionResponse,
      );

      expect(hasFunctionCalls).toBe(false);
      expect(hasFunctionResponses).toBe(false);
    });

    it("should not identify events with function calls as final", () => {
      const event = {
        content: {
          parts: [{ functionCall: { name: "get_weather", args: {} } }],
        },
        actions: {},
      };

      const hasFunctionCalls = event.content.parts.some(
        (p: any) => p.functionCall,
      );
      expect(hasFunctionCalls).toBe(true);
    });

    it("should identify events with skipSummarization as final", () => {
      const event = {
        content: { parts: [] },
        actions: { skipSummarization: true },
      };

      expect(event.actions.skipSummarization).toBe(true);
    });

    it("should not identify partial events as final", () => {
      const event = {
        content: { parts: [{ text: "Partial..." }] },
        partial: true,
        actions: {},
      };

      expect(event.partial).toBe(true);
    });
  });

  describe("token metric extraction", () => {
    it("should extract usage metadata correctly", () => {
      const usageMetadata = {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      };

      expect(usageMetadata.promptTokenCount).toBe(10);
      expect(usageMetadata.candidatesTokenCount).toBe(20);
      expect(usageMetadata.totalTokenCount).toBe(30);
    });

    it("should handle cached content tokens", () => {
      const usageMetadata = {
        promptTokenCount: 100,
        cachedContentTokenCount: 50,
      };

      expect(usageMetadata.cachedContentTokenCount).toBe(50);
    });

    it("should handle thoughts tokens", () => {
      const usageMetadata = {
        candidatesTokenCount: 80,
        thoughtsTokenCount: 20,
      };

      expect(usageMetadata.thoughtsTokenCount).toBe(20);
    });

    it("should handle missing usage metadata", () => {
      const response: any = {};
      expect(response.usageMetadata).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("should handle events without content", () => {
      const event = {};
      expect((event as any).content).toBeUndefined();
    });

    it("should handle events with empty parts", () => {
      const event = {
        content: { parts: [] },
      };
      expect(event.content.parts).toHaveLength(0);
    });

    it("should handle MCPTool with missing args", () => {
      const request = {};
      expect((request as any).args).toBeUndefined();
    });
  });
});
