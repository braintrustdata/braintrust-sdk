"""Tests for Trace functionality."""

import pytest
from braintrust.trace import CachedSpanFetcher, LocalTrace, SpanData


# Helper to create mock spans
def make_span(span_id: str, span_type: str, **extra) -> SpanData:
    return SpanData(
        span_id=span_id,
        input={"text": f"input-{span_id}"},
        output={"text": f"output-{span_id}"},
        span_attributes={"type": span_type},
        **extra,
    )


class TestCachedSpanFetcher:
    """Test CachedSpanFetcher caching behavior."""

    @pytest.mark.asyncio
    async def test_fetch_all_spans_without_filter(self):
        """Test fetching all spans when no filter specified."""
        mock_spans = [
            make_span("span-1", "llm"),
            make_span("span-2", "function"),
            make_span("span-3", "llm"),
        ]

        call_count = 0

        async def fetch_fn(span_type):
            nonlocal call_count
            call_count += 1
            return mock_spans

        fetcher = CachedSpanFetcher(fetch_fn=fetch_fn)
        result = await fetcher.get_spans()

        assert call_count == 1
        assert len(result) == 3
        assert {s.span_id for s in result} == {"span-1", "span-2", "span-3"}

    @pytest.mark.asyncio
    async def test_fetch_specific_span_types(self):
        """Test fetching specific span types when filter specified."""
        llm_spans = [make_span("span-1", "llm"), make_span("span-2", "llm")]

        call_count = 0

        async def fetch_fn(span_type):
            nonlocal call_count
            call_count += 1
            assert span_type == ["llm"]
            return llm_spans

        fetcher = CachedSpanFetcher(fetch_fn=fetch_fn)
        result = await fetcher.get_spans(span_type=["llm"])

        assert call_count == 1
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_return_cached_spans_after_fetching_all(self):
        """Test that cached spans are returned without re-fetching after fetching all."""
        mock_spans = [
            make_span("span-1", "llm"),
            make_span("span-2", "function"),
        ]

        call_count = 0

        async def fetch_fn(span_type):
            nonlocal call_count
            call_count += 1
            return mock_spans

        fetcher = CachedSpanFetcher(fetch_fn=fetch_fn)

        # First call - fetches
        await fetcher.get_spans()
        assert call_count == 1

        # Second call - should use cache
        result = await fetcher.get_spans()
        assert call_count == 1  # Still 1
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_return_cached_spans_for_previously_fetched_types(self):
        """Test that previously fetched types are returned from cache."""
        llm_spans = [make_span("span-1", "llm"), make_span("span-2", "llm")]

        call_count = 0

        async def fetch_fn(span_type):
            nonlocal call_count
            call_count += 1
            return llm_spans

        fetcher = CachedSpanFetcher(fetch_fn=fetch_fn)

        # First call - fetches llm spans
        await fetcher.get_spans(span_type=["llm"])
        assert call_count == 1

        # Second call for same type - should use cache
        result = await fetcher.get_spans(span_type=["llm"])
        assert call_count == 1  # Still 1
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_only_fetch_missing_span_types(self):
        """Test that only missing span types are fetched."""
        llm_spans = [make_span("span-1", "llm")]
        function_spans = [make_span("span-2", "function")]

        call_count = 0

        async def fetch_fn(span_type):
            nonlocal call_count
            call_count += 1
            if span_type == ["llm"]:
                return llm_spans
            elif span_type == ["function"]:
                return function_spans
            return []

        fetcher = CachedSpanFetcher(fetch_fn=fetch_fn)

        # First call - fetches llm spans
        await fetcher.get_spans(span_type=["llm"])
        assert call_count == 1

        # Second call for both types - should only fetch function
        result = await fetcher.get_spans(span_type=["llm", "function"])
        assert call_count == 2
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_no_refetch_after_fetching_all_spans(self):
        """Test that no re-fetching occurs after fetching all spans."""
        all_spans = [
            make_span("span-1", "llm"),
            make_span("span-2", "function"),
            make_span("span-3", "tool"),
        ]

        call_count = 0

        async def fetch_fn(span_type):
            nonlocal call_count
            call_count += 1
            return all_spans

        fetcher = CachedSpanFetcher(fetch_fn=fetch_fn)

        # Fetch all spans
        await fetcher.get_spans()
        assert call_count == 1

        # Subsequent filtered calls should use cache
        llm_result = await fetcher.get_spans(span_type=["llm"])
        assert call_count == 1  # Still 1
        assert len(llm_result) == 1
        assert llm_result[0].span_id == "span-1"

        function_result = await fetcher.get_spans(span_type=["function"])
        assert call_count == 1  # Still 1
        assert len(function_result) == 1
        assert function_result[0].span_id == "span-2"

    @pytest.mark.asyncio
    async def test_filter_by_multiple_span_types_from_cache(self):
        """Test filtering by multiple span types from cache."""
        all_spans = [
            make_span("span-1", "llm"),
            make_span("span-2", "function"),
            make_span("span-3", "tool"),
            make_span("span-4", "llm"),
        ]

        async def fetch_fn(span_type):
            return all_spans

        fetcher = CachedSpanFetcher(fetch_fn=fetch_fn)

        # Fetch all first
        await fetcher.get_spans()

        # Filter for llm and tool
        result = await fetcher.get_spans(span_type=["llm", "tool"])
        assert len(result) == 3
        assert {s.span_id for s in result} == {"span-1", "span-3", "span-4"}

    @pytest.mark.asyncio
    async def test_return_empty_for_nonexistent_span_type(self):
        """Test that empty array is returned for non-existent span type."""
        all_spans = [make_span("span-1", "llm")]

        async def fetch_fn(span_type):
            return all_spans

        fetcher = CachedSpanFetcher(fetch_fn=fetch_fn)

        # Fetch all first
        await fetcher.get_spans()

        # Query for non-existent type
        result = await fetcher.get_spans(span_type=["nonexistent"])
        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_handle_spans_with_no_type(self):
        """Test handling spans without type (empty string type)."""
        spans = [
            make_span("span-1", "llm"),
            SpanData(span_id="span-2", input={}, span_attributes={}),  # No type
            SpanData(span_id="span-3", input={}),  # No span_attributes
        ]

        async def fetch_fn(span_type):
            return spans

        fetcher = CachedSpanFetcher(fetch_fn=fetch_fn)

        # Fetch all
        result = await fetcher.get_spans()
        assert len(result) == 3

        # Spans without type go into "" bucket
        no_type_result = await fetcher.get_spans(span_type=[""])
        assert len(no_type_result) == 2

    @pytest.mark.asyncio
    async def test_handle_empty_results(self):
        """Test handling empty results."""

        async def fetch_fn(span_type):
            return []

        fetcher = CachedSpanFetcher(fetch_fn=fetch_fn)

        result = await fetcher.get_spans()
        assert len(result) == 0

        # Should still mark as fetched
        await fetcher.get_spans(span_type=["llm"])
        # No additional assertions, just making sure it doesn't crash

    @pytest.mark.asyncio
    async def test_handle_empty_span_type_array(self):
        """Test that empty spanType array is handled same as undefined."""
        mock_spans = [make_span("span-1", "llm")]

        call_args = []

        async def fetch_fn(span_type):
            call_args.append(span_type)
            return mock_spans

        fetcher = CachedSpanFetcher(fetch_fn=fetch_fn)

        result = await fetcher.get_spans(span_type=[])

        assert call_args[0] is None or call_args[0] == []
        assert len(result) == 1


class _DummySpanCache:
    def get_by_root_span_id(self, root_span_id: str):
        return None


class _DummyState:
    def __init__(self):
        self.span_cache = _DummySpanCache()

    def login(self):
        return None


class TestLocalTraceGetThread:
    @pytest.mark.asyncio
    async def test_calls_invoke_with_correct_parameters(self, monkeypatch):
        mock_thread = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ]
        calls = []

        def fake_invoke(**kwargs):
            calls.append(kwargs)
            return mock_thread

        monkeypatch.setattr("braintrust.trace.invoke", fake_invoke)

        trace = LocalTrace(
            object_type="experiment",
            object_id="exp-123",
            root_span_id="root-456",
            ensure_spans_flushed=None,
            state=_DummyState(),
        )

        result = await trace.get_thread()

        assert len(calls) == 1
        assert calls[0]["global_function"] == "project_default"
        assert calls[0]["function_type"] == "preprocessor"
        assert calls[0]["mode"] == "json"
        assert calls[0]["input"] == {
            "trace_ref": {
                "object_type": "experiment",
                "object_id": "exp-123",
                "root_span_id": "root-456",
            }
        }
        assert result == mock_thread

    @pytest.mark.asyncio
    async def test_uses_custom_preprocessor(self, monkeypatch):
        calls = []

        def fake_invoke(**kwargs):
            calls.append(kwargs)
            return [{"role": "user", "content": "Test"}]

        monkeypatch.setattr("braintrust.trace.invoke", fake_invoke)

        trace = LocalTrace(
            object_type="project_logs",
            object_id="proj-789",
            root_span_id="root-abc",
            ensure_spans_flushed=None,
            state=_DummyState(),
        )

        await trace.get_thread(options={"preprocessor": "custom_preprocessor"})
        assert calls[0]["global_function"] == "custom_preprocessor"
        assert calls[0]["function_type"] == "preprocessor"

    @pytest.mark.asyncio
    async def test_caches_by_preprocessor(self, monkeypatch):
        call_count = 0

        def fake_invoke(**kwargs):
            nonlocal call_count
            call_count += 1
            if kwargs["global_function"] == "project_default":
                return [{"role": "user", "content": "Default"}]
            return [{"role": "user", "content": "Custom"}]

        monkeypatch.setattr("braintrust.trace.invoke", fake_invoke)

        trace = LocalTrace(
            object_type="experiment",
            object_id="exp-123",
            root_span_id="root-456",
            ensure_spans_flushed=None,
            state=_DummyState(),
        )

        result1 = await trace.get_thread()
        result2 = await trace.get_thread()
        result3 = await trace.get_thread(options={"preprocessor": "custom"})
        result4 = await trace.get_thread()

        assert result1 == [{"role": "user", "content": "Default"}]
        assert result2 == [{"role": "user", "content": "Default"}]
        assert result3 == [{"role": "user", "content": "Custom"}]
        assert result4 == [{"role": "user", "content": "Default"}]
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_returns_empty_array_for_non_array_invoke_result(self, monkeypatch):
        def fake_invoke(**kwargs):
            return "not-an-array"

        monkeypatch.setattr("braintrust.trace.invoke", fake_invoke)

        trace = LocalTrace(
            object_type="experiment",
            object_id="exp-123",
            root_span_id="root-456",
            ensure_spans_flushed=None,
            state=_DummyState(),
        )

        result = await trace.get_thread()
        assert result == []
