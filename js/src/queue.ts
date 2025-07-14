export const DEFAULT_QUEUE_SIZE = 15000;

// Global flag to control queue size based on init() vs initLogger()
let _useUnlimitedQueue = false;

export function _setUseUnlimitedQueue(unlimited: boolean) {
  _useUnlimitedQueue = unlimited;
}

// A simple queue that drops oldest items when full. Uses a plain array
// that can grow for unlimited queues or drops oldest items for bounded queues.
export class Queue<T> {
  private items: Array<T> = [];
  private maxSize: number;
  private unlimited: boolean;

  constructor(maxSize: number) {
    if (maxSize < 1) {
      console.warn(
        `maxSize ${maxSize} is <1, using default ${DEFAULT_QUEUE_SIZE}`,
      );
      maxSize = DEFAULT_QUEUE_SIZE;
    }

    // Check global flag to use unlimited queue for init() calls
    this.unlimited = _useUnlimitedQueue;
    this.maxSize = this.unlimited ? Infinity : maxSize;
  }

  push(...items: T[]): T[] {
    const dropped: T[] = [];

    for (const item of items) {
      if (this.unlimited) {
        // For unlimited queues, just add items without dropping
        this.items.push(item);
      } else {
        // For bounded queues, drop oldest items when full
        if (this.items.length >= this.maxSize) {
          const droppedItem = this.items.shift();
          if (droppedItem !== undefined) {
            dropped.push(droppedItem);
          }
        }
        this.items.push(item);
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
