/**
 * Assertion helpers for smoke tests
 * These are simple assertion functions that work across all environments
 */

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

/**
 * Assert that a condition is true
 */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}

/**
 * Assert that two values are equal
 */
export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new AssertionError(
      message ||
        `Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`,
    );
  }
}

/**
 * Assert that an array has a specific length
 */
export function assertLength(
  array: unknown[],
  expectedLength: number,
  message?: string,
): void {
  if (array.length !== expectedLength) {
    throw new AssertionError(
      message ||
        `Expected array length ${expectedLength}, but got ${array.length}`,
    );
  }
}

/**
 * Assert that an array is not empty
 */
export function assertNotEmpty(array: unknown[], message?: string): void {
  if (array.length === 0) {
    throw new AssertionError(message || "Expected non-empty array");
  }
}

/**
 * Assert that a span event contains expected fields
 */
export function assertSpanEvent(
  event: Record<string, unknown>,
  expectedFields: Record<string, unknown>,
): void {
  for (const [key, expectedValue] of Object.entries(expectedFields)) {
    const actualValue = event[key];
    if (actualValue !== expectedValue) {
      throw new AssertionError(
        `Expected event.${key} to be ${JSON.stringify(expectedValue)}, but got ${JSON.stringify(actualValue)}`,
      );
    }
  }
}

/**
 * Assert that events array contains at least one span with expected fields
 */
export function assertSpanCaptured(
  events: unknown[],
  expectedFields: Record<string, unknown>,
  message?: string,
): void {
  assertNotEmpty(events, message || "No events were captured");

  const event = events[0] as Record<string, unknown>;
  assertSpanEvent(event, expectedFields);
}

/**
 * Assert that a value is defined (not null or undefined)
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new AssertionError(message || "Expected value to be defined");
  }
}

/**
 * Assert that a value is a specific type
 */
export function assertType(
  value: unknown,
  expectedType: string,
  message?: string,
): void {
  const actualType = typeof value;
  if (actualType !== expectedType) {
    throw new AssertionError(
      message || `Expected type ${expectedType}, but got ${actualType}`,
    );
  }
}

/**
 * Assert that an object has a specific property
 */
export function assertHasProperty(
  obj: Record<string, unknown>,
  property: string,
  message?: string,
): void {
  if (!(property in obj)) {
    throw new AssertionError(
      message || `Expected object to have property "${property}"`,
    );
  }
}
