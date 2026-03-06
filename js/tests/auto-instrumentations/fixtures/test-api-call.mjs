import Anthropic from "@anthropic-ai/sdk";

const mockFetch = async () => ({
  ok: true,
  status: 200,
  headers: new Headers({ "content-type": "application/json" }),
  json: async () => ({
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Test" }],
    model: "claude-3-sonnet-20240229",
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
  }),
});

const client = new Anthropic({
  apiKey: "test-key",
  fetch: mockFetch,
});

try {
  const message = await client.messages.create({
    model: "claude-3-sonnet-20240229",
    max_tokens: 10,
    messages: [{ role: "user", content: "Hi" }],
  });
  console.log("SUCCESS: API call completed");
  console.log("Result:", JSON.stringify(message, null, 2));
} catch (error) {
  console.error("ERROR:", error.message);
  process.exit(1);
}
