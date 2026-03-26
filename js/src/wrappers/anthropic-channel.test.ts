import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockNewTracingChannel } = vi.hoisted(() => ({
  mockNewTracingChannel: vi.fn(),
}));

vi.mock("../isomorph", () => ({
  default: {
    newTracingChannel: mockNewTracingChannel,
  },
}));

import { wrapAnthropic } from "./anthropic";

class MockAnthropicPromise<T> extends Promise<T> {
  #innerPromise: Promise<T>;

  constructor(responsePromise: Promise<T>) {
    let resolveOuter!: (value: T | PromiseLike<T>) => void;
    super((resolve) => {
      resolveOuter = resolve;
    });
    this.#innerPromise = Promise.resolve(responsePromise);
    this.#innerPromise.then(resolveOuter);
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
      | undefined,
  ): Promise<TResult1 | TResult2> {
    return this.#innerPromise.then(onfulfilled, onrejected);
  }

  async withResponse(): Promise<{ data: T }> {
    return {
      data: await this.#innerPromise,
    };
  }
}

function makeTracingSubchannel() {
  return {
    name: "mock",
    hasSubscribers: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    bindStore: vi.fn(),
    unbindStore: vi.fn(),
    publish: vi.fn(),
    runStores: vi.fn(
      (
        _message: unknown,
        fn: (...args: unknown[]) => unknown,
        thisArg?: unknown,
      ) => fn.call(thisArg),
    ),
  };
}

function makeTracingChannel() {
  return {
    hasSubscribers: true,
    start: makeTracingSubchannel(),
    end: makeTracingSubchannel(),
    asyncStart: makeTracingSubchannel(),
    asyncEnd: makeTracingSubchannel(),
    error: makeTracingSubchannel(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    traceSync: vi.fn(),
    tracePromise: vi.fn(),
    traceCallback: vi.fn(),
  };
}

describe("wrapAnthropic channel tracing", () => {
  beforeEach(() => {
    mockNewTracingChannel.mockReset();
  });

  it("publishes messages.create tracing events without replacing the APIPromise", async () => {
    const channelsByName = new Map<
      string,
      ReturnType<typeof makeTracingChannel>
    >();
    mockNewTracingChannel.mockImplementation((name: string) => {
      const channel = makeTracingChannel();
      channelsByName.set(name, channel);
      return channel;
    });

    const result = {
      role: "assistant",
      content: [{ type: "text" as const, text: "OK" }],
    };
    const apiPromise = new MockAnthropicPromise(Promise.resolve(result));
    const create = vi.fn(() => apiPromise);
    const client = wrapAnthropic({
      messages: {
        create,
      },
    });

    const tracedPromise = client.messages.create({
      model: "claude-test",
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with OK." }],
    });

    expect(tracedPromise).toBe(apiPromise);
    expect(typeof tracedPromise.withResponse).toBe("function");
    expect(await tracedPromise).toEqual(result);
    expect(await tracedPromise.withResponse()).toEqual({ data: result });

    const channel = channelsByName.get(
      "orchestrion:@anthropic-ai/sdk:messages.create",
    );
    expect(channel).toBeDefined();
    expect(create).toHaveBeenCalledTimes(1);

    const startContext = channel!.start.publish.mock.calls[0]?.[0];
    expect(startContext).toMatchObject({
      arguments: [
        {
          model: "claude-test",
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply with OK." }],
        },
      ],
    });

    expect(channel!.end.publish).toHaveBeenCalledWith(startContext);
    expect(channel!.asyncStart.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        result,
      }),
    );
    expect(channel!.asyncEnd.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        result,
      }),
    );
    expect(channel!.error.publish).not.toHaveBeenCalled();
  });
});
