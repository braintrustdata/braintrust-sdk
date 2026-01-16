import type { Payload } from "@temporalio/common";

export const BRAINTRUST_SPAN_HEADER = "_braintrust-span";
export const BRAINTRUST_WORKFLOW_SPAN_HEADER = "_braintrust-workflow-span";
export const BRAINTRUST_WORKFLOW_SPAN_ID_HEADER =
  "_braintrust-workflow-span-id";

export function serializeHeaderValue(value: string): Payload {
  return {
    metadata: {
      encoding: new TextEncoder().encode("json/plain"),
    },
    data: new TextEncoder().encode(JSON.stringify(value)),
  };
}

export function deserializeHeaderValue(
  payload: Payload | undefined,
): string | undefined {
  if (!payload?.data) {
    return undefined;
  }
  try {
    const decoded = new TextDecoder().decode(payload.data);
    return JSON.parse(decoded);
  } catch {
    return undefined;
  }
}
