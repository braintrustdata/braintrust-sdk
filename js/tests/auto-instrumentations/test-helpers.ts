/**
 * Test helpers for functional testing of instrumented code.
 */

import * as diagnostics_channel from "diagnostics_channel";

// Use type assertion for tracingChannel which may not be in older @types/node
const tracingChannel = (diagnostics_channel as any).tracingChannel as (
  name: string,
) => any;

export interface CapturedEvent {
  arguments?: any[];
  self?: any;
  result?: any;
  error?: any;
  timestamp: number;
}

export interface EventCollector {
  start: CapturedEvent[];
  end: CapturedEvent[];
  asyncStart: CapturedEvent[];
  asyncEnd: CapturedEvent[];
  error: CapturedEvent[];
  clear: () => void;
  subscribe: (channelName: string) => void;
  unsubscribe: () => void;
}

/**
 * Creates an event collector for capturing diagnostics_channel events.
 */
export function createEventCollector(): EventCollector {
  const collector: EventCollector = {
    start: [],
    end: [],
    asyncStart: [],
    asyncEnd: [],
    error: [],
    clear() {
      this.start = [];
      this.end = [];
      this.asyncStart = [];
      this.asyncEnd = [];
      this.error = [];
    },
    subscribe(channelName: string) {
      const channel = tracingChannel(channelName);
      channel.subscribe({
        start: (ctx: any) => {
          this.start.push({
            arguments: ctx.arguments ? Array.from(ctx.arguments) : undefined,
            self: ctx.self,
            timestamp: Date.now(),
          });
        },
        end: (ctx: any) => {
          this.end.push({
            result: ctx.result,
            timestamp: Date.now(),
          });
        },
        asyncStart: (ctx: any) => {
          this.asyncStart.push({
            timestamp: Date.now(),
          });
        },
        asyncEnd: (ctx: any) => {
          this.asyncEnd.push({
            result: ctx.result,
            timestamp: Date.now(),
          });
        },
        error: (ctx: any) => {
          this.error.push({
            error: ctx.error,
            timestamp: Date.now(),
          });
        },
      });
    },
    unsubscribe() {
      // Note: diagnostics_channel doesn't provide a direct unsubscribe API
      // In a real scenario, you'd store the channel reference and manage subscriptions
    },
  };

  return collector;
}

/**
 * Helper to run a function and wait for all events to be emitted.
 */
export async function runAndCollectEvents<T>(
  fn: () => T | Promise<T>,
  collector: EventCollector,
): Promise<T> {
  const result = await fn();
  // Give event handlers a chance to run
  await new Promise((resolve) => setImmediate(resolve));
  return result;
}
