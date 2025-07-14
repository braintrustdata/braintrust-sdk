export const DEFAULT_QUEUE_SIZE = 15000;

// Global override for queue size - null means use instance maxSize
let _overrideMaxQueueSize: number | null = null;

/**
 * Override the maximum queue size globally for all queue instances.
 * @param size - The new maximum size, or null to use each instance's original maxSize.
 *               Use Infinity for unlimited queues.
 */
export function overrideMaxQueueSize(size: number | null) {
  _overrideMaxQueueSize = size;
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

    // Use override size if set, otherwise use instance maxSize
    const maxSize = _overrideMaxQueueSize ?? this.maxSize;

    for (const item of items) {
      if (maxSize === Infinity) {
        // For unlimited queues, just add items without dropping
        this.items.push(item);
      } else {
        // For bounded queues, drop new items when full
        if (this.items.length >= maxSize) {
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
