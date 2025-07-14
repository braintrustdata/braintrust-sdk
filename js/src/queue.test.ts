import { expect, test } from "vitest";
import { Queue, overrideMaxQueueSize } from "./queue";

test("Queue basic operations", () => {
  const queue = new Queue<number>(3);

  // Empty queue
  expect(queue.length()).toBe(0);
  expect(queue.peek()).toBe(undefined);
  expect(queue.drain()).toEqual([]);

  // Fill without overflow
  const dropped1 = queue.push(1, 2, 3);
  expect(dropped1).toEqual([]);
  expect(queue.length()).toBe(3);
  expect(queue.peek()).toBe(1);

  // Overflow behavior - drops new items
  const dropped2 = queue.push(4);
  expect(dropped2).toEqual([4]);
  expect(queue.length()).toBe(3);
  expect(queue.peek()).toBe(1);

  // Drain maintains original order
  const drained = queue.drain();
  expect(drained).toEqual([1, 2, 3]);
  expect(queue.length()).toBe(0);
  expect(queue.peek()).toBe(undefined);
});

test("Queue edge cases", () => {
  // Capacity 1
  const q1 = new Queue<number>(1);
  q1.push(1);
  const dropped = q1.push(2);
  expect(dropped).toEqual([2]);
  expect(q1.drain()).toEqual([1]);

  // Negative maxSize defaults to 5000
  const q2 = new Queue<number>(-1);
  const items = Array.from({ length: 100 }, (_, i) => i);
  const droppedItems = q2.push(...items);
  expect(droppedItems).toEqual([]);
  expect(q2.length()).toBe(100);
});

test("Queue clear operation", () => {
  const queue = new Queue<number>(5);
  queue.push(1, 2, 3);
  expect(queue.length()).toBe(3);

  queue.clear();
  expect(queue.length()).toBe(0);
  expect(queue.peek()).toBe(undefined);
  expect(queue.drain()).toEqual([]);
});

test("Queue responds to global max size override changes", () => {
  const queue = new Queue<number>(2);

  // Start with no override (uses instance maxSize)
  overrideMaxQueueSize(null);

  // Fill queue to capacity
  queue.push(1, 2);
  expect(queue.length()).toBe(2);

  // Should drop new item when at capacity
  const dropped1 = queue.push(3);
  expect(dropped1).toEqual([3]);
  expect(queue.length()).toBe(2);
  expect(queue.drain()).toEqual([1, 2]);

  // Switch to unlimited queue
  overrideMaxQueueSize(Infinity);

  // Fill queue again
  queue.push(4, 5);
  expect(queue.length()).toBe(2);

  // Should not drop items when unlimited
  const dropped2 = queue.push(6, 7, 8);
  expect(dropped2).toEqual([]);
  expect(queue.length()).toBe(5);
  expect(queue.drain()).toEqual([4, 5, 6, 7, 8]);

  // Switch to different size override
  overrideMaxQueueSize(3);

  // Fill queue to capacity
  queue.push(9, 10, 11);
  expect(queue.length()).toBe(3);

  // Should drop new item when exceeding override size
  const dropped3 = queue.push(12);
  expect(dropped3).toEqual([12]);
  expect(queue.length()).toBe(3);
  expect(queue.drain()).toEqual([9, 10, 11]);

  // Reset to default for other tests
  overrideMaxQueueSize(null);
});
