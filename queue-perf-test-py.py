#!/usr/bin/env python3

import os
import sys
import time
from typing import Optional

import psutil


def get_memory_mb() -> float:
    """Get current process memory usage in MB."""
    return psutil.Process().memory_info().rss / 1024 / 1024


def test_queue_performance(rate: int, queue_size: int, duration: int) -> None:
    """Test queue performance with given parameters."""
    print(f"Testing {rate} spans/sec for {duration} seconds with queue size {queue_size}...")

    # Take initial memory snapshot
    initial_memory = get_memory_mb()
    print(f"Initial memory: {initial_memory:.1f} MB")

    # Set queue size environment variable before importing braintrust
    os.environ['BRAINTRUST_QUEUE_SIZE'] = str(queue_size)

    # Make queue drop logging very frequent (every 1 second instead of 60)
    os.environ['BRAINTRUST_QUEUE_DROP_LOGGING_PERIOD'] = '1'

    import braintrust
    # Initialize logger (this should create a fresh queue)
    logger = braintrust.init_logger(project="queue-perf-test")

    # Memory after import
    post_import_memory = get_memory_mb()
    print(f"Memory after import: {post_import_memory:.1f} MB (+{post_import_memory - initial_memory:.1f} MB)")

    # Reset queue counters at start of test
    bg_logger = braintrust.logger._state.global_bg_logger()
    bg_logger.queue._total_dropped = 0
    bg_logger.queue._total_pushed = 0

    interval_s = 1.0 / rate
    total_spans = rate * duration
    created_spans = 0
    queue_fill_time: Optional[float] = None
    memory_snapshots = []

    start_time = time.time()

    while created_spans < total_spans:
        span_start_time = time.time()

        # Create a span
        span = logger.start_span(
            name=f"test-span-{created_spans}",
            input={"message": f"Test message {created_spans}"}
        )

        span.log(
            output=f"Test output {created_spans}",
            metadata={"timestamp": time.time(), "rate": rate}
        )

        span.end()
        created_spans += 1

        # Check if queue is filling up (estimate based on queue_size)
        if queue_fill_time is None and created_spans > queue_size:
            queue_fill_time = time.time() - start_time

        # Take memory snapshots at regular intervals
        if created_spans % (total_spans // 4) == 0 and created_spans > 0:
            current_memory = get_memory_mb()
            elapsed_time = time.time() - start_time
            memory_snapshots.append((elapsed_time, current_memory, created_spans))
            print(f"Memory at {elapsed_time:.1f}s ({created_spans} spans): {current_memory:.1f} MB")

        # Adaptive sleep to maintain desired rate
        if created_spans < total_spans:
            elapsed = time.time() - span_start_time
            sleep_time = max(0, interval_s - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

    end_time = time.time()
    actual_duration = end_time - start_time

    # Get dropped count from background logger
    bg_logger = braintrust.logger._state.global_bg_logger()
    dropped_spans = bg_logger.queue.dropped

    # Final memory snapshot
    final_memory = get_memory_mb()

    print(f"Created {created_spans} spans in {actual_duration:.2f}s")
    print(f"Dropped: {dropped_spans} spans")
    print(f"Drop rate: {(dropped_spans / created_spans * 100):.1f}%")
    if queue_fill_time:
        print(f"Queue filled after: {queue_fill_time:.2f}s")

    print(f"Final memory: {final_memory:.1f} MB (+{final_memory - initial_memory:.1f} MB total)")

    # Show memory growth during test
    if memory_snapshots:
        print("\nMemory progression:")
        for elapsed_time, memory, spans in memory_snapshots:
            growth = memory - initial_memory
            print(f"  {elapsed_time:.1f}s: {memory:.1f} MB (+{growth:.1f} MB, {spans} spans)")

    # Wait for queue to flush and monitor memory recovery
    print("\nWaiting for queue to flush...")
    flush_start_time = time.time()
    for i in range(10):
        time.sleep(2)  # Wait 2 seconds
        current_memory = get_memory_mb()
        elapsed_flush_time = time.time() - flush_start_time
        memory_change = current_memory - final_memory
        sign = "+" if memory_change >= 0 else ""
        print(f"Flush +{elapsed_flush_time:.1f}s: {current_memory:.1f} MB ({sign}{memory_change:.1f} MB from test end)")


def main():
    if len(sys.argv) != 4:
        print("Usage: python queue-perf-test-py.py <spans_per_second> <queue_size> <duration_seconds>")
        print("Example: python queue-perf-test-py.py 5000 5000 10")
        sys.exit(1)

    try:
        rate = int(sys.argv[1])
        queue_size = int(sys.argv[2])
        duration = int(sys.argv[3])
    except ValueError:
        print("Error: All arguments must be integers")
        sys.exit(1)

    test_queue_performance(rate, queue_size, duration)


if __name__ == "__main__":
    main()
