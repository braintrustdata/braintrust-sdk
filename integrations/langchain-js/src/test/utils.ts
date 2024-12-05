import { mergeDicts } from "@braintrust/core";
import { bypass, HttpResponse, JsonBodyType } from "msw";
import { TransformStream } from "stream/web";
import { LogsRequest } from "./types";

const decoder = new TextDecoder();
// comment out process.env overriding in setup.ts for this to be helpful
export const bypassAndLog = async (request: Request): Promise<Response> => {
  console.log(request.method, request.url);
  const res = await fetch(bypass(request));

  // If it's not a stream, handle as before
  if (!res.body || !res.headers.get("content-type")?.includes("stream")) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const json = (await res.json()) as JsonBodyType;
    console.log(JSON.stringify(json, null, 2));
    return HttpResponse.json(json);
  }

  const spy = new TransformStream({
    transform(chunk, controller) {
      console.log(decoder.decode(chunk));
      controller.enqueue(chunk);
    },
  });

  return new Response(res.body.pipeThrough(spy), {
    headers: res.headers,
    status: res.status,
    statusText: res.statusText,
  });
};

export const logsToSpans = (logs: LogsRequest[]) => {
  // Logs include partial updates (merges) for previous rows.
  // We need to dedupe these and merge them. So we can see the final state like
  // we do in the UI.

  const seenIds = new Set<string>();
  const spans = logs
    .flatMap((log) => log.rows)
    .reduce(
      (acc, row) => {
        if (!seenIds.has(row.span_id)) {
          seenIds.add(row.span_id);
          acc.push(row);
        } else {
          const existingSpan = acc.find((span) => span.span_id === row.span_id);
          if (existingSpan) {
            mergeDicts(existingSpan, row);
          }
        }
        return acc;
      },
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      [] as LogsRequest["rows"],
    );

  return {
    spans,
    root_span_id: spans[0].span_id,
    root_run_id: spans[0].metadata?.runId,
  };
};
