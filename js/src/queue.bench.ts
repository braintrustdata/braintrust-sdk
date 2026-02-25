import { Bench } from "tinybench";
import { Queue } from "./queue";

const bench = new Bench({ name: "Queue Performance", time: 1000 });

const testData = Array.from({ length: 1000 }, (_, i) => i);
const smallData = Array.from({ length: 10 }, (_, i) => i);
const partialData = Array.from({ length: 100 }, (_, i) => i);

// Initialize queues once
const fullQueue = new Queue<number>(1000);
const wrappedQueue = new Queue<number>(1000);
const partialQueue = new Queue<number>(1000);

bench
  .add("fill no overflow", () => {
    const q = new Queue<number>(2000);
    q.push(...testData);
    q.drain();
  })
  .add("fill with overflow", () => {
    const q = new Queue<number>(100);
    q.push(...testData);
    q.drain();
  })
  .add("single items", () => {
    const q = new Queue<number>(500);
    for (let i = 0; i < 1000; i++) {
      q.push(i);
    }
    q.drain();
  })
  .add("small batches", () => {
    const q = new Queue<number>(50);
    for (let i = 0; i < 100; i++) {
      q.push(...smallData);
      if (i % 10 === 0) q.drain();
    }
    q.drain();
  })
  // New benchmarks comparing drain vs drain2 with pre-initialized queues
  .add("drain - full queue", () => {
    fullQueue.push(...testData);
    fullQueue.drain();
  })
  .add("drain - wrapped", () => {
    wrappedQueue.push(...testData);
    wrappedQueue.drain();
    wrappedQueue.push(...testData.slice(0, 500));
    wrappedQueue.drain();
  })
  // New benchmarks for partially filled queue
  .add("drain - partial queue", () => {
    partialQueue.push(...partialData);
    partialQueue.drain();
  });

(async () => {
  await bench.run();
  console.log(bench.name);
  console.table(bench.table());
})();
