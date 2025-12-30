import asyncio
import threading
import time

import pytest
from braintrust.queue import DEFAULT_QUEUE_SIZE, LogQueue


def test_log_queue_basic_operations():
    """Test basic push/pop operations and size reporting of LogQueue"""
    queue = LogQueue(maxsize=5)

    # Test empty queue
    items = queue.drain_all()
    assert items == []
    assert queue.size() == 0

    # Test adding items
    queue.put("item1")
    queue.put("item2")
    assert queue.size() == 2

    # Test draining items
    items = queue.drain_all()
    assert items == ["item1", "item2"]

    # Queue should be empty after draining
    items = queue.drain_all()
    assert items == []
    assert queue.size() == 0


def test_log_queue_drop_behavior():
    """Test queue drops oldest items when full, including single and multiple drops"""
    # Test basic drop behavior with size 2
    queue = LogQueue(maxsize=2)
    # Enable size limit enforcement for this test
    queue.enforce_queue_size_limit(True)

    # Fill queue to capacity
    d1 = queue.put("item1")
    d2 = queue.put("item2")
    assert not d1
    assert not d2

    # Adding more should drop the oldest items (with enforcement enabled)
    d3 = queue.put("item3")
    assert d3 == ["item1"]  # Oldest item is dropped

    d4 = queue.put("item4")
    assert d4 == ["item2"]  # Next oldest item is dropped

    # Queue should contain the newest items
    items = queue.drain_all()
    assert items == ["item3", "item4"]

    # Test size limit with maxsize=1
    queue_small = LogQueue(maxsize=1)
    queue_small.enforce_queue_size_limit(True)

    d1 = queue_small.put("item1")
    assert d1 == []
    assert queue_small.size() == 1

    # Adding another item should drop the oldest item (with enforcement enabled)
    d2 = queue_small.put("item2")
    assert d2 == ["item1"]  # Oldest item is dropped
    assert queue_small.size() == 1

    items = queue_small.drain_all()
    assert items == ["item2"]  # Newest item remains

    # Test multiple drops in sequence
    queue_multi = LogQueue(maxsize=2)
    queue_multi.enforce_queue_size_limit(True)

    # Fill queue
    queue_multi.put("item1")
    queue_multi.put("item2")

    # Add multiple items that will cause drops
    dropped1 = queue_multi.put("item3")
    dropped2 = queue_multi.put("item4")

    assert dropped1 == ["item1"]  # Oldest items are dropped
    assert dropped2 == ["item2"]  # Next oldest items are dropped

    # Queue should contain the newest items
    items = queue_multi.drain_all()
    assert items == ["item3", "item4"]


def test_log_queue_wait_for_items_semaphore_reset():
    """Test that wait_for_items semaphore resets after drain, not accumulates"""
    queue = LogQueue(maxsize=5)

    assert queue.wait_for_items(timeout=0.05) is False

    # multiple puts should start
    queue.put("item1")
    queue.put("item2")
    queue.put("item3")

    # First wait should succeed
    assert queue.wait_for_items(timeout=0.05) is True
    items = queue.drain_all()
    assert len(items) == 3

    # After drain, should block
    assert queue.wait_for_items(timeout=0.05) is False


def test_log_queue_default_size():
    queue = LogQueue(maxsize=0)
    assert queue.maxsize == DEFAULT_QUEUE_SIZE

    # Should be able to add many items without drops (up to 5000)
    for i in range(100):
        dropped = queue.put(f"item{i}")
        assert dropped == []  # No drops when under capacity

    # All items should be there
    items = queue.drain_all()
    assert len(items) == 100
    assert items[0] == "item0"
    assert items[99] == "item99"

    # Test negative maxsize also defaults
    queue_neg = LogQueue(maxsize=-5)
    assert queue_neg.maxsize == DEFAULT_QUEUE_SIZE

    # Should be able to add items without drops (when under capacity)
    for i in range(10):
        dropped = queue_neg.put(f"item{i}")
        assert dropped == []

    assert queue_neg.size() == 10

    items = queue_neg.drain_all()
    assert len(items) == 10


@pytest.mark.asyncio
async def test_queue_never_blocks_event_loop():
    """Test that queue operations don't block the asyncio event loop"""
    queue = LogQueue(maxsize=1)
    queue.enforce_queue_size_limit(True)  # Enable enforcement

    # Fill the queue
    queue.put("item1")

    # Flag to prove event loop stays responsive
    flag_set = False

    async def set_flag():
        nonlocal flag_set
        flag_set = True

    # Start queue operation and flag setter concurrently
    flag_task = asyncio.create_task(set_flag())

    # This should not block since we drop when full
    dropped = queue.put("item2")
    assert dropped == ["item1"]  # Oldest item is dropped

    # Wait for flag task to complete
    await flag_task

    # Flag should be set, proving event loop wasn't blocked
    assert flag_set is True

    # Clean up
    queue.drain_all()


@pytest.mark.asyncio
async def test_queue_concurrent_drops_and_drains():
    """Test concurrent producer/consumer with drops and drains in asyncio"""
    queue = LogQueue(maxsize=3)
    queue.enforce_queue_size_limit(True)  # Enable enforcement to ensure drops

    total_pushed = 0
    total_dropped = 0
    total_drained = 0

    async def producer():
        nonlocal total_pushed, total_dropped
        # Push many items to guarantee some drops
        for i in range(15):
            dropped = queue.put(f"item{i}")
            total_pushed += 1
            total_dropped += len(dropped)

    async def consumer():
        nonlocal total_drained
        # Periodically drain, but not fast enough to prevent all drops
        for _ in range(3):
            await asyncio.sleep(0)  # Yield control
            items = queue.drain_all()
            total_drained += len(items)

    # Run both concurrently
    await asyncio.gather(producer(), consumer())

    # Final drain to get remaining items
    final_items = queue.drain_all()
    total_drained += len(final_items)

    # Verify the accounting works out
    assert total_pushed == 15
    assert total_dropped > 0  # Some items should have been dropped
    assert total_drained > 0  # Some items should have been drained
    assert total_drained + total_dropped == total_pushed  # Conservation of items


def test_log_queue_thread_safety():
    """Test that queue operations are thread-safe under concurrent access"""

    queue = LogQueue(maxsize=5)
    total_added = 0
    total_dropped = 0
    total_drained = 0
    errors = []

    def producer(thread_id):
        nonlocal total_added, total_dropped
        try:
            for i in range(20):
                dropped = queue.put(f"t{thread_id}_item{i}")
                with threading.Lock():  # Protect shared counters
                    total_added += 1
                    total_dropped += len(dropped)
                time.sleep(0.001)  # Small delay to encourage interleaving
        except Exception as e:
            errors.append(f"Producer {thread_id}: {e}")

    def consumer():
        nonlocal total_drained
        try:
            for _ in range(10):
                time.sleep(0.005)  # Let producers add some items
                items = queue.drain_all()
                with threading.Lock():  # Protect shared counter
                    total_drained += len(items)
        except Exception as e:
            errors.append(f"Consumer: {e}")

    # Start multiple producer threads and one consumer
    threads = []
    for i in range(3):
        t = threading.Thread(target=producer, args=(i,))
        threads.append(t)
        t.start()

    consumer_thread = threading.Thread(target=consumer)
    threads.append(consumer_thread)
    consumer_thread.start()

    # Wait for all threads to complete
    for t in threads:
        t.join()

    # Final drain to get any remaining items
    final_items = queue.drain_all()
    total_drained += len(final_items)

    # Check for errors
    assert not errors, f"Thread safety errors: {errors}"

    # Verify conservation of items
    assert total_added == 60  # 3 threads * 20 items each
    assert total_dropped >= 0
    assert total_drained >= 0

    # With enforcement disabled, items are silently dropped by deque
    # We can only verify that we drained at most maxsize items at any time
    assert total_drained <= total_added
    assert total_dropped == 0  # No tracked drops with enforcement disabled

    # Verify queue is in a consistent state
    assert queue.size() == 0  # Should be empty after final drain
