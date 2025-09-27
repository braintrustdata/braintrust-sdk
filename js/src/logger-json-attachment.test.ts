import { JSONAttachment } from "./logger";
import { describe, expect, it } from "vitest";

describe("JSONAttachment", () => {
  it("should create an attachment from JSON data", async () => {
    const testData = {
      foo: "bar",
      nested: {
        array: [1, 2, 3],
        bool: true,
      },
    };

    const attachment = new JSONAttachment(testData);

    expect(attachment.reference.type).toBe("braintrust_attachment");
    expect(attachment.reference.filename).toBe("data.json");
    expect(attachment.reference.content_type).toBe("application/json");
    expect(attachment.reference.key).toBeDefined();

    // Verify the data can be retrieved
    const blob = await attachment.data();
    const text = await blob.text();
    const parsed = JSON.parse(text);
    expect(parsed).toEqual(testData);
  });

  it("should handle custom filename", () => {
    const attachment = new JSONAttachment(
      { test: "data" },
      { filename: "custom.json" },
    );

    expect(attachment.reference.filename).toBe("custom.json");
  });

  it("should pretty print when requested", async () => {
    const testData = { a: 1, b: 2 };
    const attachment = new JSONAttachment(testData, { pretty: true });

    const blob = await attachment.data();
    const text = await blob.text();
    expect(text).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it("should handle large transcript scenario", () => {
    const largeTranscript = Array.from({ length: 1000 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
      timestamp: Date.now() + i,
    }));

    const attachment = new JSONAttachment(largeTranscript, {
      filename: "transcript.json",
    });

    expect(attachment.reference.filename).toBe("transcript.json");
    expect(attachment.reference.content_type).toBe("application/json");
  });

  it("should handle arrays and primitives", async () => {
    const arrayData = [1, 2, 3, 4, 5];
    const attachment = new JSONAttachment(arrayData);

    const blob = await attachment.data();
    const text = await blob.text();
    expect(JSON.parse(text)).toEqual(arrayData);
  });

  it("should integrate with logger patterns", () => {
    // Example of the intended usage pattern
    const logData = {
      input: {
        type: "nameOfPrompt",
        transcript: new JSONAttachment([
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ]),
        configValue1: 123,
        configValue2: true,
      },
      output: [{ type: "text", value: "Generated response" }],
      metadata: {
        sessionId: "123",
        userId: "456",
        renderedPrompt: new JSONAttachment(
          "This is a very long prompt template...",
          { filename: "prompt.json" },
        ),
      },
    };

    // Verify the structure contains JSONAttachment instances
    expect(logData.input.transcript).toBeInstanceOf(JSONAttachment);
    expect(logData.metadata.renderedPrompt).toBeInstanceOf(JSONAttachment);
  });
});
