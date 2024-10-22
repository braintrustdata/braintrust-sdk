import { expect, test } from "vitest";
import {
  _exportsForTestingOnly,
  Attachment,
  initDataset,
  initExperiment,
  initLogger,
  NOOP_SPAN,
} from "./logger";
import { BackgroundLogEvent } from "@braintrust/core";
import { configureNode } from "./node";

configureNode();

const { extractAttachments, deepCopyEvent } = _exportsForTestingOnly;

test("extractAttachments no op", () => {
  const attachments: Attachment[] = [];

  extractAttachments({}, attachments);
  expect(attachments).toHaveLength(0);

  const event = { foo: "bar", baz: [1, 2, 3] };
  extractAttachments(event, attachments);
  expect(attachments).toHaveLength(0);
  // Same instance.
  expect(event.baz).toBe(event.baz);
  // Same content.
  expect(event).toEqual({ foo: "bar", baz: [1, 2, 3] });
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
  const event = {
    foo: "bar",
    baz: [1, 2],
    attachment1,
    nested: {
      attachment2,
      info: "another string",
      anArray: [attachment1, attachment2, attachment1],
    },
  };
  const savedNested = event.nested;

  const attachments: Attachment[] = [];
  extractAttachments(event, attachments);

  expect(attachments).toEqual([
    attachment1,
    attachment2,
    attachment1,
    attachment2,
    attachment1,
  ]);
  expect(attachments[0]).toBe(attachment1);
  expect(attachments[1]).toBe(attachment2);
  expect(attachments[2]).toBe(attachment1);
  expect(attachments[3]).toBe(attachment2);
  expect(attachments[4]).toBe(attachment1);

  expect(event.nested).toBe(savedNested);

  expect(event).toEqual({
    foo: "bar",
    baz: [1, 2],
    attachment1: attachment1.reference,
    nested: {
      attachment2: attachment2.reference,
      info: "another string",
      anArray: [
        attachment1.reference,
        attachment2.reference,
        attachment1.reference,
      ],
    },
  });
});

test("deepCopyEvent basic", () => {
  const original: Partial<BackgroundLogEvent> = {
    input: { foo: "bar" },
    output: [1, 2],
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

  const span = NOOP_SPAN;
  const logger = initLogger();
  const experiment = initExperiment({});
  const dataset = initDataset({});

  const original = {
    input: "Testing",
    output: {
      span,
      myIllegalObjects: [experiment, dataset, logger],
      attachment: attachment1,
      attachmentList: [attachment1, attachment2, "string"],
      nestedAttachment: {
        attachment: attachment2,
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
      attachment: attachment1,
      attachmentList: [attachment1, attachment2, "string"],
      nestedAttachment: {
        attachment: attachment2,
      },
      fake: {
        _bt_internal_saved_attachment: "not a number",
      },
    },
  });

  expect(copy).not.toBe(original);

  expect((copy.output as any).attachment).toBe(attachment1);
  expect((copy.output as any).nestedAttachment.attachment).toBe(attachment2);
  expect((copy.output as any).attachmentList[0]).toBe(attachment1);
  expect((copy.output as any).attachmentList[1]).toBe(attachment2);
});
