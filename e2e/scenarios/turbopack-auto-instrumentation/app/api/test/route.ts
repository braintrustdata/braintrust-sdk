import OpenAI from "openai";
import { tracingChannel } from "node:diagnostics_channel";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Must be dynamic — this route starts an in-process HTTP server per request.
export const dynamic = "force-dynamic";

export async function GET() {
  // Spin up a minimal mock OpenAI server so no real API calls are made.
  // The tracing channel `start` event fires synchronously before any HTTP
  // request, so this also handles the APIPromise.then() compatibility issue
  // by giving the promise a real response to resolve with.
  const mockServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        model: "gpt-4o-mini",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
  });

  await new Promise<void>((resolve) =>
    mockServer.listen(0, "127.0.0.1", resolve),
  );
  const { port } = mockServer.address() as AddressInfo;

  const channel = tracingChannel("orchestrion:openai:chat.completions.create");
  let channelFired = false;
  const subscriber = {
    start: () => {
      channelFired = true;
    },
    end: () => {},
    asyncStart: () => {},
    asyncEnd: () => {},
    error: () => {},
  };

  channel.subscribe(subscriber);

  try {
    const client = new OpenAI({
      baseURL: `http://127.0.0.1:${port}/v1`,
      apiKey: "test",
      maxRetries: 0,
    });
    await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });
  } catch {
    // The start event fires before any network I/O so channelFired is already
    // set even if tracePromise throws due to APIPromise compatibility.
  } finally {
    channel.unsubscribe(subscriber);
    mockServer.close();
  }

  return Response.json({ instrumented: channelFired });
}
