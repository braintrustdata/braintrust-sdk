export const DEFAULT_QUEUE_SIZE = 15000;

// Global flag to enable/disable queue size limits - false means unlimited (default)
// When customers are doing experiments (e.g. npx braintrust eval) we don't want to drop
// any data, and aren't really at risk of OOM'ing "real customers" processes. If customers
// are using initLogger (aka observing production data) we enforce queue limits to ensure we
// never OOM.
let _useQueueSizeLimit = false;

/**
 * Enable or disable queue size limits globally for all queue instances.
 * @param enabled - true to use instance maxSize limits, false for unlimited queues (default).
 */
export function setQueueSizeLimitEnabled(enabled: boolean) {
  console.log("setQueueSizeLimitEnabled", enabled);
  _useQueueSizeLimit = enabled;
}

// A simple queue that drops oldest items when full. Uses a plain array
// that can grow for unlimited queues or drops oldest items for bounded queues.
export class Queue<T> {
  private items: Array<T> = [];
  private maxSize: number;

  constructor(maxSize: number) {
    if (maxSize < 1) {
      console.warn(
        `maxSize ${maxSize} is <1, using default ${DEFAULT_QUEUE_SIZE}`,
      );
      maxSize = DEFAULT_QUEUE_SIZE;
    }

    this.maxSize = maxSize;
  }

  push(...items: T[]): T[] {
    const dropped: T[] = [];

    for (const item of items) {
      if (!_useQueueSizeLimit) {
        // For unlimited queues (default), just add items without dropping
        this.items.push(item);
      } else {
        // For bounded queues, drop new items when full
        if (this.items.length >= this.maxSize) {
          dropped.push(item);
        } else {
          this.items.push(item);
        }
      }
    }

    return dropped;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  drain(): T[] {
    const items = [...this.items];
    this.items = [];
    return items;
  }

  clear(): void {
    this.items = [];
  }

  length(): number {
    return this.items.length;
  }

  get capacity(): number {
    return this.maxSize;
  }
}
