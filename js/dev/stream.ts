export interface RawSSEEvent {
  id?: string;
  event?: string;
  data: string;
}

export function serializeSSEEvent(event: RawSSEEvent): string {
  return (
    Object.entries(event)
      .filter(([_key, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n") + "\n\n"
  );
}
