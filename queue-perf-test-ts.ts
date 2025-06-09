import { initLogger, traced } from "./js/src/index";

interface TestResult {
  rate: number;
  duration: number;
  totalSpans: number;
  droppedSpans: number;
  queueFillTime?: number;
}

class QueuePerformanceTester {
  private logger: any;
  private results: TestResult[] = [];

  constructor() {
    // Initialize logger with a test project using production
    this.logger = initLogger({
      projectName: "queue-perf-test",
    });
  }

  async testSpanCreationRate(
    rate: number,
    duration: number = 10,
  ): Promise<TestResult> {
    console.log(`Testing ${rate} spans/sec for ${duration} seconds...`);

    const intervalMs = 1000 / rate;
    const totalSpans = rate * duration;
    let createdSpans = 0;
    let droppedSpans = 0;
    let queueFillTime: number | undefined;

    const startTime = Date.now();

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (createdSpans >= totalSpans) {
          clearInterval(interval);
          const endTime = Date.now();
          const actualDuration = (endTime - startTime) / 1000;

          const result: TestResult = {
            rate,
            duration: actualDuration,
            totalSpans: createdSpans,
            droppedSpans,
            queueFillTime,
          };

          console.log(
            `  Created ${createdSpans} spans in ${actualDuration.toFixed(2)}s`,
          );
          console.log(`  Dropped: ${droppedSpans} spans`);
          if (queueFillTime) {
            console.log(`  Queue filled after: ${queueFillTime.toFixed(2)}s`);
          }

          resolve(result);
          return;
        }

        // Create a span
        const span = this.logger.startSpan({
          name: `test-span-${createdSpans}`,
          input: { message: `Test message ${createdSpans}` },
        });

        // Simulate some work
        span.log({
          output: `Test output ${createdSpans}`,
          metadata: { timestamp: Date.now(), rate },
        });

        span.end();
        createdSpans++;

        // Check if queue is dropping items - hacky access to internal queue
        const bgLogger = (this.logger as any).state.bgLogger();
        droppedSpans = bgLogger.queueDropped;
        console.assert(typeof droppedSpans === "number");

        if (!queueFillTime && createdSpans > 5000) {
          queueFillTime = (Date.now() - startTime) / 1000;
        }
      }, intervalMs);
    });
  }

  async runAllTests(): Promise<void> {
    const rates = [10, 100, 1000, 5000 /*, 10000, 20000*/];

    console.log("Starting queue performance tests...\n");

    for (const rate of rates) {
      try {
        const result = await this.testSpanCreationRate(rate, 5); // 5 second tests
        this.results.push(result);

        // Wait a bit between tests to let things settle
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Error testing rate ${rate}:`, error);
      }
    }

    this.printSummary();
  }

  private printSummary(): void {
    console.log("\n=== Queue Performance Test Results ===");
    console.log(
      "Rate (spans/sec) | Duration (s) | Total Spans | Dropped | Queue Fill Time",
    );
    console.log(
      "----------------|-------------|-------------|---------|----------------",
    );

    for (const result of this.results) {
      const fillTime = result.queueFillTime
        ? result.queueFillTime.toFixed(2) + "s"
        : "N/A";
      console.log(
        `${result.rate.toString().padStart(15)} | ` +
          `${result.duration.toFixed(2).padStart(11)} | ` +
          `${result.totalSpans.toString().padStart(11)} | ` +
          `${result.droppedSpans.toString().padStart(7)} | ` +
          `${fillTime.padStart(15)}`,
      );
    }

    // Find the rate where dropping starts to occur significantly
    const droppingResults = this.results.filter((r) => r.droppedSpans > 0);
    if (droppingResults.length > 0) {
      const firstDroppingRate = droppingResults[0].rate;
      console.log(
        `\nFirst significant dropping occurred at: ${firstDroppingRate} spans/sec`,
      );
    }
  }
}

// Run the tests
async function main() {
  const tester = new QueuePerformanceTester();
  await tester.runAllTests();
  process.exit(0);
}

if (require.main === module) {
  main().catch(console.error);
}
