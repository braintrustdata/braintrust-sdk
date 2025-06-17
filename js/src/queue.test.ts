import { expect, test } from "vitest";
import { Queue } from "./queue";

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

  // Overflow behavior - drops oldest
  const dropped2 = queue.push(4);
  expect(dropped2).toEqual([1]);
  expect(queue.length()).toBe(3);
  expect(queue.peek()).toBe(2);

  // Drain maintains FIFO order
  const drained = queue.drain();
  expect(drained).toEqual([2, 3, 4]);
  expect(queue.length()).toBe(0);
  expect(queue.peek()).toBe(undefined);
});

test("Queue edge cases", () => {
  // Capacity 1
  const q1 = new Queue<number>(1);
  q1.push(1);
  const dropped = q1.push(2);
  expect(dropped).toEqual([1]);
  expect(q1.drain()).toEqual([2]);

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
