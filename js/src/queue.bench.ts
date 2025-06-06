import { Bench } from "tinybench";
import { Queue } from "./queue";

const bench = new Bench({ name: "Queue Performance", time: 1000 });

const testData = Array.from({ length: 1000 }, (_, i) => i);
const smallData = Array.from({ length: 10 }, (_, i) => i);

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
  });

(async () => {
  await bench.run();
  console.log(bench.name);
  console.table(bench.table());
})();
