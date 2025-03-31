import { expect, test } from "vitest";
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
} from "./logger";
import { BackgroundLogEvent } from "@braintrust/core";
import { configureNode } from "./node";

configureNode();

const { extractAttachments, deepCopyEvent } = _exportsForTestingOnly;

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
