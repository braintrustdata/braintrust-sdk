/**
 * @deprecated This wrapper has been removed. The function now returns the agent unchanged.
 */
export function wrapMastraAgent<T>(
  agent: T,
  _options?: { name?: string; span_name?: string },
): T {
  return agent;
}
