export class Queue<T> {
  private items: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(...items: T[]): T[] {
    if (this.maxSize < 1) {
      this.items.push(...items);
      return [];
    }

    // Add all new items to the queue
    this.items.push(...items);
    
    // If we exceed maxSize, drop oldest items
    if (this.items.length > this.maxSize) {
      const numToDrop = this.items.length - this.maxSize;
      const dropped = this.items.splice(0, numToDrop);
      return dropped;
    }
    
    return [];
  }

  drain(): T[] {
    const items = this.items;
    this.items = [];
    return items;
  }

  length(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}