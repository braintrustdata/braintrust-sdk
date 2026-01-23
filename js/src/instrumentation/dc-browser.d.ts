/**
 * Type declarations for dc-browser package.
 */

declare module "dc-browser" {
  export interface ChannelHandlers<TInput = unknown, TResult = unknown> {
    start?: (context: StartContext<TInput>) => void;
    end?: (context: EndContext<TResult>) => void;
    asyncStart?: (context: StartContext<TInput>) => void;
    asyncEnd?: (context: EndContext<TResult>) => void;
    error?: (context: ErrorContext) => void;
  }

  export interface StartContext<TInput = unknown> {
    arguments: TInput[];
    [key: string]: unknown;
  }

  export interface EndContext<TResult = unknown> {
    result: TResult;
    arguments?: unknown[];
    [key: string]: unknown;
  }

  export interface ErrorContext {
    error: Error;
    arguments?: unknown[];
    [key: string]: unknown;
  }

  export class TracingChannel {
    constructor(name: string);
    readonly name: string;

    subscribe(handlers: ChannelHandlers): void;
    unsubscribe(handlers: ChannelHandlers): void;

    traceSync<T>(fn: () => T, context?: StartContext): T;
    tracePromise<T>(fn: () => Promise<T>, context?: StartContext): Promise<T>;
    traceCallback<T>(
      fn: (callback: (error: Error | null, result?: T) => void) => void,
      position: number,
      context: StartContext,
      callback: (error: Error | null, result?: T) => void,
    ): void;
  }

  export function tracingChannel(name: string): TracingChannel;
  export function subscribe(
    name: string,
    handler: (message: unknown) => void,
  ): void;
  export function unsubscribe(
    name: string,
    handler: (message: unknown) => void,
  ): void;
}
