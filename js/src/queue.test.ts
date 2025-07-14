import { expect, test } from "vitest";
import { Queue, setQueueSizeLimitEnabled } from "./queue";

test("Queue basic operations", () => {
  const queue = new Queue<number>(3);

  // Enable size limit for this test
  setQueueSizeLimitEnabled(true);

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

  // Reset to default for other tests
  setQueueSizeLimitEnabled(false);
});

test("Queue edge cases", () => {
  // Enable size limit for this test
  setQueueSizeLimitEnabled(true);

  // Capacity 1
  const q1 = new Queue<number>(1);
  q1.push(1);
  const dropped = q1.push(2);
  expect(dropped).toEqual([2]);
  expect(q1.drain()).toEqual([1]);

  // Negative maxSize defaults to 15000
  const q2 = new Queue<number>(-1);
  const items = Array.from({ length: 100 }, (_, i) => i);
  const droppedItems = q2.push(...items);
  expect(droppedItems).toEqual([]);
  expect(q2.length()).toBe(100);

  // Reset to default for other tests
  setQueueSizeLimitEnabled(false);
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

test("Queue responds to global size limit enable/disable", () => {
  const queue = new Queue<number>(2);

  // Start with unlimited (default behavior)
  setQueueSizeLimitEnabled(false);

  // Fill queue beyond capacity
  queue.push(1, 2, 3, 4, 5);
  expect(queue.length()).toBe(5);

  // Should not drop items when unlimited
  const dropped1 = queue.push(6, 7, 8);
  expect(dropped1).toEqual([]);
  expect(queue.length()).toBe(8);
  expect(queue.drain()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

  // Enable size limit
  setQueueSizeLimitEnabled(true);

  // Fill queue to capacity
  queue.push(9, 10);
  expect(queue.length()).toBe(2);

  // Should drop new item when at capacity
  const dropped2 = queue.push(11);
  expect(dropped2).toEqual([11]);
  expect(queue.length()).toBe(2);
  expect(queue.drain()).toEqual([9, 10]);

  // Disable size limit again
  setQueueSizeLimitEnabled(false);

  // Should allow unlimited again
  const dropped3 = queue.push(12, 13, 14);
  expect(dropped3).toEqual([]);
  expect(queue.length()).toBe(3);
  expect(queue.drain()).toEqual([12, 13, 14]);

  // Reset to default for other tests
  setQueueSizeLimitEnabled(false);
});
