#!/usr/bin/env node

import * as process from "process";

function getMemoryMB(): number {
  return process.memoryUsage().rss / 1024 / 1024;
}

async function testQueuePerformance(
  rate: number,
  queueSize: number,
  duration: number,
): Promise<void> {
  console.log(
    `Testing ${rate} spans/sec for ${duration} seconds with queue size ${queueSize}...`,
  );

  // Take initial memory snapshot
  const initialMemory = getMemoryMB();
  console.log(`Initial memory: ${initialMemory.toFixed(1)} MB`);

  // Set queue size environment variable before importing braintrust
  process.env.BRAINTRUST_QUEUE_DROP_EXCEEDING_MAXSIZE = queueSize.toString();
  console.log(
    `Set BRAINTRUST_QUEUE_DROP_EXCEEDING_MAXSIZE=${process.env.BRAINTRUST_QUEUE_DROP_EXCEEDING_MAXSIZE}`,
  );

  // Make queue drop logging very frequent (every 1 second instead of 60)
  process.env.BRAINTRUST_QUEUE_DROP_LOGGING_PERIOD = "1";

  const braintrust = await import("./js/src/index");
  // Initialize logger (this should create a fresh queue)
  const logger = braintrust.initLogger({
    projectName: "queue-perf-test",
  });

  // Get the global state for accessing queue stats
  const getGlobalState = (braintrust as any)._internalGetGlobalState;

  // Memory after import
  const postImportMemory = getMemoryMB();
  console.log(
    `Memory after import: ${postImportMemory.toFixed(1)} MB (+${(postImportMemory - initialMemory).toFixed(1)} MB)`,
  );

  // Reset dropped counter at start of test
  try {
    const state = getGlobalState();
    const httpLogger = state.httpLogger();
    if (httpLogger && httpLogger.queue) {
      (httpLogger.queue as any).dropped = 0;
    }
  } catch (e) {
    console.log("Could not reset dropped counter:", e);
  }

  const intervalS = 1.0 / rate;
  const totalSpans = rate * duration;
  let createdSpans = 0;
  let queueFillTime: number | null = null;
  const memorySnapshots: Array<[number, number, number]> = [];

  const startTime = Date.now() / 1000;

  while (createdSpans < totalSpans) {
    const spanStartTime = Date.now() / 1000;

    // Create a span
    const span = logger.startSpan({
      name: `test-span-${createdSpans}`,
      input: { message: `Test message ${createdSpans}` },
    });

    // Skip the log call to reduce queue items
    // span.log({
    //   output: `Test output ${createdSpans}`,
    //   metadata: { timestamp: Date.now() / 1000, rate }
    // });

    span.end();
    createdSpans++;

    // Check if queue is filling up (estimate based on queue_size)
    if (queueFillTime === null && createdSpans > queueSize) {
      queueFillTime = Date.now() / 1000 - startTime;
    }

    // Take memory snapshots at regular intervals
    if (createdSpans % Math.floor(totalSpans / 4) === 0 && createdSpans > 0) {
      const currentMemory = getMemoryMB();
      const elapsedTime = Date.now() / 1000 - startTime;
      memorySnapshots.push([elapsedTime, currentMemory, createdSpans]);
      console.log(
        `Memory at ${elapsedTime.toFixed(1)}s (${createdSpans} spans): ${currentMemory.toFixed(1)} MB`,
      );
    }

    // Adaptive sleep to maintain desired rate
    if (createdSpans < totalSpans) {
      const elapsed = Date.now() / 1000 - spanStartTime;
      const sleepTime = Math.max(0, intervalS - elapsed);
      if (sleepTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, sleepTime * 1000));
      }
    }
  }

  const endTime = Date.now() / 1000;
  const actualDuration = endTime - startTime;

  // Get dropped count from background logger
  let droppedSpans = 0;
  try {
    const state = getGlobalState();
    droppedSpans = state.httpLogger().queueDropped;
  } catch (e) {
    console.log("Could not get dropped count:", e);
  }

  // Final memory snapshot
  const finalMemory = getMemoryMB();

  console.log(`Created ${createdSpans} spans in ${actualDuration.toFixed(2)}s`);
  if (droppedSpans !== undefined && droppedSpans !== null) {
    console.log(`Dropped: ${droppedSpans} spans`);
    console.log(
      `Drop rate: ${((droppedSpans / createdSpans) * 100).toFixed(1)}%`,
    );
  } else {
    console.log(`Dropped: See console warnings above for drop notifications`);
  }
  if (queueFillTime) {
    console.log(`Queue filled after: ${queueFillTime.toFixed(2)}s`);
  }

  console.log(
    `Final memory: ${finalMemory.toFixed(1)} MB (+${(finalMemory - initialMemory).toFixed(1)} MB total)`,
  );

  // Show memory growth during test
  if (memorySnapshots.length > 0) {
    console.log("\nMemory progression:");
    for (const [elapsedTime, memory, spans] of memorySnapshots) {
      const growth = memory - initialMemory;
      console.log(
        `  ${elapsedTime.toFixed(1)}s: ${memory.toFixed(1)} MB (+${growth.toFixed(1)} MB, ${spans} spans)`,
      );
    }
  }

  // Wait for queue to flush and monitor memory recovery
  console.log("\nWaiting for queue to flush...");
  const flushStartTime = Date.now() / 1000;
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
    const currentMemory = getMemoryMB();
    const elapsedFlushTime = Date.now() / 1000 - flushStartTime;
    const memoryChange = currentMemory - finalMemory;
    console.log(
      `Flush +${elapsedFlushTime.toFixed(1)}s: ${currentMemory.toFixed(1)} MB (${memoryChange >= 0 ? "+" : ""}${memoryChange.toFixed(1)} MB from test end)`,
    );
  }
}

function main() {
  if (process.argv.length !== 5) {
    console.log(
      "Usage: node queue-perf-test-ts.ts <spans_per_second> <queue_size> <duration_seconds>",
    );
    console.log("Example: node queue-perf-test-ts.ts 5000 5000 10");
    process.exit(1);
  }

  const rate = parseInt(process.argv[2]);
  const queueSize = parseInt(process.argv[3]);
  const duration = parseInt(process.argv[4]);

  if (isNaN(rate) || isNaN(queueSize) || isNaN(duration)) {
    console.log("Error: All arguments must be integers");
    process.exit(1);
  }

  testQueuePerformance(rate, queueSize, duration)
    .then(() => {
      console.log("Test completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Test failed:", error);
      process.exit(1);
    });
}

if (require.main === module) {
  main();
}
