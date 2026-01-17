"""Tests for SpanCache (disk-based cache)."""


from braintrust.span_cache import CachedSpan, SpanCache


def test_span_cache_write_and_read():
    """Test storing and retrieving spans by rootSpanId."""
    cache = SpanCache()
    cache.start()  # Start for testing (cache is disabled by default)

    root_span_id = "root-123"
    span1 = CachedSpan(
        span_id="span-1",
        input={"text": "hello"},
        output={"response": "world"},
    )
    span2 = CachedSpan(
        span_id="span-2",
        input={"text": "foo"},
        output={"response": "bar"},
    )

    cache.queue_write(root_span_id, span1.span_id, span1)
    cache.queue_write(root_span_id, span2.span_id, span2)

    spans = cache.get_by_root_span_id(root_span_id)
    assert spans is not None
    assert len(spans) == 2

    span_ids = {s.span_id for s in spans}
    assert "span-1" in span_ids
    assert "span-2" in span_ids

    cache.stop()
    cache.dispose()


def test_span_cache_return_none_for_unknown():
    """Test that unknown rootSpanId returns None."""
    cache = SpanCache()
    cache.start()

    spans = cache.get_by_root_span_id("nonexistent")
    assert spans is None

    cache.stop()
    cache.dispose()


def test_span_cache_merge_on_duplicate_writes():
    """Test that subsequent writes to same spanId merge data."""
    cache = SpanCache()
    cache.start()

    root_span_id = "root-123"
    span_id = "span-1"

    cache.queue_write(
        root_span_id,
        span_id,
        CachedSpan(span_id=span_id, input={"text": "hello"}),
    )

    cache.queue_write(
        root_span_id,
        span_id,
        CachedSpan(span_id=span_id, output={"response": "world"}),
    )

    spans = cache.get_by_root_span_id(root_span_id)
    assert spans is not None
    assert len(spans) == 1
    assert spans[0].span_id == span_id
    assert spans[0].input == {"text": "hello"}
    assert spans[0].output == {"response": "world"}

    cache.stop()
    cache.dispose()


def test_span_cache_merge_metadata():
    """Test that metadata objects are merged."""
    cache = SpanCache()
    cache.start()

    root_span_id = "root-123"
    span_id = "span-1"

    cache.queue_write(
        root_span_id,
        span_id,
        CachedSpan(span_id=span_id, metadata={"key1": "value1"}),
    )

    cache.queue_write(
        root_span_id,
        span_id,
        CachedSpan(span_id=span_id, metadata={"key2": "value2"}),
    )

    spans = cache.get_by_root_span_id(root_span_id)
    assert spans is not None
    assert spans[0].metadata == {"key1": "value1", "key2": "value2"}

    cache.stop()
    cache.dispose()


def test_span_cache_has():
    """Test the has() method."""
    cache = SpanCache()
    cache.start()

    cache.queue_write("root-123", "span-1", CachedSpan(span_id="span-1"))
    assert cache.has("root-123") is True
    assert cache.has("nonexistent") is False

    cache.stop()
    cache.dispose()


def test_span_cache_clear():
    """Test clearing spans for a specific rootSpanId."""
    cache = SpanCache()
    cache.start()

    cache.queue_write("root-1", "span-1", CachedSpan(span_id="span-1"))
    cache.queue_write("root-2", "span-2", CachedSpan(span_id="span-2"))

    cache.clear("root-1")

    assert cache.has("root-1") is False
    assert cache.has("root-2") is True

    cache.stop()
    cache.dispose()


def test_span_cache_clear_all():
    """Test clearing all cached spans."""
    cache = SpanCache()
    cache.start()

    cache.queue_write("root-1", "span-1", CachedSpan(span_id="span-1"))
    cache.queue_write("root-2", "span-2", CachedSpan(span_id="span-2"))

    cache.clear_all()

    assert cache.size == 0

    cache.stop()
    cache.dispose()


def test_span_cache_size():
    """Test the size property."""
    cache = SpanCache()
    cache.start()

    assert cache.size == 0

    cache.queue_write("root-1", "span-1", CachedSpan(span_id="span-1"))
    assert cache.size == 1

    cache.queue_write("root-1", "span-2", CachedSpan(span_id="span-2"))  # Same root
    assert cache.size == 1

    cache.queue_write("root-2", "span-3", CachedSpan(span_id="span-3"))  # Different root
    assert cache.size == 2

    cache.stop()
    cache.dispose()


def test_span_cache_dispose():
    """Test that dispose cleans up and allows reuse."""
    cache = SpanCache()
    cache.start()

    cache.queue_write("root-1", "span-1", CachedSpan(span_id="span-1"))
    assert cache.size == 1

    # Stop first to decrement refcount, then dispose
    cache.stop()
    cache.dispose()

    assert cache.size == 0
    assert cache.has("root-1") is False

    # Should be able to write again after dispose (if we start again)
    cache.start()
    cache.queue_write("root-2", "span-2", CachedSpan(span_id="span-2"))
    assert cache.size == 1

    cache.stop()
    cache.dispose()


def test_span_cache_disable():
    """Test that disable() prevents writes."""
    cache = SpanCache()
    cache.start()

    cache.queue_write("root-1", "span-1", CachedSpan(span_id="span-1"))
    assert cache.size == 1

    cache.disable()

    # Writes after disable should be no-ops
    cache.queue_write("root-2", "span-2", CachedSpan(span_id="span-2"))
    assert cache.size == 1  # Still 1, not 2

    cache.stop()
    cache.dispose()


def test_span_cache_disabled_getter():
    """Test the disabled property."""
    # Cache is disabled by default until start() is called
    cache = SpanCache()
    assert cache.disabled is True

    cache.start()
    assert cache.disabled is False

    cache.disable()
    assert cache.disabled is True

    cache.dispose()


def test_span_cache_disabled_from_constructor():
    """Test that cache can be disabled via constructor."""
    cache = SpanCache(disabled=True)
    assert cache.disabled is True

    # Writes should be no-ops
    cache.queue_write("root-1", "span-1", CachedSpan(span_id="span-1"))
    assert cache.size == 0
    assert cache.get_by_root_span_id("root-1") is None

    cache.dispose()


def test_span_cache_start_stop_lifecycle():
    """Test that stop() allows start() to work again."""
    cache = SpanCache()

    # Initially disabled by default
    assert cache.disabled is True

    # Start for first "eval"
    cache.start()
    assert cache.disabled is False
    cache.queue_write("root-1", "span-1", CachedSpan(span_id="span-1"))
    assert cache.size == 1

    # Stop after first "eval"
    cache.stop()
    cache.dispose()
    assert cache.disabled is True

    # Start for second "eval" - should work!
    cache.start()
    assert cache.disabled is False
    cache.queue_write("root-2", "span-2", CachedSpan(span_id="span-2"))
    assert cache.size == 1

    cache.stop()
    cache.dispose()


def test_span_cache_disable_prevents_start():
    """Test that disable() prevents start() from working."""
    cache = SpanCache()

    # Simulate disable being called
    cache.disable()
    assert cache.disabled is True

    # start() should be a no-op after disable()
    cache.start()
    assert cache.disabled is True

    # Writes should still be no-ops
    cache.queue_write("root-1", "span-1", CachedSpan(span_id="span-1"))
    assert cache.size == 0

    cache.dispose()


def test_span_cache_parallel_eval_refcount():
    """Test reference counting for parallel evals."""
    cache = SpanCache()

    # Simulate two evals starting
    cache.start()  # Eval 1
    assert cache.disabled is False

    cache.start()  # Eval 2
    assert cache.disabled is False

    # Write data from both evals
    cache.queue_write("root-1", "span-1", CachedSpan(span_id="span-1"))
    cache.queue_write("root-2", "span-2", CachedSpan(span_id="span-2"))
    assert cache.size == 2

    # Eval 1 finishes first
    cache.dispose()  # Should NOT dispose (refcount = 2)
    cache.stop()  # Decrements to 1

    # Cache should still be enabled and data intact
    assert cache.disabled is False
    assert cache.size == 2
    assert cache.get_by_root_span_id("root-1") is not None
    assert cache.get_by_root_span_id("root-2") is not None

    # Eval 2 finishes
    cache.dispose()  # Should NOT dispose yet (refcount = 1)
    cache.stop()  # Decrements to 0, disables cache

    # Now cache should be disabled
    assert cache.disabled is True

    # Final dispose should now work
    cache.dispose()  # NOW it disposes (refcount = 0)
    assert cache.size == 0


def test_span_cache_refcount_underflow():
    """Test that refcount handles underflow gracefully."""
    cache = SpanCache()

    # Call stop without start
    cache.stop()

    # Should work normally after
    cache.start()
    cache.queue_write("root-1", "span-1", CachedSpan(span_id="span-1"))
    assert cache.size == 1

    cache.stop()
    cache.dispose()
