import { describe, expect, test, vi } from "vitest";
import {
  DEFAULT_FETCH_BATCH_SIZE,
  ObjectFetcher,
  type BraintrustState,
} from "./logger";
import { configureNode } from "./node";

configureNode();

type TestRecord = { id: string };

type MockBtqlResponse = {
  data: Array<Record<string, unknown>>;
  cursor?: string | null;
};

function createPostMock(
  response: MockBtqlResponse = { data: [], cursor: null },
) {
  return vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue(response),
  });
}

class TestObjectFetcher extends ObjectFetcher<TestRecord> {
  constructor(
    private readonly postMock: ReturnType<typeof createPostMock>,
    internalBtql?: Record<string, unknown>,
  ) {
    super("dataset", undefined, undefined, internalBtql);
  }

  public get id(): Promise<string> {
    return Promise.resolve("test-dataset-id");
  }

  protected async getState(): Promise<BraintrustState> {
    return {
      apiConn: () => ({
        post: this.postMock,
      }),
    } as unknown as BraintrustState;
  }
}

async function triggerFetch(
  fetcher: TestObjectFetcher,
  options?: { batchSize?: number },
) {
  await fetcher.fetchedData(options);
}

function getBtqlQuery(postMock: ReturnType<typeof createPostMock>) {
  const call = postMock.mock.calls[0];
  expect(call).toBeDefined();
  const requestBody = call[1] as { query: Record<string, unknown> };
  return requestBody.query;
}

describe("ObjectFetcher internal BTQL limit handling", () => {
  test("preserves custom _internal_btql limit instead of default batch size", async () => {
    const postMock = createPostMock();
    const fetcher = new TestObjectFetcher(postMock, {
      limit: 50,
      where: { op: "eq", left: "foo", right: "bar" },
    });

    await triggerFetch(fetcher);

    expect(postMock).toHaveBeenCalledTimes(1);
    const query = getBtqlQuery(postMock);
    expect(query.limit).toBe(50);
    expect(query.where).toEqual({ op: "eq", left: "foo", right: "bar" });
  });

  test("uses default batch size when no _internal_btql limit is provided", async () => {
    const postMock = createPostMock();
    const fetcher = new TestObjectFetcher(postMock);

    await triggerFetch(fetcher);

    const query = getBtqlQuery(postMock);
    expect(query.limit).toBe(DEFAULT_FETCH_BATCH_SIZE);
  });

  test("uses explicit fetch batchSize when no _internal_btql limit is provided", async () => {
    const postMock = createPostMock();
    const fetcher = new TestObjectFetcher(postMock);

    await triggerFetch(fetcher, { batchSize: 17 });

    const query = getBtqlQuery(postMock);
    expect(query.limit).toBe(17);
  });
});
