#!/usr/bin/env python3

import threading
import time
from dataclasses import dataclass
from typing import List, Optional

import braintrust


@dataclass
class TestResult:
    rate: int
    duration: float
    total_spans: int
    dropped_spans: int
    queue_fill_time: Optional[float] = None


class QueuePerformanceTester:
    def __init__(self):
        self.logger = braintrust.init_logger(project="queue-perf-test")
        self.results: List[TestResult] = []

    def test_span_creation_rate(self, rate: int, duration: int = 10) -> TestResult:
        print(f"Testing {rate} spans/sec for {duration} seconds...")

        interval_s = 1.0 / rate
        total_spans = rate * duration
        created_spans = 0
        dropped_spans = 0
        queue_fill_time: Optional[float] = None

        start_time = time.time()

        while created_spans < total_spans:
            # Create a span
            span = self.logger.start_span(
                name=f"test-span-{created_spans}",
                input={"message": f"Test message {created_spans}"}
            )

            # Simulate some work
            span.log(
                output=f"Test output {created_spans}",
                metadata={"timestamp": time.time(), "rate": rate}
            )

            span.end()
            created_spans += 1

            # Check dropped spans - hacky access to internal queue
            import braintrust
            bg_logger = braintrust.logger._state.global_bg_logger()
            dropped_spans = bg_logger.queue.dropped
            assert isinstance(dropped_spans, int)

            # Check if queue is filling up (estimate based on DEFAULT_QUEUE_SIZE)
            if queue_fill_time is None and created_spans > 5000:
                queue_fill_time = time.time() - start_time

            # Sleep to maintain the desired rate
            if created_spans < total_spans:
                time.sleep(interval_s)

        end_time = time.time()
        actual_duration = end_time - start_time

        result = TestResult(
            rate=rate,
            duration=actual_duration,
            total_spans=created_spans,
            dropped_spans=dropped_spans,  # We'll need to instrument this properly
            queue_fill_time=queue_fill_time,
        )

        print(f"  Created {created_spans} spans in {actual_duration:.2f}s")
        print(f"  Dropped: {dropped_spans} spans")
        if queue_fill_time:
            print(f"  Queue filled after: {queue_fill_time:.2f}s")

        return result

    def run_all_tests(self) -> None:
        rates = [10, 100, 1000, 5000, 10000, 20000]

        print("Starting queue performance tests...\n")

        for rate in rates:
            try:
                result = self.test_span_creation_rate(rate, 5)  # 5 second tests
                self.results.append(result)

                # Wait a bit between tests to let things settle
                time.sleep(2)
            except Exception as error:
                print(f"Error testing rate {rate}: {error}")

        self.print_summary()

    def print_summary(self) -> None:
        print("\n=== Queue Performance Test Results ===")
        print("Rate (spans/sec) | Duration (s) | Total Spans | Dropped | Queue Fill Time")
        print("----------------|-------------|-------------|---------|----------------")

        for result in self.results:
            fill_time = f"{result.queue_fill_time:.2f}s" if result.queue_fill_time else "N/A"
            print(
                f"{result.rate:>15} | "
                f"{result.duration:>11.2f} | "
                f"{result.total_spans:>11} | "
                f"{result.dropped_spans:>7} | "
                f"{fill_time:>15}"
            )

        # Find the rate where dropping starts to occur significantly
        dropping_results = [r for r in self.results if r.dropped_spans > 0]
        if dropping_results:
            first_dropping_rate = dropping_results[0].rate
            print(f"\nFirst significant dropping occurred at: {first_dropping_rate} spans/sec")


def main():
    tester = QueuePerformanceTester()
    tester.run_all_tests()


if __name__ == "__main__":
    main()
