/* These tests have been isolated from the others in logger.test.ts due to
 * pollution of global test state. Running them causes other tests to improperly
 * make requests to braintrust.dev instead of using the test api key.
 */

/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";
import {
  _exportsForTestingOnly,
  BaseAttachment,
  Attachment,
  ExternalAttachment,
  DEFAULT_FETCH_BATCH_SIZE,
  Dataset,
  initDataset,
  initExperiment,
  initLogger,
  NOOP_SPAN,
  permalink,
  BraintrustState,
} from "./logger";
import { SpanObjectTypeV3 } from "../util/index";
import { LazyValue } from "./util";
import { BackgroundLogEvent, IS_MERGE_FIELD } from "../util/index";
import { configureNode } from "./node";

configureNode();

const { extractAttachments, deepCopyEvent } = _exportsForTestingOnly;

test("extractAttachments no op", () => {
  const attachments: BaseAttachment[] = [];

  extractAttachments({}, attachments);
  expect(attachments).toHaveLength(0);

  const event = { foo: "foo", bar: null, baz: [1, 2, 3] };
  extractAttachments(event, attachments);
  expect(attachments).toHaveLength(0);
  // Same instance.
  expect(event.baz).toBe(event.baz);
  // Same content.
  expect(event).toEqual({ foo: "foo", bar: null, baz: [1, 2, 3] });
});

test("extractAttachments with attachments", () => {
  const attachment1 = new Attachment({
    data: new Blob(["data"]),
    filename: "filename",
    contentType: "text/plain",
  });
  const attachment2 = new Attachment({
    data: new Blob(["data2"]),
    filename: "filename2",
    contentType: "text/plain",
  });
  const attachment3 = new ExternalAttachment({
    url: "s3://bucket/path/to/key.pdf",
    filename: "filename3",
    contentType: "application/pdf",
  });
  const date = new Date();
  const event = {
    foo: "bar",
    baz: [1, 2],
    attachment1,
    attachment3,
    nested: {
      attachment2,
      attachment3,
      info: "another string",
      anArray: [
        attachment1,
        null,
        "string",
        attachment2,
        attachment1,
        attachment3,
        attachment3,
      ],
    },
    null: null,
    undefined: undefined,
    date,
    f: Math.max,
    empty: {},
  };
  const savedNested = event.nested;

  const attachments: BaseAttachment[] = [];
  extractAttachments(event, attachments);

  expect(attachments).toEqual([
    attachment1,
    attachment3,
    attachment2,
    attachment3,
    attachment1,
    attachment2,
    attachment1,
    attachment3,
    attachment3,
  ]);
  expect(attachments[0]).toBe(attachment1);
  expect(attachments[1]).toBe(attachment3);
  expect(attachments[2]).toBe(attachment2);
  expect(attachments[3]).toBe(attachment3);
  expect(attachments[4]).toBe(attachment1);
  expect(attachments[5]).toBe(attachment2);
  expect(attachments[6]).toBe(attachment1);
  expect(attachments[7]).toBe(attachment3);
  expect(attachments[8]).toBe(attachment3);

  expect(event.nested).toBe(savedNested);

  expect(event).toEqual({
    foo: "bar",
    baz: [1, 2],
    attachment1: attachment1.reference,
    attachment3: attachment3.reference,
    nested: {
      attachment2: attachment2.reference,
      attachment3: attachment3.reference,
      info: "another string",
      anArray: [
        attachment1.reference,
        null,
        "string",
        attachment2.reference,
        attachment1.reference,
        attachment3.reference,
        attachment3.reference,
      ],
    },
    null: null,
    undefined: undefined,
    date,
    f: Math.max,
    empty: {},
  });
});

test("deepCopyEvent basic", () => {
  const original: Partial<BackgroundLogEvent> = {
    input: { foo: "bar", null: null, empty: {} },
    output: [1, 2, "3", null, {}],
  };
  const copy = deepCopyEvent(original);
  expect(copy).toEqual(original);
  expect(copy).not.toBe(original);
  expect(copy.input).not.toBe(original.input);
  expect(copy.output).not.toBe(original.output);
});

test.skip("deepCopyEvent with attachments", () => {
  const attachment1 = new Attachment({
    data: new Blob(["data"]),
    filename: "filename",
    contentType: "text/plain",
  });
  const attachment2 = new Attachment({
    data: new Blob(["data2"]),
    filename: "filename2",
    contentType: "text/plain",
  });
  const attachment3 = new ExternalAttachment({
    url: "s3://bucket/path/to/key.pdf",
    filename: "filename3",
    contentType: "application/pdf",
  });
  const date = new Date("2024-10-23T05:02:48.796Z");

  const span = NOOP_SPAN;
  const logger = initLogger();
  const experiment = initExperiment("project");
  const dataset = initDataset({});

  const original = {
    input: "Testing",
    output: {
      span,
      myIllegalObjects: [experiment, dataset, logger],
      myOtherWeirdObjects: [Math.max, date, null, undefined],
      attachment: attachment1,
      another_attachment: attachment3,
      attachmentList: [attachment1, attachment2, "string", attachment3],
      nestedAttachment: {
        attachment: attachment2,
        another_attachment: attachment3,
      },
      fake: {
        _bt_internal_saved_attachment: "not a number",
      },
    },
  };

  const copy = deepCopyEvent(original);

  expect(copy).toEqual({
    input: "Testing",
    output: {
      span: "<span>",
      myIllegalObjects: ["<experiment>", "<dataset>", "<logger>"],
      myOtherWeirdObjects: [null, "2024-10-23T05:02:48.796Z", null, null],
      attachment: attachment1,
      another_attachment: attachment3,
      attachmentList: [attachment1, attachment2, "string", attachment3],
      nestedAttachment: {
        attachment: attachment2,
        another_attachment: attachment3,
      },
      fake: {
        _bt_internal_saved_attachment: "not a number",
      },
    },
  });

  expect(copy).not.toBe(original);

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  expect((copy.output as any).attachment).toBe(attachment1);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  expect((copy.output as any).another_attachment).toBe(attachment3);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  expect((copy.output as any).nestedAttachment.attachment).toBe(attachment2);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  expect((copy.output as any).nestedAttachment.another_attachment).toBe(
    attachment3,
  );
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  expect((copy.output as any).attachmentList[0]).toBe(attachment1);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  expect((copy.output as any).attachmentList[1]).toBe(attachment2);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  expect((copy.output as any).attachmentList[3]).toBe(attachment3);
});

describe("span.link", () => {
  beforeEach(() => {
    _exportsForTestingOnly.simulateLogoutForTests();
  });

  afterEach(() => {
    _exportsForTestingOnly.simulateLogoutForTests();
  });

  test("noop span link returns noop permalink", () => {
    const span = NOOP_SPAN;
    const link = span.link();
    expect(link).toBe("https://braintrust.dev/noop-span");
  });

  test("span.link works with project id", async () => {
    // Mock the state for testing - must be done before creating the span
    const state = await _exportsForTestingOnly.simulateLoginForTests();

    // Verify the login was successful
    expect(state.orgName).toBeDefined();
    expect(state.appUrl).toBeDefined();

    // Create a test span
    const logger = initLogger({
      projectName: "test-project",
      projectId: "test-project-id",
    });

    const span = logger.startSpan({ name: "test-span" });
    span.end();

    // Get the link
    const link1 = span.link();
    const link2 = await span.permalink();

    expect(link1).toBe(link2);
  });

  test("span.link works with project name", async () => {
    // Mock the state for testing - must be done before creating the span
    const state = await _exportsForTestingOnly.simulateLoginForTests();
    // Verify the login was successful
    expect(state.orgName).toBeDefined();
    expect(state.appUrl).toBeDefined();
    // Create a test span
    const logger = initLogger({
      projectName: "test-project",
    });
    const span = logger.startSpan({ name: "test-span" });
    span.end();
    // Get the link
    const link1 = span.link();
    expect(link1).toBe(
      // @ts-ignore
      `https://braintrust.dev/app/test-org-name/p/test-project/logs?oid=${span._id}`,
    );
  });

  test("span.link handles missing project name or id", async () => {
    // Mock the state for testing - must be done before creating the span
    const state = await _exportsForTestingOnly.simulateLoginForTests();
    // Verify the login was successful
    expect(state.orgName).toBeDefined();
    expect(state.appUrl).toBeDefined();
    // Create a test span
    const logger = initLogger({});
    const span = logger.startSpan({ name: "test-span" });
    span.end();
    // Get the link
    const link1 = span.link();
    expect(link1).toBe(
      "https://braintrust.dev/error-generating-link?msg=provide-project-name-or-id",
    );
  });

  test("span.link uses BRAINTRUST_ORG_NAME env var when state.orgName not set", () => {
    const originalEnv = process.env.BRAINTRUST_ORG_NAME;
    try {
      // Set env var (beforeEach already ensures logged out state)
      process.env.BRAINTRUST_ORG_NAME = "env-org-name";

      // Create logger with project_id but no login
      const logger = initLogger({ projectId: "test-project-id" });
      const span = logger.startSpan({ name: "test-span" });
      span.end();

      const link = span.link();

      // Should use env var org name
      expect(link).toContain("/app/env-org-name/");
      expect(link).toContain("test-project-id");
    } finally {
      if (originalEnv) {
        process.env.BRAINTRUST_ORG_NAME = originalEnv;
      } else {
        delete process.env.BRAINTRUST_ORG_NAME;
      }
    }
  });

  test("span.link uses orgName passed to initLogger when not logged in", () => {
    // beforeEach already ensures logged out state
    // Create logger with orgName passed directly (no login, no env var)
    const logger = initLogger({
      projectId: "test-project-id",
      orgName: "passed-org-name",
    });
    const span = logger.startSpan({ name: "test-span" });
    span.end();

    const link = span.link();

    // Should use orgName passed to initLogger
    expect(link).toContain("/app/passed-org-name/");
    expect(link).toContain("test-project-id");
  });

  test("span.link uses appUrl passed to initLogger when not logged in", () => {
    // beforeEach sets appUrl to default, clear it to test passed args
    const state = _exportsForTestingOnly.simulateLogoutForTests();
    state.appUrl = null;

    const logger = initLogger({
      projectId: "test-project-id",
      orgName: "test-org",
      appUrl: "https://custom.braintrust.dev",
    });
    const span = logger.startSpan({ name: "test-span" });
    span.end();

    const link = span.link();

    // Should use appUrl passed to initLogger
    expect(link).toContain("https://custom.braintrust.dev/app/test-org/");
  });

  test("span.link works with experiment id", async () => {
    // Mock the state for testing - must be done before creating the span
    const state = await _exportsForTestingOnly.simulateLoginForTests();
    // Verify the login was successful
    expect(state.orgName).toBeDefined();
    expect(state.appUrl).toBeDefined();

    // Create a test experiment
    const experiment = initExperiment("test-experiment");

    // Get a span within the experiment context
    const span = experiment.startSpan({
      name: "test-span",
    });

    span.end();

    const link = span.link();

    // Link should contain experiment ID
    expect(link).toEqual(
      "https://braintrust.dev/error-generating-link?msg=provide-experiment-id",
    );
  });

  test("permalink doesn't error if logged out", async () => {
    _exportsForTestingOnly.simulateLogoutForTests();

    const apiKey = process.env.BRAINTRUST_API_KEY;
    try {
      process.env.BRAINTRUST_API_KEY = "this-is-a-nonsense-api-key";
      // Get a span within the experiment context
      const logger = initLogger({
        projectName: "test-project",
      });
      const span = logger.startSpan({
        name: "test-span",
      });
      span.end();

      const link2 = await span.permalink();
      expect(link2).toBe(
        "https://braintrust.dev/error-generating-link?msg=http-error-401",
      );
    } finally {
      process.env.BRAINTRUST_API_KEY = apiKey;
    }
  });

  test("handles invalid slug format in permalink", async () => {
    const state = await _exportsForTestingOnly.simulateLoginForTests();
    const result = await permalink("invalid-slug", { state });
    expect(result).toContain("https://braintrust.dev/error-generating-link");
  });

  test("span.link handles missing experiment id", async () => {
    const _state = await _exportsForTestingOnly.simulateLoginForTests();
    const experiment = initExperiment("test-experiment");
    const span = experiment.startSpan({ name: "test-span" });
    span.end();
    // Force parentObjectId to be undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (span as any).parentObjectId = { getSync: () => ({ value: undefined }) };
    const link = span.link();
    expect(link).toBe(
      "https://braintrust.dev/error-generating-link?msg=provide-experiment-id",
    );
  });

  test("span.link handles missing project id and name", async () => {
    const _state = await _exportsForTestingOnly.simulateLoginForTests();
    const logger = initLogger({});
    const span = logger.startSpan({ name: "test-span" });
    span.end();
    // Force parentObjectId to be undefined and remove project metadata
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (span as any).parentObjectId = { getSync: () => ({ value: undefined }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (span as any).parentComputeObjectMetadataArgs = {};
    const link = span.link();
    expect(link).toBe(
      "https://braintrust.dev/error-generating-link?msg=provide-project-name-or-id",
    );
  });

  test("span.link handles playground logs", async () => {
    const _state = await _exportsForTestingOnly.simulateLoginForTests();
    const logger = initLogger({});
    const span = logger.startSpan({ name: "test-span" });
    span.end();
    // Force parentObjectType to be PLAYGROUND_LOGS
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (span as any).parentObjectType = SpanObjectTypeV3.PLAYGROUND_LOGS;
    const link = span.link();
    expect(link).toBe("https://braintrust.dev/noop-span");
  });
});

test("noop span permalink #BRA-1837", async () => {
  const span = NOOP_SPAN;
  const link1 = await span.permalink();
  expect(link1).toBe("https://braintrust.dev/noop-span");

  const slug = await span.export();
  expect(slug).toBe("");

  const link2 = await permalink(slug);
  expect(link2).toBe("https://braintrust.dev/noop-span");
});

test("disable logging", async () => {
  const state = new BraintrustState({});
  const bgLogger = state.bgLogger();

  let submittedItems = [];
  const submitLogsRequestSpy = vi
    // @ts-ignore
    .spyOn(bgLogger, "submitLogsRequest")
    // @ts-ignore
    .mockImplementation((items: string[]) => {
      submittedItems = items;
      return Promise.resolve();
    });

  bgLogger.log([
    new LazyValue(() =>
      Promise.resolve({
        id: "id",
        project_id: "p",
        log_id: "g",
        input: "bar",
        output: "foo",
        [IS_MERGE_FIELD]: false,
      }),
    ),
  ]);

  await bgLogger.flush();
  expect(submitLogsRequestSpy).toHaveBeenCalledTimes(1);
  expect(submittedItems.length).toEqual(1);

  submittedItems = [];
  state.disable();

  for (let i = 0; i < 10; i++) {
    bgLogger.log([
      new LazyValue(() =>
        Promise.resolve({
          id: "id",
          project_id: "p",
          log_id: "g",
          input: "bar" + i,
          output: "foo" + i,
          [IS_MERGE_FIELD]: false,
        }),
      ),
    ]);
  }
  await bgLogger.flush();
  expect(submitLogsRequestSpy).toHaveBeenCalledTimes(1);
  expect(submittedItems.length).toEqual(0);
});

describe("Dataset _internal_btql", () => {
  /** Create a mock state with controllable apiConn.post for testing BTQL queries. */
  function createMockStateWithApiConn() {
    const mockPost = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { id: "1", input: "test1", expected: "output1" },
            { id: "2", input: "test2", expected: "output2" },
          ],
          cursor: null,
        }),
    });
    const mockState = {
      apiConn: () => ({ post: mockPost }),
    } as unknown as BraintrustState;
    return { mockState, mockPost };
  }

  /** Create metadata for Dataset constructor (no API calls). */
  function createLazyMetadata() {
    return new LazyValue(async () => ({
      project: { id: "test-project", name: "test-project", fullInfo: {} },
      dataset: { id: "test-dataset", name: "test-dataset", fullInfo: {} },
    }));
  }

  test("_internal_btql limit is not overwritten by DEFAULT_FETCH_BATCH_SIZE", async () => {
    const customLimit = 50;
    const { mockState, mockPost } = createMockStateWithApiConn();

    const dataset = new Dataset(
      mockState,
      createLazyMetadata(),
      undefined,
      undefined,
      {
        limit: customLimit,
        where: { op: "eq", left: "foo", right: "bar" },
      },
    );

    // Consume the async iterator to trigger the BTQL request
    const records: unknown[] = [];
    for await (const record of dataset.fetch()) {
      records.push(record);
    }

    expect(mockPost).toHaveBeenCalledTimes(1);
    const callArgs = mockPost.mock.calls[0];
    const body = callArgs[1] as { query: Record<string, unknown> };
    const query = body.query;

    expect(query.limit).toBe(customLimit);
    expect(query.where).toEqual({ op: "eq", left: "foo", right: "bar" });
  });

  test("DEFAULT_FETCH_BATCH_SIZE used when _internal_btql has no limit", async () => {
    const { mockState, mockPost } = createMockStateWithApiConn();

    const dataset = new Dataset(
      mockState,
      createLazyMetadata(),
      undefined,
      undefined,
      {
        where: { op: "eq", left: "foo", right: "bar" },
      },
    );

    const records: unknown[] = [];
    for await (const record of dataset.fetch()) {
      records.push(record);
    }

    expect(mockPost).toHaveBeenCalledTimes(1);
    const body = mockPost.mock.calls[0][1] as {
      query: Record<string, unknown>;
    };
    expect(body.query.limit).toBe(DEFAULT_FETCH_BATCH_SIZE);
  });

  test("custom batchSize in fetch() overrides when _internal_btql has no limit", async () => {
    const { mockState, mockPost } = createMockStateWithApiConn();
    const customBatchSize = 200;

    const dataset = new Dataset(
      mockState,
      createLazyMetadata(),
      undefined,
      undefined,
    );

    const records: unknown[] = [];
    for await (const record of dataset.fetch({ batchSize: customBatchSize })) {
      records.push(record);
    }

    expect(mockPost).toHaveBeenCalledTimes(1);
    const body = mockPost.mock.calls[0][1] as {
      query: Record<string, unknown>;
    };
    expect(body.query.limit).toBe(customBatchSize);
  });

  test("_internal_btql limit wins over fetch batchSize", async () => {
    const btqlLimit = 1;
    const { mockState, mockPost } = createMockStateWithApiConn();

    const dataset = new Dataset(
      mockState,
      createLazyMetadata(),
      undefined,
      undefined,
      {
        limit: btqlLimit,
      },
    );

    const records: unknown[] = [];
    for await (const record of dataset.fetch({ batchSize: 500 })) {
      records.push(record);
    }

    expect(mockPost).toHaveBeenCalledTimes(1);
    const body = mockPost.mock.calls[0][1] as {
      query: Record<string, unknown>;
    };
    expect(body.query.limit).toBe(btqlLimit);
  });

  test("undefined _internal_btql does not break query", async () => {
    const { mockState, mockPost } = createMockStateWithApiConn();

    const dataset = new Dataset(
      mockState,
      createLazyMetadata(),
      undefined,
      undefined,
    );

    const records: unknown[] = [];
    for await (const record of dataset.fetch()) {
      records.push(record);
    }

    expect(mockPost).toHaveBeenCalledTimes(1);
    const body = mockPost.mock.calls[0][1] as {
      query: Record<string, unknown>;
    };
    expect(body.query.limit).toBe(DEFAULT_FETCH_BATCH_SIZE);
  });

  test("_internal_btql cursor is excluded so pagination cursor is not overwritten", async () => {
    const mockPost = vi.fn();
    mockPost
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: "1", input: "a", expected: "a" }],
            cursor: "page2-cursor",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: "2", input: "b", expected: "b" }],
            cursor: null,
          }),
      });
    const mockState = {
      apiConn: () => ({ post: mockPost }),
    } as unknown as BraintrustState;

    const dataset = new Dataset(
      mockState,
      createLazyMetadata(),
      undefined,
      undefined,
      {
        cursor: "stale-cursor-from-user",
        limit: 1,
      },
    );

    const records: unknown[] = [];
    for await (const record of dataset.fetch()) {
      records.push(record);
    }

    expect(mockPost).toHaveBeenCalledTimes(2);
    const firstCallQuery = (
      mockPost.mock.calls[0][1] as { query: Record<string, unknown> }
    ).query;
    const secondCallQuery = (
      mockPost.mock.calls[1][1] as { query: Record<string, unknown> }
    ).query;

    expect(firstCallQuery.cursor).toBeUndefined();
    expect(secondCallQuery.cursor).toBe("page2-cursor");
    expect(records).toHaveLength(2);
  });
});
