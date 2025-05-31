import { expect, test } from "vitest";
import { Queue } from "./queue";

test("Queue basic operations - push, drain, length", () => {
  const queue = new Queue<number>(0);

  expect(queue.length()).toBe(0);

  queue.push(1, 2, 3);
  expect(queue.length()).toBe(3);

  const drained = queue.drain();
  expect(drained).toEqual([1, 2, 3]);
  expect(queue.length()).toBe(0);
});

test("Queue clear operation", () => {
  const queue = new Queue<string>(0);

  queue.push("a", "b", "c");
  expect(queue.length()).toBe(3);

  queue.clear();
  expect(queue.length()).toBe(0);

  const drained = queue.drain();
  expect(drained).toEqual([]);
});

test("Queue with maxSize less than 1 should accept unlimited items", () => {
  const q1 = new Queue<number>(0);

  for (let i = 0; i < 10; i++) {
    const dropped = q1.push(i);
    expect(dropped).toEqual([]);
  }
  expect(q1.length()).toBe(10);
});

test("Queue with maxSize should drop excess items from the front", () => {
  const q = new Queue<number>(2);

  const d0 = q.push(1);
  expect(d0).toEqual([]);
  expect(q.length()).toBe(1);

  const d1 = q.push(2);
  expect(d1).toEqual([]);
  expect(q.length()).toBe(2);

  const d2 = q.push(3, 4, 5);
  expect(d2).toEqual([1, 2, 3]);
  expect(q.length()).toBe(2);

  const d3 = q.push(6, 7, 8);
  expect(d3).toEqual([4, 5, 6]);
  expect(q.length()).toBe(2);

  const d4 = q.drain();
  expect(d4).toEqual([7, 8]);
  expect(q.length()).toBe(0);

  const d5 = q.push(1);
  expect(d5).toEqual([]);
  expect(q.length()).toBe(1);
});

test("Queue should maintain order with mixed operations", () => {
  const queue = new Queue<number>(4);

  queue.push(1, 2);
  queue.push(3);

  let drained = queue.drain();
  expect(drained).toEqual([1, 2, 3]);

  queue.push(4, 5, 6, 7);
  expect(queue.length()).toBe(4);

  drained = queue.drain();
  expect(drained).toEqual([4, 5, 6, 7]);
});
