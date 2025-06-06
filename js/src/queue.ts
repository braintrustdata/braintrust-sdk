export class Deque<T> {
  private buffer: Array<T | undefined>;
  private head: number = 0;
  private tail: number = 0;
  private size: number = 0;
  private capacity: number;

  constructor(maxSize: number) {
    this.capacity = maxSize < 1 ? 5000 : maxSize;
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

    let current = this.head;
    while (current !== this.tail) {
      const item = this.buffer[current];
      if (item !== undefined) {
        items.push(item);
      }
      this.buffer[current] = undefined;
      current = (current + 1) % this.capacity;
    }

    this.head = 0;
    this.tail = 0;
    this.size = 0;

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
