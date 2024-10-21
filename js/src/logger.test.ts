import { expect, test } from "vitest";
import { _exportsForTestingOnly } from "./logger";

const { extractAttachments, deepCopyEvent } = _exportsForTestingOnly;

test("extractAttachments", () => {
  // TODO: replace test.
  extractAttachments({}, []);
  expect(true).toBe(true);
});

test("deepCopyEvent", () => {
  deepCopyEvent({});
  expect(true).toBe(false);
});
