import unittest
from typing import List

import pytest

from .util import LazyValue, mask_api_key


class TestLazyValue(unittest.TestCase):
    def test_evaluates_exactly_once(self):
        call_count = 0

        def compute_value():
            nonlocal call_count
            call_count += 1
            return "test"

        lazy = LazyValue(compute_value, use_mutex=True)

        self.assertEqual(call_count, 0)
        self.assertFalse(lazy.has_succeeded)

        # First access should compute
        value1 = lazy.get()
        self.assertEqual(value1, "test")
        self.assertEqual(call_count, 1)
        self.assertTrue(lazy.has_succeeded)

        # Second access should use cached value
        value2 = lazy.get()
        self.assertEqual(value2, "test")
        self.assertEqual(call_count, 1)
        self.assertTrue(lazy.has_succeeded)

    def test_has_succeeded_only_set_after_success(self):
        def failing_compute():
            raise ValueError("test error")

        lazy = LazyValue(failing_compute, use_mutex=True)

        self.assertFalse(lazy.has_succeeded)
        self.assertIsNone(lazy.value)

        with self.assertRaises(ValueError) as ctx:
            lazy.get()

        self.assertEqual(str(ctx.exception), "test error")
        self.assertFalse(lazy.has_succeeded)
        self.assertIsNone(lazy.value)

    def test_thread_safety(self):
        import threading
        import time

        # This will be used to track if multiple threads try to compute simultaneously
        computing = threading.Event()

        def compute_value():
            # If computing is already set when we enter, another thread
            # is also trying to compute - this should never happen
            if computing.is_set():
                raise RuntimeError("Concurrent computation detected!")

            computing.set()
            try:
                # Sleep briefly to increase chance of race conditions
                time.sleep(0.1)
                return "test result"
            finally:
                computing.clear()

        lazy = LazyValue(compute_value, use_mutex=True)

        # Launch multiple threads that all try to get() simultaneously
        threads: List[threading.Thread] = []
        results: List[str] = []
        errors: List[Exception] = []

        def worker():
            try:
                results.append(lazy.get())
            except Exception as e:
                errors.append(e)

        for _ in range(10):
            t = threading.Thread(target=worker)
            threads.append(t)
            t.start()

        # Wait for all threads to complete
        for t in threads:
            t.join()

        # Verify no errors occurred
        self.assertEqual(errors, [])

        # Verify all threads got the same result
        self.assertEqual(len(results), 10)
        self.assertTrue(all(r == "test result" for r in results))

        # Verify the computation is marked succeeded.
        self.assertTrue(lazy.has_succeeded)


if __name__ == "__main__":
    unittest.main()


def test_get_sync():
    call_count = 0

    def compute_value():
        nonlocal call_count
        call_count += 1
        return "test"

    lazy = LazyValue(compute_value, use_mutex=True)

    # Before resolution
    is_resolved, value = lazy.get_sync()
    assert is_resolved is False
    assert value is None
    assert call_count == 0  # Should not call the function

    # Resolve with get()
    result = lazy.get()
    assert result == "test"
    assert call_count == 1

    # After resolution
    is_resolved, value = lazy.get_sync()
    assert is_resolved is True
    assert value == "test"
    assert call_count == 1  # Should not call the function again


def test_get_sync_error():
    def failing_compute():
        raise ValueError("test error")

    lazy = LazyValue(failing_compute, use_mutex=True)

    # Before attempting to resolve
    is_resolved, value = lazy.get_sync()
    assert is_resolved is False
    assert value is None

    # Try to resolve with get() (which should fail)
    with pytest.raises(ValueError, match="test error"):
        lazy.get()

    # get_sync() should still return unresolved after failed resolution
    is_resolved, value = lazy.get_sync()
    assert is_resolved is False
    assert value is None


def test_mask_api_key():
    assert mask_api_key("1234567890") == "12******90"
    assert mask_api_key("12345") == "12*45"
    for i in ["", "1", "12", "123", "1234"]:
        assert mask_api_key(i) == "*" * len(i)
