export const DEFAULT_QUEUE_SIZE = 5000;

// A simple queue that drops oldest items when full. It uses a circular
// buffer to store items so that dropping oldest things in the queue
// is O(1) time.
export class Queue<T> {
  private buffer: Array<T>;
  private head: number = 0; // the index of the first item in the queue
  private tail: number = 0; // the index of the next item to be added
  private size: number = 0; // the number of items in the queue
  private capacity: number; // the maximum number of items the queue can hold
  public dropped: number = 0; // the total number of items dropped

  constructor(maxSize: number) {
    if (maxSize < 1) {
      console.warn(
        `maxSize ${maxSize} is <1, using default ${DEFAULT_QUEUE_SIZE}`,
      );
      maxSize = DEFAULT_QUEUE_SIZE;
    }
    this.capacity = maxSize;
    this.buffer = new Array(this.capacity);
  }

  push(...items: T[]): T[] {
    const dropped: T[] = [];

    for (const item of items) {
      if (this.size === this.capacity) {
        const droppedItem = this.buffer[this.head];
        if (droppedItem !== undefined) {
          dropped.push(droppedItem);
          this.dropped++;
        }
        this.head = (this.head + 1) % this.capacity;
      } else {
        this.size++;
      }

      this.buffer[this.tail] = item;
      this.tail = (this.tail + 1) % this.capacity;
    }

    return dropped;
  }

  peek(): T | undefined {
    if (this.size === 0) {
      return undefined;
    }
    return this.buffer[this.head];
  }

  drain(): T[] {
    const items: T[] = [];
    if (this.size === 0) {
      return items;
    }

    if (this.head < this.tail) {
      items.push(...this.buffer.slice(this.head, this.tail));
      this.buffer.fill(undefined as T, this.head, this.tail);
    } else {
      items.push(...this.buffer.slice(this.head));
      items.push(...this.buffer.slice(0, this.tail));
      this.buffer.fill(undefined as T, this.head, this.capacity);
      this.buffer.fill(undefined as T, 0, this.tail);
    }

    this.head = 0;
    this.tail = 0;
    this.size = 0;
    return items;
  }

  clear(): void {
    this.buffer.fill(undefined as T);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  length(): number {
    return this.size;
  }
}
