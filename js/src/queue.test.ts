import { expect, test } from "vitest";
import { Queue, Deque } from "./queue";

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

test("Deque basic operations - push and drain", () => {
  const deque = new Deque<number>(5);

  expect(deque.length()).toBe(0);

  const dropped1 = deque.push(1, 2, 3);
  expect(dropped1).toEqual([]);

  expect(deque.length()).toBe(3);

  const drained = deque.drain();
  expect(drained).toEqual([1, 2, 3]);

  expect(deque.length()).toBe(0);

  const emptyDrain = deque.drain();
  expect(emptyDrain).toEqual([]);
});

test("Deque with maxSize should overwrite oldest items", () => {
  const deque = new Deque<number>(3);

  const dropped1 = deque.push(1, 2, 3);
  expect(dropped1).toEqual([]);
  expect(deque.length()).toBe(3);

  const dropped2 = deque.push(4);
  expect(dropped2).toEqual([1]);
  expect(deque.length()).toBe(3);

  const drained = deque.drain();
  expect(drained).toEqual([2, 3, 4]);
});

test("Deque edge case - capacity 1", () => {
  const deque = new Deque<number>(1);

  const dropped1 = deque.push(1);
  expect(dropped1).toEqual([]);
  expect(deque.length()).toBe(1);

  const dropped2 = deque.push(2);
  expect(dropped2).toEqual([1]);
  expect(deque.length()).toBe(1);

  const drained = deque.drain();
  expect(drained).toEqual([2]);

  expect(deque.length()).toBe(0);
  const emptyDrain = deque.drain();
  expect(emptyDrain).toEqual([]);
});

test("Deque circular buffer wrapping", () => {
  const deque = new Deque<number>(3);

  // Fill completely
  deque.push(1, 2, 3);
  expect(deque.length()).toBe(3);

  // Test overflow behavior - should drop oldest items
  const dropped = deque.push(4, 5);
  expect(dropped).toEqual([1, 2]);
  expect(deque.length()).toBe(3);

  // Verify remaining items in correct order
  const drained = deque.drain();
  expect(drained).toEqual([3, 4, 5]);
});

test("Deque peek method returns next item without removing it", () => {
  const deque = new Deque<number>(3);

  expect(deque.peek()).toBe(undefined);

  deque.push(1, 2);

  expect(deque.peek()).toBe(1);
  expect(deque.length()).toBe(2);

  expect(deque.popLeft()).toBe(1);
  expect(deque.peek()).toBe(2);

  expect(deque.popLeft()).toBe(2);
  expect(deque.peek()).toBe(undefined);
});

test("Deque clears popped items from memory", () => {
  const deque = new Deque<{ value: number }>(2);

  const obj1 = { value: 1 };
  const obj2 = { value: 2 };
  const obj3 = { value: 3 };

  deque.push(obj1, obj2);

  // Pop item and verify it's cleared from internal buffer
  const popped = deque.popLeft();
  expect(popped).toBe(obj1);

  // Verify buffer slot is cleared (peek at internal state via any casting for test)
  const buffer = (deque as any).buffer;
  const head = (deque as any).head;
  expect(buffer[(head - 1 + buffer.length) % buffer.length]).toBe(undefined);

  // Fill to capacity to trigger overwrite
  deque.push(obj3);

  // The slot where obj2 was should still contain obj2 since it hasn't been popped
  expect(deque.peek()).toBe(obj2);
});

test("Deque drain returns all items and clears deque", () => {
  const deque = new Deque<number>(5);

  expect(deque.drain()).toEqual([]);

  deque.push(1, 2, 3);

  const drained = deque.drain();
  expect(drained).toEqual([1, 2, 3]);
  expect(deque.length()).toBe(0);
  expect(deque.peek()).toBe(undefined);

  // Verify we can use it again after drain
  deque.push(4);
  expect(deque.peek()).toBe(4);
});

test("Deque clear method empties deque", () => {
  const deque = new Deque<number>(5);

  deque.push(1, 2, 3);
  expect(deque.length()).toBe(3);

  deque.clear();
  expect(deque.length()).toBe(0);
  expect(deque.peek()).toBe(undefined);
  expect(deque.popLeft()).toBe(undefined);
});

test("Deque handles maxSize < 1 by using 5000", () => {
  const deque = new Deque<number>(-1);

  // Should be able to add many items without dropping any
  const items = Array.from({ length: 100 }, (_, i) => i);
  const dropped = deque.push(...items);

  expect(dropped).toEqual([]);
  expect(deque.length()).toBe(100);
});

test("Performance: Queue vs Deque comparison", () => {
  function runTest<
    T extends {
      push(...items: number[]): number[];
      drain(): number[];
      length(): number;
      clear(): void;
    },
  >(queueType: new (maxSize: number) => T, name: string, size: number) {
    const q = new queueType(size);
    const start = performance.now();

    // Phase 1: Fill without overflowing (10 times)
    for (let run = 0; run < 10; run++) {
      for (let i = 0; i < size; i++) {
        q.push(i);
      }
      q.drain();
    }

    // Phase 2: Fill with overflow (10 times)
    for (let run = 0; run < 10; run++) {
      for (let i = 0; i < size * 2; i++) {
        q.push(i);
      }
      q.drain();
    }

    // Phase 3: Multiple drain/fill cycles (10 times)
    for (let run = 0; run < 10; run++) {
      for (let cycle = 0; cycle < 10; cycle++) {
        for (let i = 0; i < size; i++) {
          q.push(i);
        }
        q.drain();
      }
    }

    const elapsed = performance.now() - start;
    console.log(`${name} (size ${size}): ${elapsed.toFixed(2)}ms`);
    return elapsed;
  }

  function runFillNoOverflow<
    T extends {
      push(...items: number[]): number[];
      drain(): number[];
      length(): number;
      clear(): void;
    },
  >(
    queueType: new (maxSize: number) => T,
    size: number,
    iterations: number = 10,
  ) {
    const q = new queueType(size);
    const start = performance.now();

    for (let run = 0; run < iterations; run++) {
      for (let i = 0; i < size; i++) {
        q.push(i);
      }
      q.drain();
    }

    return performance.now() - start;
  }

  function runFillWithOverflow<
    T extends {
      push(...items: number[]): number[];
      drain(): number[];
      length(): number;
      clear(): void;
    },
  >(
    queueType: new (maxSize: number) => T,
    size: number,
    iterations: number = 10,
  ) {
    const q = new queueType(size);
    const start = performance.now();

    for (let run = 0; run < iterations; run++) {
      for (let i = 0; i < size * 2; i++) {
        q.push(i);
      }
      q.drain();
    }

    return performance.now() - start;
  }

  function runSmallFillDrain<
    T extends {
      push(...items: number[]): number[];
      drain(): number[];
      length(): number;
      clear(): void;
    },
  >(
    queueType: new (maxSize: number) => T,
    size: number,
    iterations: number = 100,
  ) {
    const q = new queueType(size);
    const start = performance.now();

    const itemsToAdd = Math.floor(size / 10); // 1/10th full
    for (let run = 0; run < iterations; run++) {
      for (let i = 0; i < itemsToAdd; i++) {
        q.push(i);
      }
      q.drain();
    }

    return performance.now() - start;
  }

  function runCycleOperations<
    T extends {
      push(...items: number[]): number[];
      drain(): number[];
      length(): number;
      clear(): void;
    },
  >(
    queueType: new (maxSize: number) => T,
    size: number,
    iterations: number = 10,
  ) {
    const q = new queueType(size);
    const start = performance.now();

    for (let run = 0; run < iterations; run++) {
      for (let cycle = 0; cycle < 10; cycle++) {
        for (let i = 0; i < size; i++) {
          q.push(i);
        }
        q.drain();
      }
    }

    return performance.now() - start;
  }

  console.log("\nPerformance Comparison Table:");
  console.log("=====================================");
  console.log(
    "Size   | Test Type           | Queue (ms) | Deque (ms) | Speedup",
  );
  console.log(
    "-------|---------------------|------------|------------|--------",
  );

  for (const size of [1000, 5000, 10000]) {
    // Test 1: Fill without overflow
    const queueFillNoOverflow = runFillNoOverflow(Queue, size);
    const dequeFillNoOverflow = runFillNoOverflow(Deque, size);
    const speedup1 = (queueFillNoOverflow / dequeFillNoOverflow).toFixed(1);
    console.log(
      `${size.toString().padStart(6)} | Fill (no overflow)  | ${queueFillNoOverflow.toFixed(2).padStart(10)} | ${dequeFillNoOverflow.toFixed(2).padStart(10)} | ${speedup1}x`,
    );

    // Test 2: Fill with overflow
    const queueFillOverflow = runFillWithOverflow(Queue, size);
    const dequeFillOverflow = runFillWithOverflow(Deque, size);
    const speedup2 = (queueFillOverflow / dequeFillOverflow).toFixed(1);
    console.log(
      `${size.toString().padStart(6)} | Fill (with overflow)| ${queueFillOverflow.toFixed(2).padStart(10)} | ${dequeFillOverflow.toFixed(2).padStart(10)} | ${speedup2}x`,
    );

    // Test 3: Small fill/drain cycles
    const queueSmall = runSmallFillDrain(Queue, size);
    const dequeSmall = runSmallFillDrain(Deque, size);
    const speedup3 = (queueSmall / dequeSmall).toFixed(1);
    console.log(
      `${size.toString().padStart(6)} | Small fill/drain    | ${queueSmall.toFixed(2).padStart(10)} | ${dequeSmall.toFixed(2).padStart(10)} | ${speedup3}x`,
    );

    // Test 4: Cycle operations
    const queueCycle = runCycleOperations(Queue, size);
    const dequeCycle = runCycleOperations(Deque, size);
    const speedup4 = (queueCycle / dequeCycle).toFixed(1);
    console.log(
      `${size.toString().padStart(6)} | Cycle operations    | ${queueCycle.toFixed(2).padStart(10)} | ${dequeCycle.toFixed(2).padStart(10)} | ${speedup4}x`,
    );

    if (size < 10000)
      console.log(
        "-------|---------------------|------------|------------|--------",
      );

    // Verify tests completed
    expect(queueFillNoOverflow).toBeGreaterThan(0);
    expect(dequeFillNoOverflow).toBeGreaterThan(0);
  }
});
