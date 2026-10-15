import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Attachment, _exportsForTestingOnly, initLogger } from "../logger";
import { configureNode } from "../node/config";
import type {
  TypeSafeAPIPromise,
  TypeSafeWithResponse,
} from "../vendor-sdk-types/typesafe";
import { wrapTypeSafe } from "./typesafe";

try {
  configureNode();
} catch {
  // Best-effort initialization for test environments.
}

class MockAPIPromise<T> implements TypeSafeAPIPromise<T> {
  readonly [Symbol.toStringTag] = "Promise";
  private parsed: Promise<T> | undefined;

  constructor(
    private readonly responsePromise: Promise<Response>,
    private readonly parse: (response: Response) => Promise<T>,
  ) {}

  private data(): Promise<T> {
    this.parsed ??= this.responsePromise.then(this.parse);
    return this.parsed;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.data().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.data().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.data().finally(onfinally);
  }

  asResponse(): Promise<Response> {
    return this.responsePromise;
  }

  async withResponse(): Promise<TypeSafeWithResponse<T>> {
    const [data, response] = await Promise.all([
      this.data(),
      this.responsePromise,
    ]);
    return { data, response, requestId: "req_test" };
  }

  map<U>(fn: (data: T) => U): MockAPIPromise<U> {
    return new MockAPIPromise(this.responsePromise, async () =>
      fn(await this.data()),
    );
  }
}

function responsePromise(body: unknown): MockAPIPromise<any> {
  const response = Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    }),
  );
  return new MockAPIPromise(response, async (value) => value.json());
}

describe("TypeSafe wrapper", () => {
  let backgroundLogger: ReturnType<
    typeof _exportsForTestingOnly.useTestBackgroundLogger
  >;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(() => {
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    initLogger({
      projectName: "typesafe.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns unsupported clients unchanged", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unsupported = { models: {} };

    expect(wrapTypeSafe(unsupported)).toBe(unsupported);
    expect(warnSpy).toHaveBeenCalledWith(
      "Unsupported TypeSafe AI library. Not wrapping.",
    );
  });

  it("captures native questions, answers, model, and token usage", async () => {
    const result = {
      answers: {
        category: {
          choice: "billing",
          confidence: 0.9,
          probabilities: { billing: 0.95, technical: 0.05 },
          type: "choice",
        },
        urgent: { noul: 0.8, type: "noul" },
      },
      model: "jev-1.13.0",
      usage: { input_tokens: 20, output_tokens: 5 },
    };
    const original = responsePromise(result);
    const client = wrapTypeSafe({
      defaultModel: "jev-latest",
      systemOne: vi.fn(() => original),
    } as any) as any;

    const returned = client.systemOne({
      state: { message: "Charged twice" },
      questions: {
        category: {
          criteria: { billing: null, technical: null },
          instructions: "Which team?",
          type: "choice",
        },
        urgent: { instructions: "Is this urgent?", type: "noul" },
      },
    });

    expect(returned).toBe(original);
    await expect(returned).resolves.toEqual(result);

    const spans = await backgroundLogger.drain();
    const span = spans.find(
      (candidate: any) =>
        candidate.span_attributes?.name === "typesafe.systemOne",
    ) as Record<string, any> | undefined;
    expect(span).toMatchObject({
      input: {
        questions: [
          { id: "category", type: "choice" },
          { id: "urgent", type: "noul" },
        ],
        state: { message: "Charged twice" },
      },
      metadata: { model: "jev-1.13.0", provider: "typesafe" },
      metrics: { completion_tokens: 5, prompt_tokens: 20, tokens: 25 },
      output: {
        answers: [
          { ...result.answers.category, id: "category" },
          { ...result.answers.urgent, id: "urgent" },
        ],
      },
      span_attributes: { name: "typesafe.systemOne", type: "question" },
    });
  });

  it("preserves APIPromise helpers and the raw response body", async () => {
    const result = {
      answers: { valid: { noul: 1, type: "noul" } },
      model: "jev-1.13.0",
      usage: { input_tokens: 4, output_tokens: 1 },
    };
    const original = responsePromise(result);
    const client = wrapTypeSafe({
      systemOne: vi.fn(() => original),
    } as any) as any;

    const promise = client.systemOne({ state: "hello", questions: {} });
    expect(promise).toBe(original);
    expect(typeof promise.asResponse).toBe("function");
    expect(typeof promise.withResponse).toBe("function");
    expect(typeof promise.map).toBe("function");

    const raw = await promise.asResponse();
    expect(raw.bodyUsed).toBe(false);
    await expect(raw.json()).resolves.toEqual(result);

    const mappedPromise = responsePromise(result);
    const mappedClient = wrapTypeSafe({
      systemOne: vi.fn(() => mappedPromise),
    } as any) as any;
    const mapped = mappedClient
      .systemOne({ state: "hello", questions: {} })
      .map((value: any) => value.model);
    await expect(mapped).resolves.toBe("jev-1.13.0");
  });

  it("logs image references and box answers without reading bytes when capture is disabled", async () => {
    vi.stubEnv("BRAINTRUST_CAPTURE_ATTACHMENTS", "false");
    const readData = vi.fn(() => {
      throw new Error("Image bytes must not be observed");
    });
    const image = {
      [Symbol.for("@typesafe-ai/sdk/image")]: true,
      type: "image",
      get data() {
        return readData();
      },
      toString: () => "<image:1234>",
    };
    const template = {
      [Symbol.for("@typesafe-ai/sdk/text-with-assets")]: true,
      text: "Locate the ship in <image:1234>",
      assets: [image],
    };
    const request = {
      state: Object.assign(Object.create(null), {
        photo: image,
        description: template,
      }),
      assets: { "<photo>": image },
      questions: { ship: { type: "box", instructions: template } },
    };
    const result = {
      model: "jev-1.14.0",
      answers: {
        ship: {
          type: "box",
          box: { top: 0.1, bottom: 0.8, left: 0.2, right: 0.7 },
          confidence: null,
        },
      },
      usage: { input_tokens: 10, output_tokens: null },
    };
    const promise = responsePromise(result);
    const provider = {
      systemOne: vi.fn(function (this: unknown, actual: unknown) {
        expect(this).toBe(provider);
        expect(actual).toBe(request);
        return promise;
      }),
    };
    const wrapped = wrapTypeSafe(provider);
    expect(wrapped.systemOne(request)).toBe(promise);
    await promise;
    const [span] = await backgroundLogger.drain();
    expect(span).toMatchObject({
      input: {
        state: { photo: "<photo>", description: "Locate the ship in <photo>" },
        questions: [
          {
            id: "ship",
            type: "box",
            instructions: "Locate the ship in <photo>",
          },
        ],
        assets: { "<photo>": { type: "image" } },
      },
      output: { answers: [{ id: "ship", ...result.answers.ship }] },
      metrics: { prompt_tokens: 10 },
    });
    expect(readData).not.toHaveBeenCalled();
    expect(provider.systemOne).toHaveBeenCalledTimes(1);
    expect(request.state.photo).toBe(image);
    expect(template.text).toBe("Locate the ship in <image:1234>");
  });

  it.each(["bytes", "blob"])(
    "captures %s assets once and snapshots caller-owned bytes",
    async (kind) => {
      vi.stubEnv("BRAINTRUST_CAPTURE_ATTACHMENTS", "true");
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
      const originalBytes = bytes.slice();
      const image = {
        [Symbol.for("@typesafe-ai/sdk/image")]: true,
        type: "image",
        data:
          kind === "blob" ? new Blob([bytes], { type: "image/png" }) : bytes,
        toString: () => "<image:1234>",
      };
      const client = wrapTypeSafe({
        systemOne: (_request: unknown) => responsePromise({ answers: {} }),
      });
      const promise = client.systemOne({
        state: [image, "<first>", "<second>"],
        questions: { match: { type: "noul", instructions: [image] } },
        assets: { "<first>": image, "<second>": image },
      });
      bytes.fill(0);
      await promise;
      const [span] = await backgroundLogger.drain();
      const input = (span as { input: { assets: Record<string, Attachment> } })
        .input;
      expect(span).toMatchObject({
        input: {
          state: ["<second>", "<first>", "<second>"],
          questions: [{ id: "match", instructions: ["<second>"] }],
        },
      });
      const attachment = input.assets["<first>"];
      expect(attachment).toBeInstanceOf(Attachment);
      expect(input.assets["<second>"]).toBe(attachment);
      expect(attachment.reference.content_type).toBe("image/png");
      expect(
        new Uint8Array(await (await attachment.data()).arrayBuffer()),
      ).toEqual(originalBytes);
    },
  );

  it("preserves JSON serialization of non-asset state objects", async () => {
    const date = new Date("2026-10-15T00:00:00Z");
    const client = wrapTypeSafe({
      systemOne: (_request: unknown) => responsePromise({ answers: {} }),
    });
    await client.systemOne({ state: { date }, questions: {} });
    const [span] = await backgroundLogger.drain();
    expect(span).toMatchObject({
      input: { state: { date: date.toISOString() } },
    });
  });

  it("preserves synchronous and asynchronous provider errors", async () => {
    const syncError = new Error("invalid questions");
    const syncClient = wrapTypeSafe({
      systemOne: vi.fn(() => {
        throw syncError;
      }),
    } as any) as any;

    expect(() =>
      syncClient.systemOne({ state: "hello", questions: {} }),
    ).toThrow(syncError);

    const asyncError = new Error("request failed");
    const rejected = new MockAPIPromise<any>(
      Promise.reject(asyncError),
      async () => undefined,
    );
    const asyncClient = wrapTypeSafe({
      systemOne: vi.fn(() => rejected),
    } as any) as any;
    await expect(
      asyncClient.systemOne({ state: "hello", questions: {} }),
    ).rejects.toBe(asyncError);

    const spans = await backgroundLogger.drain();
    const errors = spans
      .filter(
        (candidate: any) =>
          candidate.span_attributes?.name === "typesafe.systemOne",
      )
      .map((span: any) => span.error);
    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error !== undefined)).toBe(true);
  });
});
