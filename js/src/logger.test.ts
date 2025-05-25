/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";
import {
  _exportsForTestingOnly,
  init,
  BaseAttachment,
  Attachment,
  ExternalAttachment,
  initDataset,
  initExperiment,
  initLogger,
  NOOP_SPAN,
  Prompt,
  permalink,
  BraintrustState,
} from "./logger";
import { SpanObjectTypeV3 } from "@braintrust/core";
import { LazyValue } from "./util";
import { BackgroundLogEvent, IS_MERGE_FIELD } from "@braintrust/core";
import { configureNode } from "./node";

configureNode();

const { extractAttachments, deepCopyEvent } = _exportsForTestingOnly;

test("verify MemoryBackgroundLogger intercepts logs", async () => {
  // Log to memory for the tests.
  _exportsForTestingOnly.simulateLoginForTests();

  const memoryLogger = _exportsForTestingOnly.useTestBackgroundLogger();

  const logger = initLogger({
    projectName: "test",
    projectId: "test-project-id",
  });

  await memoryLogger.flush();
  expect(await memoryLogger.drain()).length(0);

  // make some spans
  const span = logger.startSpan({ name: "test-name-a" });
  span.log({ metrics: { v: 1 } });
  span.end();

  const span2 = logger.startSpan({ name: "test-name-b" });
  span2.log({ metrics: { v: 2 } });
  span2.end();

  await memoryLogger.flush();

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  const events = (await memoryLogger.drain()) as any[]; // FIXME[matt] what type should this be?
  expect(events).toHaveLength(2);

  events.sort((a, b) => a["metrics"]["v"] - b["metrics"]["v"]);

  // just check a couple of things, we're mostly looking to make sure the
  expect(events[0]["span_attributes"]["name"]).toEqual("test-name-a");
  expect(events[1]["span_attributes"]["name"]).toEqual("test-name-b");

  // and now it's empty
  expect(await memoryLogger.drain()).length(0);

  _exportsForTestingOnly.clearTestBackgroundLogger(); // can go back to normal
});

test("init validation", () => {
  expect(() => init({})).toThrow(
    "Must specify at least one of project or projectId",
  );
  expect(() => init({ project: "project", open: true, update: true })).toThrow(
    "Cannot open and update an experiment at the same time",
  );
  expect(() => init({ project: "project", open: true })).toThrow(
    "Cannot open an experiment without specifying its name",
  );
});

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

test("deepCopyEvent with attachments", () => {
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

test("noop span permalink #BRA-1837", async () => {
  const span = NOOP_SPAN;
  const link1 = await span.permalink();
  expect(link1).toBe("https://braintrust.dev/noop-span");

  const slug = await span.export();
  expect(slug).toBe("");

  const link2 = await permalink(slug);
  expect(link2).toBe("https://braintrust.dev/noop-span");
});

test("prompt.build with structured output templating", () => {
  const prompt = new Prompt<false, false>(
    {
      name: "Calculator",
      slug: "calculator",
      project_id: "p",
      prompt_data: {
        prompt: {
          type: "chat",
          messages: [
            {
              role: "system",
              content:
                "Please compute {{input.expression}} and return the result in JSON.",
            },
          ],
        },
        options: {
          model: "gpt-4o",
          params: {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "schema",
                schema: "{{input.schema}}",
                strict: true,
              },
            },
          },
        },
      },
    },
    {},
    false,
  );

  const result = prompt.build({
    input: {
      expression: "2 + 3",
      schema: {
        type: "object",
        properties: {
          final_answer: {
            type: "string",
          },
        },
        required: ["final_answer"],
        additionalProperties: false,
      },
    },
  });
  expect(result).toMatchObject({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "Please compute 2 + 3 and return the result in JSON.",
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "schema",
        schema: {
          type: "object",
          properties: {
            final_answer: { type: "string" },
          },
        },
      },
    },
  });
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

test("simulateLoginForTests and simulateLogoutForTests", async () => {
  for (let i = 0; i < 6; i++) {
    // First login
    const state = await _exportsForTestingOnly.simulateLoginForTests();
    // Verify the login state - now we're logged in
    expect(state.loggedIn).toBe(true);
    expect(state.loginToken).toBe("___TEST_API_KEY__THIS_IS_NOT_REAL___");
    expect(state.orgId).toBe("test-org-id");
    expect(state.orgName).toBe("test-org-name");
    expect(state.apiUrl).toBe("https://braintrust.dev/fake-api-url");

    // Now logout
    const logoutState = _exportsForTestingOnly.simulateLogoutForTests();

    // Verify the logout state - everything should be null or false
    expect(logoutState.loggedIn).toBe(false);
    expect(logoutState.loginToken).toBe(null);
    expect(logoutState.orgId).toBe(null);
    expect(logoutState.orgName).toBe(null);
    expect(logoutState.apiUrl).toBe(null);
    expect(logoutState.appUrl).toBe("https://www.braintrust.dev");
  }
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

test("span.export handles unauthenticated state", async () => {
  // Create a span without logging in
  const logger = initLogger({});
  const span = logger.startSpan({ name: "test-span" });
  span.end();

  // Export should still work and return a valid string
  let exported: string | undefined = undefined;
  let error;
  try {
    exported = await span.export();
  } catch (e) {
    error = e;
  }
  expect(error).toBeUndefined();
  expect(exported).toBeDefined();
  expect(typeof exported).toBe("string");
  expect((exported as string).length).toBeGreaterThan(0);
});

test("span.export handles unresolved parent object ID", async () => {
  // Create a span with a parent object ID that hasn't been resolved
  const logger = initLogger({});
  const span = logger.startSpan({
    name: "test-span",
    event: {
      metadata: {
        project_id: "test-project-id",
      },
    },
  });
  span.end();

  // Export should still work and return a valid string
  let exported: string | undefined = undefined;
  let error;
  try {
    exported = await span.export();
  } catch (e) {
    error = e;
  }
  expect(error).toBeUndefined();
  expect(exported).toBeDefined();
  expect(typeof exported).toBe("string");
  expect((exported as string).length).toBeGreaterThan(0);
});
