import { expect, test } from "vitest";
import { startSpan, NOOP_SPAN, permalink } from "./logger";
import { configureNode } from "./node";

// Configure for Node environment
configureNode();

test("test permalink with noop spans #BRA-1837", async () => {
  // verify noop spans work with permalink
  const span = await startSpan({ name: "test-span" });
  span.end();
  expect(span).toBe(NOOP_SPAN);
  const slug = await span.export();
  expect(slug).toEqual("");
  const p = await permalink(slug, {
    orgName: "matt-org",
    appUrl: "https://app.testjs.dev",
  });
  expect(p).toContain("matt-org");
  expect(p).toContain("https://app.testjs.dev");
  expect(p).toContain("noop-span");
});
