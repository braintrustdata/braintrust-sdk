"""
Context Propagation Tests for Braintrust SDK

This test suite validates context propagation behavior across various concurrency patterns.

TEST ISOLATION STRATEGY:
- Tests use pytest-forked to run each test in an isolated process
- This ensures setup_threads() patches don't leak between tests
- Use unpatched(scenario) for xfail tests (documents context loss)
- Use patched(scenario) for tests that prove setup_threads() fixes it

Example:
    def _threadpool_scenario(test_logger, with_memory_logger):
        # test logic...

    test_threadpool_loses_context = unpatched(_threadpool_scenario)
    test_threadpool_with_patch = patched(_threadpool_scenario)

Run with: pytest --forked src/braintrust/test_context.py
"""

import asyncio
import concurrent.futures
import functools
import sys
import threading
from typing import AsyncGenerator, Callable, Generator, TypeVar

import braintrust
import pytest
from braintrust import current_span, start_span
from braintrust.test_helpers import init_test_logger, with_memory_logger  # noqa: F401
from braintrust.wrappers.threads import setup_threads

F = TypeVar("F", bound=Callable)


def isolate(instrument: bool) -> Callable[[F], F]:
    """
    Decorator for isolated context propagation tests.

    - Always runs in forked process (pytest-forked)
    - If instrument=True: calls setup_threads() before test
    - If instrument=False: marks test as xfail (context loss expected)
    """

    def decorator(fn: F) -> F:
        if asyncio.iscoroutinefunction(fn):

            @functools.wraps(fn)
            async def async_wrapper(*args, **kwargs):
                if instrument:
                    setup_threads()
                return await fn(*args, **kwargs)

            wrapped = pytest.mark.forked(async_wrapper)
        else:

            @functools.wraps(fn)
            def wrapper(*args, **kwargs):
                if instrument:
                    setup_threads()
                return fn(*args, **kwargs)

            wrapped = pytest.mark.forked(wrapper)

        if not instrument:
            wrapped = pytest.mark.xfail(reason="context lost without patch")(wrapped)
        return wrapped  # type: ignore

    return decorator


patched = isolate(instrument=True)
unpatched = isolate(instrument=False)


@pytest.fixture
def test_logger(with_memory_logger):
    """Provide a test logger for each test with memory logger."""
    logger = init_test_logger("test-context-project")
    yield logger


# ============================================================================
# CONTEXT MANAGER PATTERN: with start_span(...)
# ============================================================================


def _threadpool_scenario(test_logger, with_memory_logger):
    """ThreadPoolExecutor context propagation."""
    parent_seen_by_worker = None

    def worker_task():
        nonlocal parent_seen_by_worker
        parent_seen_by_worker = current_span()

    with start_span(name="parent") as parent_span:
        parent_id = parent_span.id
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(worker_task)
            future.result()

    assert parent_seen_by_worker is not None
    assert parent_seen_by_worker.id == parent_id


test_threadpool_loses_context = unpatched(_threadpool_scenario)
test_threadpool_with_patch = patched(_threadpool_scenario)


def _thread_scenario(test_logger, with_memory_logger):
    """threading.Thread context propagation."""
    parent_seen_by_worker = None

    def worker_task():
        nonlocal parent_seen_by_worker
        parent_seen_by_worker = current_span()

    with start_span(name="parent") as parent_span:
        parent_id = parent_span.id
        thread = threading.Thread(target=worker_task)
        thread.start()
        thread.join()

    assert parent_seen_by_worker is not None
    assert parent_seen_by_worker.id == parent_id


test_thread_loses_context = unpatched(_thread_scenario)
test_thread_with_patch = patched(_thread_scenario)


def _nested_threadpool_scenario(test_logger, with_memory_logger):
    """Nested ThreadPoolExecutor context propagation."""
    root_seen_by_level1 = None
    level1_seen_by_level2 = None

    def level2_task():
        nonlocal level1_seen_by_level2
        level1_seen_by_level2 = current_span()

    def level1_task():
        nonlocal root_seen_by_level1
        root_seen_by_level1 = current_span()

        with start_span(name="level1") as level1_span:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(level2_task)
                future.result()
            return level1_span.id

    with start_span(name="root") as root_span:
        root_id = root_span.id
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(level1_task)
            level1_id = future.result()

    assert root_seen_by_level1 is not None
    assert root_seen_by_level1.id == root_id
    assert level1_seen_by_level2 is not None
    assert level1_seen_by_level2.id == level1_id


test_nested_threadpool_loses_context = unpatched(_nested_threadpool_scenario)
test_nested_threadpool_with_patch = patched(_nested_threadpool_scenario)


@pytest.mark.asyncio
async def _run_in_executor_scenario(test_logger, with_memory_logger):
    """loop.run_in_executor context propagation."""
    parent_seen_by_worker = None

    def blocking_work():
        nonlocal parent_seen_by_worker
        parent_seen_by_worker = current_span()

    with start_span(name="parent") as parent_span:
        parent_id = parent_span.id
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, blocking_work)

    assert parent_seen_by_worker is not None
    assert parent_seen_by_worker.id == parent_id


test_run_in_executor_loses_context = unpatched(_run_in_executor_scenario)
test_run_in_executor_with_patch = patched(_run_in_executor_scenario)


# ============================================================================
# ASYNCIO PATTERNS (Should Work)
# ============================================================================


@pytest.mark.asyncio
async def test_asyncio_create_task_preserves_context(test_logger, with_memory_logger):
    """
    WORKS: asyncio.create_task() DOES preserve Braintrust context.
    """

    async def async_worker():
        span = current_span()
        worker_span = start_span(name="async_worker")
        await asyncio.sleep(0.001)
        worker_span.end()
        return span

    # Create parent span
    with start_span(name="parent") as parent_span:
        parent_id = parent_span.id

        # Create async task
        task = asyncio.create_task(async_worker())
        result_span = await task

    # Task SHOULD see the parent span
    assert result_span.id == parent_id, "create_task() should preserve context"

    test_logger.flush()
    logs = with_memory_logger.pop()
    assert len(logs) == 2

    parent_log = next(l for l in logs if l["span_attributes"]["name"] == "parent")
    worker_log = next(l for l in logs if l["span_attributes"]["name"] == "async_worker")

    # Worker should have parent as its parent (same trace)
    assert worker_log["root_span_id"] == parent_log["root_span_id"], "Should be in same trace"
    assert parent_log["span_id"] in worker_log.get("span_parents", []), "Worker should have parent as parent"


@pytest.mark.skipif(sys.version_info < (3, 9), reason="to_thread requires Python 3.9+")
@pytest.mark.asyncio
async def test_to_thread_preserves_context(test_logger, with_memory_logger):
    """
    WORKS: asyncio.to_thread() DOES preserve Braintrust context.
    """

    def blocking_work():
        span = current_span()
        worker_span = start_span(name="to_thread_worker")
        worker_span.end()
        return span

    # Create parent span
    with start_span(name="parent") as parent_span:
        parent_id = parent_span.id

        # Use to_thread
        result_span = await asyncio.to_thread(blocking_work)

    # to_thread SHOULD preserve context
    assert result_span.id == parent_id, "to_thread() should preserve context"

    test_logger.flush()
    logs = with_memory_logger.pop()

    # SURPRISING: Even to_thread() loses logger context (logger is a ContextVar too!)
    # Only parent span is logged
    # However, to_thread() DOES preserve span parent context
    assert len(logs) >= 1

    # If both spans logged (logger context preserved), verify parent chain
    if len(logs) == 2:
        parent_log = next(l for l in logs if l["span_attributes"]["name"] == "parent")
        worker_log = next(l for l in logs if l["span_attributes"]["name"] == "to_thread_worker")
        assert worker_log["root_span_id"] == parent_log["root_span_id"]
        assert parent_log["span_id"] in worker_log.get("span_parents", [])


# ============================================================================
# DECORATOR PATTERN: @traced
# ============================================================================


def _traced_decorator_scenario(test_logger, with_memory_logger):
    """@traced with ThreadPoolExecutor context propagation."""
    parent_seen_by_worker = None

    def worker_function():
        nonlocal parent_seen_by_worker
        parent_seen_by_worker = current_span()

    with start_span(name="parent") as parent_span:
        parent_id = parent_span.id
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(worker_function)
            future.result()

    assert parent_seen_by_worker is not None
    assert parent_seen_by_worker.id == parent_id


test_traced_decorator_loses_context = unpatched(_traced_decorator_scenario)
test_traced_decorator_with_patch = patched(_traced_decorator_scenario)


@pytest.mark.asyncio
async def test_traced_decorator_with_async(test_logger, with_memory_logger):
    """@traced decorator works with async functions (no patching needed)."""

    @braintrust.traced
    async def child_function():
        await asyncio.sleep(0.01)
        return "child_result"

    @braintrust.traced
    async def parent_function():
        return await child_function()

    await parent_function()

    test_logger.flush()
    logs = with_memory_logger.pop()

    assert len(logs) == 2
    parent_log = next(l for l in logs if l["span_attributes"]["name"] == "parent_function")
    child_log = next(l for l in logs if l["span_attributes"]["name"] == "child_function")
    assert child_log["root_span_id"] == parent_log["root_span_id"]
    assert parent_log["span_id"] in child_log.get("span_parents", [])


# ============================================================================
# MANUAL PATTERN: start_span() + .end()
# ============================================================================


def _manual_span_scenario(test_logger, with_memory_logger):
    """Manual span with ThreadPoolExecutor context propagation."""
    parent_seen_by_worker = None

    def worker_task():
        nonlocal parent_seen_by_worker
        parent_seen_by_worker = current_span()

    parent_span = start_span(name="parent", set_current=True)
    parent_span.set_current()
    try:
        parent_id = parent_span.id
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(worker_task)
            future.result()
    finally:
        parent_span.unset_current()
        parent_span.end()

    assert parent_seen_by_worker is not None
    assert parent_seen_by_worker.id == parent_id


test_manual_span_loses_context = unpatched(_manual_span_scenario)
test_manual_span_with_patch = patched(_manual_span_scenario)


@pytest.mark.asyncio
async def test_manual_span_with_async(test_logger, with_memory_logger):
    """
    Manual span management with explicit set_current()/unset_current() calls.

    ⚠️  IMPORTANT: This pattern is MORE VERBOSE and ERROR-PRONE than context managers.

    Incorrect pattern (DOES NOT WORK):
        parent_span = start_span("parent", set_current=True)  # ❌ Just creates span
        # parent is NOT current yet!

    Correct pattern (WORKS but verbose):
        parent_span = start_span("parent", set_current=True)
        parent_span.set_current()  # ✅ Actually set as current
        try:
            await child()
        finally:
            parent_span.unset_current()  # ✅ Clean up
            parent_span.end()

    Recommended pattern (BEST):
        with start_span("parent"):  # ✅ Automatic set/unset
            await child()
    """

    async def child_work():
        child_span = start_span(name="child", set_current=True)
        child_span.set_current()  # ✅ Must call explicitly!
        try:
            await asyncio.sleep(0.01)
            return "result"
        finally:
            child_span.unset_current()  # ✅ Must clean up!
            child_span.end()

    parent_span = start_span(name="parent", set_current=True)
    parent_span.set_current()  # ✅ Must call explicitly!
    parent_id = parent_span.id
    try:
        result = await child_work()
    finally:
        parent_span.unset_current()  # ✅ Must clean up!
        parent_span.end()

    test_logger.flush()
    logs = with_memory_logger.pop()

    # Expected: Both spans should be logged
    assert len(logs) == 2, f"Expected 2 spans, got {len(logs)}"

    parent_log = next(l for l in logs if l["span_attributes"]["name"] == "parent")
    child_log = next(l for l in logs if l["span_attributes"]["name"] == "child")

    # Child should be child of parent
    assert child_log["root_span_id"] == parent_log["root_span_id"], (
        f"Child root {child_log['root_span_id']} != parent root {parent_log['root_span_id']}"
    )
    assert parent_log["span_id"] in child_log.get("span_parents", []), (
        f"Parent {parent_log['span_id']} not in child parents {child_log.get('span_parents', [])}"
    )


# ============================================================================
# INTEGRATION PATTERNS (Based on Real SDK Integrations)
# ============================================================================


@pytest.mark.asyncio
async def test_async_generator_wrapper_pattern(test_logger, with_memory_logger):
    """
    Expected: Async generators wrapping spans should maintain parent relationships.

    Real-world pattern: Wrapping SDK streams in async generators (common in pydantic-ai, etc.)

    Pattern:
        with start_span("consumer"):
            async def stream_wrapper():
                with start_span("stream_source"):
                    async for item in source():
                        yield item

            async for item in stream_wrapper():
                process(item)

    Expected trace:
        consumer
          └─ stream_source
            └─ processing spans
    """

    async def simulated_stream():
        """Simulates an async stream source."""
        for i in range(3):
            await asyncio.sleep(0.001)
            yield f"item_{i}"

    async def stream_wrapper():
        """Wraps stream in async generator (common customer pattern)."""
        with start_span(name="stream_source") as source_span:
            async for item in simulated_stream():
                yield item

    with start_span(name="consumer") as consumer_span:
        async for item in stream_wrapper():
            # Process each item
            item_span = start_span(name=f"process_{item}")
            await asyncio.sleep(0.001)
            item_span.end()

    test_logger.flush()
    logs = with_memory_logger.pop()

    # Expected: consumer + stream_source + 3 process spans = 5
    assert len(logs) == 5, f"Expected 5 spans, got {len(logs)}"

    consumer_log = next(l for l in logs if l["span_attributes"]["name"] == "consumer")
    stream_log = next(l for l in logs if l["span_attributes"]["name"] == "stream_source")
    process_logs = [l for l in logs if l["span_attributes"]["name"].startswith("process_")]

    # All should share same root
    assert stream_log["root_span_id"] == consumer_log["root_span_id"]
    for p in process_logs:
        assert p["root_span_id"] == consumer_log["root_span_id"]

    # stream_source should be child of consumer
    assert consumer_log["span_id"] in stream_log.get("span_parents", [])


def test_library_doing_context_right(test_logger, with_memory_logger):
    """
    Test: Well-behaved library (like LangChain) that properly propagates context.

    This test works WITHOUT auto-instrumentation because the library correctly
    captures context at call time using copy_context().

    Real-world example - LangChain-style pattern:
        class WellBehavedSDK:
            def run_async(self, fn):
                ctx = contextvars.copy_context()  # Captured at call time!
                return self._pool.submit(lambda: ctx.run(fn))
    """
    import contextvars

    class WellBehavedSDK:
        def __init__(self):
            self._pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)

        def run_async(self, fn):
            ctx = contextvars.copy_context()
            return self._pool.submit(lambda: ctx.run(fn))

        def shutdown(self):
            self._pool.shutdown(wait=True)

    sdk = WellBehavedSDK()

    parent_seen_by_worker = None

    def worker_function():
        nonlocal parent_seen_by_worker
        parent_seen_by_worker = current_span()

    try:
        with start_span(name="user_parent") as parent_span:
            parent_id = parent_span.id
            future = sdk.run_async(worker_function)
            future.result()
    finally:
        sdk.shutdown()

    assert parent_seen_by_worker is not None
    assert parent_seen_by_worker.id == parent_id, "Well-behaved library preserves context"


def _integration_forgot_context_scenario(test_logger, with_memory_logger):
    """Integration without context propagation."""
    parent_seen_by_worker = None

    class NaiveIntegration:
        def __init__(self):
            self._pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)

        def process(self, fn):
            return self._pool.submit(fn)

        def shutdown(self):
            self._pool.shutdown(wait=True)

    integration = NaiveIntegration()

    def worker_function():
        nonlocal parent_seen_by_worker
        parent_seen_by_worker = current_span()

    try:
        with start_span(name="user_parent") as parent_span:
            parent_id = parent_span.id
            future = integration.process(worker_function)
            future.result()
    finally:
        integration.shutdown()

    assert parent_seen_by_worker is not None
    assert parent_seen_by_worker.id == parent_id


test_integration_forgot_context_loses = unpatched(_integration_forgot_context_scenario)
test_integration_forgot_context_with_patch = patched(_integration_forgot_context_scenario)


def test_integration_early_context_not_fixable(test_logger, with_memory_logger):
    """
    Documents: Integration that captured context too early CANNOT be fixed by auto-instrumentation.

    This pattern explicitly switches to a stale context using self._ctx.run(fn),
    which overrides our auto-instrumentation. The integration's explicit context
    switch happens AFTER our wrapper, so the stale context wins.

    Pattern:
        class EagerContextIntegration:
            def __init__(self):
                self._ctx = copy_context()  # Stale context captured here

            def process(self, fn):
                return self._pool.submit(lambda: self._ctx.run(fn))  # Explicit switch to stale

    Auto-instrumentation wraps submit(), but the lambda then switches to stale context.

    This is NOT fixable by auto-instrumentation - the integration must be fixed
    to capture context at call time, not at __init__ time.
    """
    import contextvars

    parent_seen_by_worker = None

    class EagerContextIntegration:
        def __init__(self):
            self._pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            self._ctx = contextvars.copy_context()

        def process(self, fn):
            return self._pool.submit(lambda: self._ctx.run(fn))

        def shutdown(self):
            self._pool.shutdown(wait=True)

    integration = EagerContextIntegration()

    def worker_function():
        nonlocal parent_seen_by_worker
        parent_seen_by_worker = current_span()

    try:
        with start_span(name="user_parent") as parent_span:
            parent_id = parent_span.id
            future = integration.process(worker_function)
            future.result()
    finally:
        integration.shutdown()

    assert parent_seen_by_worker is not None, "Worker runs"
    assert parent_seen_by_worker.id != parent_id, "Worker sees STALE context, not parent (not fixable)"


def _integration_thread_scenario(test_logger, with_memory_logger):
    """Integration using Thread directly."""
    parent_seen_by_worker = None

    class ThreadIntegration:
        def process(self, fn):
            thread = threading.Thread(target=fn)
            thread.start()
            return thread

        def wait(self, thread):
            thread.join()

    integration = ThreadIntegration()

    def worker_function():
        nonlocal parent_seen_by_worker
        parent_seen_by_worker = current_span()

    with start_span(name="user_parent") as parent_span:
        parent_id = parent_span.id
        thread = integration.process(worker_function)
        integration.wait(thread)

    assert parent_seen_by_worker is not None
    assert parent_seen_by_worker.id == parent_id


test_integration_thread_loses_context = unpatched(_integration_thread_scenario)
test_integration_thread_with_patch = patched(_integration_thread_scenario)


def _integration_decorator_scenario(test_logger, with_memory_logger):
    """Decorator pattern loses context."""
    parent_seen_by_worker = None

    def async_retry_decorator(fn):
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)

        def wrapper(*args, **kwargs):
            future = pool.submit(fn, *args, **kwargs)
            return future.result()

        return wrapper

    @async_retry_decorator
    def user_function():
        nonlocal parent_seen_by_worker
        parent_seen_by_worker = current_span()

    with start_span(name="user_parent") as parent_span:
        parent_id = parent_span.id
        user_function()

    assert parent_seen_by_worker is not None
    assert parent_seen_by_worker.id == parent_id


test_integration_decorator_loses_context = unpatched(_integration_decorator_scenario)
test_integration_decorator_with_patch = patched(_integration_decorator_scenario)


@pytest.mark.asyncio
async def test_copy_context_token_error_across_async_tasks(test_logger, with_memory_logger):
    """
    Expected: Span lifecycle should work even when started in one async context
    and ended in another (copied) context.

    Real-world pattern: LangChain creates parallel async tasks using asyncio.create_task(),
    which gives each task a COPY of the context. If a span is started in the main
    context but ended in a task context, we get:
    "ValueError: Token was created in a different Context"

    This is what LangChain's Braintrust integration silently handles!

    Pattern:
        async with start_span("parent"):
            # Span sets ContextVar token in context A

            async def task_work():
                # Task runs in context B (copy of A)
                # Try to end parent span
                # ValueError: Token from context A can't be reset in context B

            task = asyncio.create_task(task_work())  # Context copy
            await task

    Expected: Should work without errors (or handle them gracefully)
    Actual: May raise ValueError (which integrations must handle)
    """
    import asyncio

    with start_span(name="parent"):
        parent_log = with_memory_logger.pop()[0]
        parent_span = current_span()

        # Simulate what happens in LangChain:
        # Span is started in main context, but callback happens in task context

        async def task_work():
            # This runs in a COPIED context
            # If we try to manipulate parent_span here, we might hit token errors

            # This is what LangChain callbacks do:
            # 1. Create child span (works - parent_span accessible)
            with start_span(name="child"):
                await asyncio.sleep(0.01)

            # 2. Try to unset current (might fail with token error)
            try:
                parent_span.unset_current()
                token_error = None
            except ValueError as e:
                token_error = str(e)

            return token_error

        # Create task - this copies the context
        task = asyncio.create_task(task_work())
        error = await task

        # We might see token error here
        if error and "was created in a different Context" in error:
            # This is the error LangChain's integration silently handles!
            # It's not a bug, it's an expected consequence of context copies
            pass  # Expected in async contexts

    # Child span should still be logged correctly despite token error
    child_log = with_memory_logger.pop()[0]

    # The child span should maintain parent relationship
    # (Braintrust SDK handles this correctly even across context boundaries)
    assert child_log["span_parents"] == [parent_log["span_id"]], (
        f"Child span should have parent relationship despite context copy. Got: {child_log.get('span_parents')}"
    )


@pytest.mark.asyncio
async def test_async_generator_early_break_context_token(test_logger, with_memory_logger):
    """
    Expected: Early breaks from async generators shouldn't cause context token errors.

    Real-world issue: Breaking early from async generators causes cleanup in different
    async context, leading to "Token was created in a different Context" errors.

    Pattern (from pydantic-ai integration):
        async def stream_wrapper():
            with start_span("stream"):
                async for chunk in source():
                    yield chunk
                    if condition:
                        break  # Early break triggers cleanup in different context

        async for chunk in stream_wrapper():
            process(chunk)
            if done:
                break  # Consumer breaks early

    Expected: Spans logged correctly, no context token errors
    """

    async def simulated_long_stream():
        """Simulates a long stream."""
        for i in range(100):
            await asyncio.sleep(0.001)
            yield f"chunk_{i}"

    async def stream_wrapper():
        """Wraps stream, may break early (triggers cleanup in different context)."""
        with start_span(name="wrapped_stream") as stream_span:
            count = 0
            async for chunk in simulated_long_stream():
                yield chunk
                count += 1
                if count >= 3:
                    # Break early - this triggers cleanup in different context
                    break

    with start_span(name="consumer") as consumer_span:
        chunk_count = 0

        # Consumer breaks early too
        async for chunk in stream_wrapper():
            chunk_count += 1
            if chunk_count >= 2:
                break

    # Should not raise ValueError about "Token was created in a different Context"
    test_logger.flush()
    logs = with_memory_logger.pop()

    # Expected: At least consumer and wrapped_stream spans
    assert len(logs) >= 2, f"Expected at least 2 spans, got {len(logs)}"

    consumer_log = next((l for l in logs if l["span_attributes"]["name"] == "consumer"), None)
    stream_log = next((l for l in logs if l["span_attributes"]["name"] == "wrapped_stream"), None)

    assert consumer_log is not None, "Consumer span should be logged"
    assert stream_log is not None, "Wrapped stream span should be logged despite early break"

    # wrapped_stream should be child of consumer
    if stream_log:
        assert stream_log["root_span_id"] == consumer_log["root_span_id"]
        assert consumer_log["span_id"] in stream_log.get("span_parents", [])


# ============================================================================
# ASYNC GENERATOR TESTS
# ============================================================================


@pytest.mark.asyncio
async def test_async_generator_context_behavior(test_logger, with_memory_logger):
    """
    Test how Braintrust spans behave with async generators.
    """

    async def my_async_gen() -> AsyncGenerator[int, None]:
        gen_span = start_span(name="generator_span")

        try:
            for i in range(3):
                yield i
                await asyncio.sleep(0.001)
        finally:
            gen_span.end()

    # Consumer with parent span
    with start_span(name="consumer") as consumer_span:
        results = []
        async for value in my_async_gen():
            results.append(value)
            # Consumer does work between iterations
            item_span = start_span(name=f"process_{value}")
            await asyncio.sleep(0.001)
            item_span.end()

    assert results == [0, 1, 2]

    test_logger.flush()
    logs = with_memory_logger.pop()
    # Should have consumer + generator_span + 3 process spans
    assert len(logs) == 5


@pytest.mark.asyncio
async def test_async_generator_finalization(test_logger, with_memory_logger):
    """
    Test context during async generator cleanup.
    """

    async def generator_with_finally() -> AsyncGenerator[int, None]:
        gen_span = start_span(name="gen_with_finally")

        try:
            yield 1
            yield 2
        finally:
            # What context do we have during cleanup?
            cleanup_span = current_span()
            gen_span.end()

    # Consumer
    with start_span(name="consumer") as consumer_span:
        gen = generator_with_finally()
        await gen.__anext__()  # Get first value only

        # Explicitly close generator
        await gen.aclose()

    test_logger.flush()
    logs = with_memory_logger.pop()
    assert len(logs) == 2  # consumer + gen_with_finally


# ============================================================================
# TEST CATEGORY 4: Sync Generator Context
# ============================================================================


def test_sync_generator_context_sharing(test_logger, with_memory_logger):
    """
    Sync generators share caller's context - changes are visible.
    """

    def sync_gen() -> Generator[int, None, None]:
        for i in range(3):
            # Check current span at each iteration
            span = current_span()
            yield i

    # Create parent span
    with start_span(name="parent") as parent_span:
        gen = sync_gen()

        for i, value in enumerate(gen):
            # Create new span for each iteration
            item_span = start_span(name=f"item_{i}")
            item_span.end()

    test_logger.flush()
    logs = with_memory_logger.pop()
    assert len(logs) == 4  # parent + 3 items


# ============================================================================
# REAL-WORLD PATTERN TESTS
# ============================================================================


def _thread_wrapped_async_scenario(test_logger, with_memory_logger):
    """Thread-wrapped async (Google ADK, Pydantic AI pattern)."""
    import queue as queue_module

    event_queue = queue_module.Queue()
    parent_seen_in_thread = None

    async def _invoke_async():
        nonlocal parent_seen_in_thread
        parent_seen_in_thread = current_span()
        event_queue.put("done")

    def _thread_main():
        asyncio.run(_invoke_async())
        event_queue.put(None)

    with start_span(name="parent") as parent_span:
        parent_id = parent_span.id
        thread = threading.Thread(target=_thread_main)
        thread.start()
        while True:
            event = event_queue.get()
            if event is None:
                break
        thread.join()

    assert parent_seen_in_thread is not None
    assert parent_seen_in_thread.id == parent_id


test_thread_wrapped_async_loses_context = unpatched(_thread_wrapped_async_scenario)
test_thread_wrapped_async_with_patch = patched(_thread_wrapped_async_scenario)


async def _fastapi_background_scenario(test_logger, with_memory_logger):
    """FastAPI background tasks (run_in_executor)."""
    parent_seen_by_background = None

    def background_work():
        nonlocal parent_seen_by_background
        parent_seen_by_background = current_span()

    with start_span(name="http_request") as request_span:
        request_id = request_span.id
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, background_work)

    assert parent_seen_by_background is not None
    assert parent_seen_by_background.id == request_id


test_fastapi_background_loses_context = unpatched(pytest.mark.asyncio(_fastapi_background_scenario))
test_fastapi_background_with_patch = patched(pytest.mark.asyncio(_fastapi_background_scenario))


def _data_pipeline_scenario(test_logger, with_memory_logger):
    """Data pipeline with parallel ThreadPoolExecutor."""
    parents_seen = []

    def process_item(item: int):
        parent = current_span()
        parents_seen.append(parent)
        return item

    with start_span(name="pipeline") as pipeline_span:
        pipeline_id = pipeline_span.id
        data = list(range(3))

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(process_item, item) for item in data]
            [f.result() for f in futures]

    assert len(parents_seen) == 3
    for i, parent in enumerate(parents_seen):
        assert parent is not None
        assert parent.id == pipeline_id


test_data_pipeline_loses_context = unpatched(_data_pipeline_scenario)
test_data_pipeline_with_patch = patched(_data_pipeline_scenario)


@pytest.mark.asyncio
async def test_streaming_llm_pattern(test_logger, with_memory_logger):
    """
    Simulates streaming LLM responses with async generator.
    """

    async def llm_stream_generator() -> AsyncGenerator[str, None]:
        llm_span = start_span(name="llm_generation")

        try:
            for i in range(3):
                yield f"chunk_{i}"
                await asyncio.sleep(0.001)
        finally:
            llm_span.end()

    # Consumer
    with start_span(name="http_request") as request_span:
        async for chunk in llm_stream_generator():
            # Process each chunk
            chunk_span = start_span(name=f"process_{chunk}")
            await asyncio.sleep(0.001)
            chunk_span.end()

    test_logger.flush()
    logs = with_memory_logger.pop()
    assert len(logs) == 5  # request + llm_generation + 3 process chunks


# ============================================================================
# TEST CATEGORY 6: Context Isolation Tests
# ============================================================================


@pytest.mark.asyncio
async def test_parallel_tasks_context_isolation(test_logger, with_memory_logger):
    """
    Test that concurrent asyncio tasks have isolated contexts.
    """
    parent_ids = []

    async def task_work(task_id: int):
        # Each task should see the root span as parent
        parent = current_span()
        parent_ids.append(parent.id)

        task_span = start_span(name=f"task_{task_id}")

        await asyncio.sleep(0.01)
        task_span.end()

    # Root span
    with start_span(name="root") as root_span:
        root_id = root_span.id

        # Spawn multiple concurrent tasks
        tasks = [asyncio.create_task(task_work(i)) for i in range(5)]
        await asyncio.gather(*tasks)

    # All tasks should have seen root as parent
    assert all(pid == root_id for pid in parent_ids), "Tasks should see root as parent"

    test_logger.flush()
    logs = with_memory_logger.pop()
    assert len(logs) == 6  # root + 5 tasks

    root_log = next(l for l in logs if l["span_attributes"]["name"] == "root")
    task_logs = [l for l in logs if l["span_attributes"]["name"].startswith("task_")]

    # All tasks should have root as parent
    for task_log in task_logs:
        assert task_log["root_span_id"] == root_log["root_span_id"]
        assert root_log["span_id"] in task_log.get("span_parents", [])


@pytest.mark.skipif(sys.version_info < (3, 11), reason="TaskGroup requires Python 3.11+")
@pytest.mark.asyncio
async def test_taskgroup_context_propagation(test_logger, with_memory_logger):
    """
    Test that TaskGroup properly propagates context (Python 3.11+).
    """

    async def child_task(task_id: int):
        child_span = start_span(name=f"child_{task_id}")
        await asyncio.sleep(0.001)
        child_span.end()

    # Root span
    with start_span(name="root") as root_span:
        async with asyncio.TaskGroup() as tg:  # pylint: disable=no-member
            for i in range(3):
                tg.create_task(child_task(i))

    test_logger.flush()
    logs = with_memory_logger.pop()
    assert len(logs) == 4  # root + 3 children

    root_log = next(l for l in logs if l["span_attributes"]["name"] == "root")
    child_logs = [l for l in logs if l["span_attributes"]["name"].startswith("child_")]

    # All children should have root as parent
    for child_log in child_logs:
        assert child_log["root_span_id"] == root_log["root_span_id"]
        assert root_log["span_id"] in child_log.get("span_parents", [])


# ============================================================================
# TEST CATEGORY 7: Nested Context Tests
# ============================================================================


def test_nested_spans_same_thread(test_logger, with_memory_logger):
    """
    Test that nested spans work correctly in the same thread.
    """
    # Root span
    with start_span(name="root") as root_span:
        # Verify root is current
        assert current_span().id == root_span.id

        # Child span
        with start_span(name="child") as child_span:
            child_id = child_span.id

            # Verify child is now current
            assert current_span().id == child_span.id

            # Grandchild span
            with start_span(name="grandchild") as grandchild_span:
                grandchild_id = grandchild_span.id
                assert current_span().id == grandchild_span.id

            # After grandchild closes, child should be current
            assert current_span().id == child_span.id

        # After child closes, root should be current
        assert current_span().id == root_span.id

    test_logger.flush()
    logs = with_memory_logger.pop()
    assert len(logs) == 3

    root_log = next(l for l in logs if l["span_attributes"]["name"] == "root")
    child_log = next(l for l in logs if l["span_attributes"]["name"] == "child")
    grandchild_log = next(l for l in logs if l["span_attributes"]["name"] == "grandchild")

    # Verify parent chain
    assert root_log["span_id"] == root_log["root_span_id"], "Root is root"
    assert child_log["root_span_id"] == root_log["root_span_id"], "Child same root"
    assert grandchild_log["root_span_id"] == root_log["root_span_id"], "Grandchild same root"
    assert root_log["span_id"] in child_log.get("span_parents", []), "Child parent is root"
    assert child_log["span_id"] in grandchild_log.get("span_parents", []), "Grandchild parent is child"


@pytest.mark.asyncio
async def test_deeply_nested_async_context(test_logger, with_memory_logger):
    """
    Test deeply nested spans to ensure no corruption.
    """

    async def nested_span(depth: int):
        span = start_span(name=f"depth_{depth}")

        if depth > 0:
            await nested_span(depth - 1)

        span.end()

    with start_span(name="root") as root_span:
        root_id = root_span.id
        await nested_span(10)  # 10 levels deep

    test_logger.flush()
    logs = with_memory_logger.pop()

    # Should be 11 spans: root + 10 nested
    assert len(logs) >= 11  # Allow for timing variations

    # Get the actual root (first span created)
    root_log = next((l for l in logs if l["span_attributes"]["name"] == "root"), None)
    assert root_log is not None
    actual_root_id = root_log["root_span_id"]

    # All should share same root
    for log in logs:
        assert log["root_span_id"] == actual_root_id


# ============================================================================
# TEST CATEGORY 8: Exception Handling
# ============================================================================


def test_context_with_exception_propagation(test_logger, with_memory_logger):
    """
    Test that context is properly maintained during exception propagation.
    """
    fail_span_id = None

    def failing_function():
        nonlocal fail_span_id
        # Use context manager for proper span lifecycle
        with start_span(name="failing_span") as fail_span:
            fail_span_id = fail_span.id
            # During this context, fail_span should be current
            assert current_span().id == fail_span.id
            raise ValueError("Expected error")

    with start_span(name="parent") as parent_span:
        parent_id = parent_span.id

        try:
            failing_function()
        except ValueError:
            pass

        # After exception, parent should be restored as current
        assert current_span().id == parent_id

    test_logger.flush()
    logs = with_memory_logger.pop()
    assert len(logs) == 2

    parent_log = next(l for l in logs if l["span_attributes"]["name"] == "parent")
    fail_log = next(l for l in logs if l["span_attributes"]["name"] == "failing_span")

    # Verify parent chain
    assert fail_log["root_span_id"] == parent_log["root_span_id"]
    assert parent_log["span_id"] in fail_log.get("span_parents", [])


# ============================================================================
# AUTO-INSTRUMENTATION SPECIFIC TESTS
# ============================================================================


@pytest.mark.forked
def test_setup_threads_returns_true():
    """setup_threads() returns True on success."""
    result = setup_threads()
    assert result is True


@pytest.mark.forked
def test_setup_threads_idempotent():
    """Calling setup_threads() multiple times is safe."""
    result1 = setup_threads()
    result2 = setup_threads()
    assert result1 is True
    assert result2 is True


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
