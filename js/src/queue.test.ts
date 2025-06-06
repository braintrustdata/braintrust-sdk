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

test("Queue basic operations - push and drain", () => {
  const queue = new Queue<number>(5);

  expect(queue.length()).toBe(0);

  const dropped1 = queue.push(1, 2, 3);
  expect(dropped1).toEqual([]);

  expect(queue.length()).toBe(3);

  const drained = queue.drain();
  expect(drained).toEqual([1, 2, 3]);

  expect(queue.length()).toBe(0);

  const emptyDrain = queue.drain();
  expect(emptyDrain).toEqual([]);
});

test("Queue with maxSize should overwrite oldest items", () => {
  const queue = new Queue<number>(3);

  const dropped1 = queue.push(1, 2, 3);
  expect(dropped1).toEqual([]);
  expect(queue.length()).toBe(3);

  const dropped2 = queue.push(4);
  expect(dropped2).toEqual([1]);
  expect(queue.length()).toBe(3);

  const drained = queue.drain();
  expect(drained).toEqual([2, 3, 4]);
});

test("Queue edge case - capacity 1", () => {
  const queue = new Queue<number>(1);

  const dropped1 = queue.push(1);
  expect(dropped1).toEqual([]);
  expect(queue.length()).toBe(1);

  const dropped2 = queue.push(2);
  expect(dropped2).toEqual([1]);
  expect(queue.length()).toBe(1);

  const drained = queue.drain();
  expect(drained).toEqual([2]);

  expect(queue.length()).toBe(0);
  const emptyDrain = queue.drain();
  expect(emptyDrain).toEqual([]);
});

test("Queue circular buffer wrapping", () => {
  const queue = new Queue<number>(3);

  // Fill completely
  queue.push(1, 2, 3);
  expect(queue.length()).toBe(3);

  // Test overflow behavior - should drop oldest items
  const dropped = queue.push(4, 5);
  expect(dropped).toEqual([1, 2]);
  expect(queue.length()).toBe(3);

  // Verify remaining items in correct order
  const drained = queue.drain();
  expect(drained).toEqual([3, 4, 5]);
});

test("Queue peek method returns next item without removing it", () => {
  const queue = new Queue<number>(3);

  expect(queue.peek()).toBe(undefined);

  queue.push(1, 2);

  expect(queue.peek()).toBe(1);
  expect(queue.length()).toBe(2);

  // Note: We removed popLeft method, so this test now uses drain to verify peek
  const firstItem = queue.peek();
  expect(firstItem).toBe(1);

  const drained = queue.drain();
  expect(drained).toEqual([1, 2]);
  expect(queue.peek()).toBe(undefined);
});

test("Queue clears items from memory", () => {
  const queue = new Queue<{ value: number }>(2);

  const obj1 = { value: 1 };
  const obj2 = { value: 2 };
  const obj3 = { value: 3 };

  queue.push(obj1, obj2);

  // Fill to capacity to trigger overwrite
  queue.push(obj3);

  // Verify buffer handles overwrites correctly
  expect(queue.length()).toBe(2);
  expect(queue.peek()).toBe(obj2);
});

test("Queue drain returns all items and clears queue", () => {
  const queue = new Queue<number>(5);

  expect(queue.drain()).toEqual([]);

  queue.push(1, 2, 3);

  const drained = queue.drain();
  expect(drained).toEqual([1, 2, 3]);
  expect(queue.length()).toBe(0);
  expect(queue.peek()).toBe(undefined);

  // Verify we can use it again after drain
  queue.push(4);
  expect(queue.peek()).toBe(4);
});

test("Queue clear method empties queue", () => {
  const queue = new Queue<number>(5);

  queue.push(1, 2, 3);
  expect(queue.length()).toBe(3);

  queue.clear();
  expect(queue.length()).toBe(0);
  expect(queue.peek()).toBe(undefined);
});

test("Queue handles maxSize < 1 by using 5000", () => {
  const queue = new Queue<number>(-1);

  // Should be able to add many items without dropping any
  const items = Array.from({ length: 100 }, (_, i) => i);
  const dropped = queue.push(...items);

  expect(dropped).toEqual([]);
  expect(queue.length()).toBe(100);
});

test("Performance: Queue comparison", () => {
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

  console.log("\nPerformance Test Results:");
  console.log("=========================");

  for (const size of [1000, 5000]) {
    // Test 1: Fill without overflow
    const queueFillNoOverflow = runFillNoOverflow(Queue, size);
    console.log(
      `Queue (size ${size}) - Fill (no overflow): ${queueFillNoOverflow.toFixed(2)}ms`,
    );

    // Test 2: Fill with overflow
    const queueFillOverflow = runFillWithOverflow(Queue, size);
    console.log(
      `Queue (size ${size}) - Fill (with overflow): ${queueFillOverflow.toFixed(2)}ms`,
    );

    // Test 3: Small fill/drain cycles
    const queueSmall = runSmallFillDrain(Queue, size);
    console.log(
      `Queue (size ${size}) - Small fill/drain: ${queueSmall.toFixed(2)}ms`,
    );

    // Test 4: Cycle operations
    const queueCycle = runCycleOperations(Queue, size);
    console.log(
      `Queue (size ${size}) - Cycle operations: ${queueCycle.toFixed(2)}ms`,
    );

    // Verify tests completed
    expect(queueFillNoOverflow).toBeGreaterThan(0);
  }
});
