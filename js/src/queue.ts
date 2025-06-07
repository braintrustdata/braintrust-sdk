// A simple queue that drops oldest items when full. It uses a circular
// buffer to store items so that dropping oldest things in the queue
// is O(1) time.
export class Queue<T> {
  private buffer: Array<T | undefined>;
  private head: number = 0; // the index of the first item in the queue
  private tail: number = 0; // the index of the next item to be added
  private size: number = 0; // the number of items in the queue
  private capacity: number; // the maximum number of items the queue can hold

  constructor(maxSize: number) {
    if (maxSize < 1) {
      console.warn(
        `Queue maxSize ${maxSize} is invalid, using default size 5000`,
      );
      maxSize = 5000;
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

    // FIXME[matt] we could short circuit if the buffer is full
    // and just return buffer and create a new one.

    let current = this.head;
    while (this.size > 0) {
      const item = this.buffer[current];
      if (item !== undefined) {
        items.push(item);
      }
      this.buffer[current] = undefined;
      current = (current + 1) % this.capacity;
      this.size--;
    }

    this.head = 0;
    this.tail = 0;

    return items;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  length(): number {
    return this.size;
  }
}
