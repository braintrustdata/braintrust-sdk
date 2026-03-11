import type { CapturedLogEvent } from "./mock-braintrust-server";

function latestEventsPerSpan(events: CapturedLogEvent[]): CapturedLogEvent[] {
  const orderedSpanIds: string[] = [];
  const latestBySpanId = new Map<string, CapturedLogEvent>();
  const withoutSpanId: CapturedLogEvent[] = [];

  for (const event of events) {
    if (event.span.id) {
      if (!latestBySpanId.has(event.span.id)) {
        orderedSpanIds.push(event.span.id);
      }
      latestBySpanId.set(event.span.id, event);
      continue;
    }

    withoutSpanId.push(event);
  }

  return [
    ...orderedSpanIds.flatMap((spanId) => {
      const event = latestBySpanId.get(spanId);
      return event ? [event] : [];
    }),
    ...withoutSpanId,
  ];
}

function findLatestEvent(
  events: CapturedLogEvent[],
  predicate: (event: CapturedLogEvent) => boolean,
): CapturedLogEvent | undefined {
  return [...events].reverse().find(predicate);
}

export function findLatestSpan(
  events: CapturedLogEvent[],
  name: string,
): CapturedLogEvent | undefined {
  return findLatestEvent(events, (event) => event.span.name === name);
}

export function findAllSpans(
  events: CapturedLogEvent[],
  name: string,
): CapturedLogEvent[] {
  return latestEventsPerSpan(
    events.filter((event) => event.span.name === name),
  );
}

export function findChildSpans(
  events: CapturedLogEvent[],
  name: string,
  parentId: string | undefined,
): CapturedLogEvent[] {
  if (!parentId) {
    return [];
  }

  return latestEventsPerSpan(
    events.filter(
      (event) =>
        event.span.name === name && event.span.parentIds.includes(parentId),
    ),
  );
}

export function findLatestChildSpan(
  events: CapturedLogEvent[],
  name: string,
  parentId: string | undefined,
): CapturedLogEvent | undefined {
  if (!parentId) {
    return undefined;
  }

  return (
    findLatestEvent(
      events,
      (event) =>
        event.span.name === name &&
        event.span.parentIds.includes(parentId) &&
        event.output !== undefined,
    ) ??
    findLatestEvent(
      events,
      (event) =>
        event.span.name === name && event.span.parentIds.includes(parentId),
    )
  );
}
