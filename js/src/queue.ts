export const DEFAULT_QUEUE_SIZE = 15000;

// A simple queue that drops oldest items when full. Uses a plain array
// that can grow for unlimited queues or drops oldest items for bounded queues.
export class Queue<T> {
  private items: Array<T> = [];
  private maxSize: number;
  private enforceSizeLimit = false;

  constructor(maxSize: number) {
    if (maxSize < 1) {
      console.warn(
        `maxSize ${maxSize} is <1, using default ${DEFAULT_QUEUE_SIZE}`,
      );
      maxSize = DEFAULT_QUEUE_SIZE;
    }

    this.maxSize = maxSize;
  }

  /**
   * Set queue size limit enforcement. When enabled, the queue will drop new items
   * when it reaches maxSize. When disabled (default), the queue can grow unlimited.
   */
  enforceQueueSizeLimit(enforce: boolean) {
    this.enforceSizeLimit = enforce;
  }

  push(...items: T[]): T[] {
    const dropped: T[] = [];

    for (const item of items) {
      if (!this.enforceSizeLimit) {
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
