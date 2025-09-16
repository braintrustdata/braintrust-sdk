"""Tests for span context management."""

import asyncio
import threading
import time

from .span_context import SpanContext


class TestSpanContext:
    """Test cases for SpanContext."""

    def test_initial_state(self):
        """Test that SpanContext initializes with None defaults."""
        manager = SpanContext()
        assert manager.get_current_span() is None
        assert manager.get_current_parent() is None

    def test_set_and_get_span(self):
        """Test setting and getting current span."""
        manager = SpanContext()
        mock_span = "test_span"

        token = manager.set_current_span(mock_span)
        assert manager.get_current_span() == mock_span

        manager.reset_current_span(token)
        assert manager.get_current_span() is None

    def test_set_and_get_parent(self):
        """Test setting and getting current parent."""
        manager = SpanContext()
        parent_id = "parent_123"

        token = manager.set_current_parent(parent_id)
        assert manager.get_current_parent() == parent_id

        manager.reset_current_parent(token)
        assert manager.get_current_parent() is None

    def test_nested_span_context(self):
        """Test nested span contexts work correctly."""
        manager = SpanContext()
        span1 = "span_1"
        span2 = "span_2"

        token1 = manager.set_current_span(span1)
        assert manager.get_current_span() == span1

        token2 = manager.set_current_span(span2)
        assert manager.get_current_span() == span2

        manager.reset_current_span(token2)
        assert manager.get_current_span() == span1

        manager.reset_current_span(token1)
        assert manager.get_current_span() is None

    def test_nested_parent_context(self):
        """Test nested parent contexts work correctly."""
        manager = SpanContext()
        parent1 = "parent_1"
        parent2 = "parent_2"

        token1 = manager.set_current_parent(parent1)
        assert manager.get_current_parent() == parent1

        token2 = manager.set_current_parent(parent2)
        assert manager.get_current_parent() == parent2

        manager.reset_current_parent(token2)
        assert manager.get_current_parent() == parent1

        manager.reset_current_parent(token1)
        assert manager.get_current_parent() is None

    def test_thread_isolation(self):
        """Test that context is isolated between threads."""
        manager = SpanContext()
        results = {}

        def thread_func(thread_id: str, span_value: str):
            token = manager.set_current_span(span_value)
            time.sleep(0.1)  # Allow other threads to potentially interfere
            results[thread_id] = manager.get_current_span()
            manager.reset_current_span(token)

        threads = []
        for i in range(3):
            thread = threading.Thread(
                target=thread_func,
                args=(f"thread_{i}", f"span_{i}")
            )
            threads.append(thread)
            thread.start()

        for thread in threads:
            thread.join()

        # Each thread should see its own span value
        for i in range(3):
            assert results[f"thread_{i}"] == f"span_{i}"

    def test_async_isolation(self):
        """Test that context is isolated between async tasks."""
        manager = SpanContext()

        async def async_task(task_id: str, span_value: str) -> str:
            token = manager.set_current_span(span_value)
            await asyncio.sleep(0.1)  # Allow other tasks to potentially interfere
            result = manager.get_current_span()
            manager.reset_current_span(token)
            return result

        async def run_test():
            tasks = [
                async_task(f"task_{i}", f"span_{i}")
                for i in range(3)
            ]
            results = await asyncio.gather(*tasks)
            return results

        results = asyncio.run(run_test())

        # Each task should see its own span value
        for i, result in enumerate(results):
            assert result == f"span_{i}"

    def test_context_var_isolation(self):
        """Test that different SpanContext instances have isolated contexts."""
        manager1 = SpanContext()
        manager2 = SpanContext()

        span1 = "manager1_span"
        span2 = "manager2_span"

        token1 = manager1.set_current_span(span1)
        token2 = manager2.set_current_span(span2)

        assert manager1.get_current_span() == span1
        assert manager2.get_current_span() == span2

        manager1.reset_current_span(token1)
        manager2.reset_current_span(token2)

        assert manager1.get_current_span() is None
        assert manager2.get_current_span() is None

    def test_none_values(self):
        """Test that None values can be explicitly set."""
        manager = SpanContext()

        # Set a span first
        token1 = manager.set_current_span("test_span")
        assert manager.get_current_span() == "test_span"

        # Explicitly set to None
        token2 = manager.set_current_span(None)
        assert manager.get_current_span() is None

        # Reset should go back to previous value
        manager.reset_current_span(token2)
        assert manager.get_current_span() == "test_span"

        manager.reset_current_span(token1)
        assert manager.get_current_span() is None

    def test_parent_none_values(self):
        """Test that None parent values can be explicitly set."""
        manager = SpanContext()

        # Set a parent first
        token1 = manager.set_current_parent("parent_1")
        assert manager.get_current_parent() == "parent_1"

        # Explicitly set to None
        token2 = manager.set_current_parent(None)
        assert manager.get_current_parent() is None

        # Reset should go back to previous value
        manager.reset_current_parent(token2)
        assert manager.get_current_parent() == "parent_1"

        manager.reset_current_parent(token1)
        assert manager.get_current_parent() is None
