"""
Trace objects for accessing spans in evaluations.

This module provides the LocalTrace class which allows scorers to access
spans from the current evaluation task without making server round-trips.
"""

import asyncio
from typing import Any, Awaitable, Callable, Optional, Protocol

from braintrust.logger import BraintrustState, ObjectFetcher


class SpanData:
    """Span data returned by get_spans()."""

    def __init__(
        self,
        input: Optional[Any] = None,
        output: Optional[Any] = None,
        metadata: Optional[dict[str, Any]] = None,
        span_id: Optional[str] = None,
        span_parents: Optional[list[str]] = None,
        span_attributes: Optional[dict[str, Any]] = None,
        **kwargs: Any,
    ):
        self.input = input
        self.output = output
        self.metadata = metadata
        self.span_id = span_id
        self.span_parents = span_parents
        self.span_attributes = span_attributes
        # Store any additional fields
        for key, value in kwargs.items():
            setattr(self, key, value)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SpanData":
        """Create SpanData from a dictionary."""
        return cls(**data)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        result = {}
        for key, value in self.__dict__.items():
            if value is not None:
                result[key] = value
        return result


class SpanFetcher(ObjectFetcher[dict[str, Any]]):
    """
    Fetcher for spans by root_span_id, using the ObjectFetcher pattern.
    Handles pagination automatically via cursor-based iteration.
    """

    def __init__(
        self,
        object_type: str,  # Literal["experiment", "project_logs", "playground_logs"]
        object_id: str,
        root_span_id: str,
        state: BraintrustState,
        span_type_filter: Optional[list[str]] = None,
    ):
        # Build the filter expression for root_span_id and optionally span_attributes.type
        filter_expr = self._build_filter(root_span_id, span_type_filter)

        super().__init__(
            object_type=object_type,
            _internal_btql={"filter": filter_expr},
        )
        self._object_id = object_id
        self._state = state

    @staticmethod
    def _build_filter(root_span_id: str, span_type_filter: Optional[list[str]] = None) -> dict[str, Any]:
        """Build BTQL filter expression."""
        children = [
            # Base filter: root_span_id = 'value'
            {
                "op": "eq",
                "left": {"op": "ident", "name": ["root_span_id"]},
                "right": {"op": "literal", "value": root_span_id},
            },
            # Exclude span_attributes.purpose = 'scorer'
            {
                "op": "or",
                "children": [
                    {
                        "op": "isnull",
                        "expr": {"op": "ident", "name": ["span_attributes", "purpose"]},
                    },
                    {
                        "op": "ne",
                        "left": {"op": "ident", "name": ["span_attributes", "purpose"]},
                        "right": {"op": "literal", "value": "scorer"},
                    },
                ],
            },
        ]

        # If span type filter specified, add it
        if span_type_filter and len(span_type_filter) > 0:
            children.append(
                {
                    "op": "in",
                    "left": {"op": "ident", "name": ["span_attributes", "type"]},
                    "right": {"op": "literal", "value": span_type_filter},
                }
            )

        return {"op": "and", "children": children}

    @property
    def id(self) -> str:
        return self._object_id

    def _get_state(self) -> BraintrustState:
        return self._state


SpanFetchFn = Callable[[Optional[list[str]]], Awaitable[list[SpanData]]]


class CachedSpanFetcher:
    """
    Cached span fetcher that handles fetching and caching spans by type.

    Caching strategy:
    - Cache spans by span type (dict[spanType, list[SpanData]])
    - Track if all spans have been fetched (all_fetched flag)
    - When filtering by spanType, only fetch types not already in cache
    """

    def __init__(
        self,
        object_type: Optional[str] = None,  # Literal["experiment", "project_logs", "playground_logs"]
        object_id: Optional[str] = None,
        root_span_id: Optional[str] = None,
        get_state: Optional[Callable[[], Awaitable[BraintrustState]]] = None,
        fetch_fn: Optional[SpanFetchFn] = None,
    ):
        self._span_cache: dict[str, list[SpanData]] = {}
        self._all_fetched = False

        if fetch_fn is not None:
            # Direct fetch function injection (for testing)
            self._fetch_fn = fetch_fn
        else:
            # Standard constructor with SpanFetcher
            if object_type is None or object_id is None or root_span_id is None or get_state is None:
                raise ValueError("Must provide either fetch_fn or all of object_type, object_id, root_span_id, get_state")

            async def _fetch_fn(span_type: Optional[list[str]]) -> list[SpanData]:
                state = await get_state()
                fetcher = SpanFetcher(
                    object_type=object_type,
                    object_id=object_id,
                    root_span_id=root_span_id,
                    state=state,
                    span_type_filter=span_type,
                )
                rows = list(fetcher.fetch())
                # Filter out scorer spans
                filtered = [
                    row
                    for row in rows
                    if not (
                        isinstance(row.get("span_attributes"), dict)
                        and row.get("span_attributes", {}).get("purpose") == "scorer"
                    )
                ]
                return [
                    SpanData(
                        input=row.get("input"),
                        output=row.get("output"),
                        metadata=row.get("metadata"),
                        span_id=row.get("span_id"),
                        span_parents=row.get("span_parents"),
                        span_attributes=row.get("span_attributes"),
                        id=row.get("id"),
                        _xact_id=row.get("_xact_id"),
                        _pagination_key=row.get("_pagination_key"),
                        root_span_id=row.get("root_span_id"),
                    )
                    for row in filtered
                ]

            self._fetch_fn = _fetch_fn

    async def get_spans(self, span_type: Optional[list[str]] = None) -> list[SpanData]:
        """
        Get spans, using cache when possible.

        Args:
            span_type: Optional list of span types to filter by

        Returns:
            List of matching spans
        """
        # If we've fetched all spans, just filter from cache
        if self._all_fetched:
            return self._get_from_cache(span_type)

        # If no filter requested, fetch everything
        if not span_type or len(span_type) == 0:
            await self._fetch_spans(None)
            self._all_fetched = True
            return self._get_from_cache(None)

        # Find which spanTypes we don't have in cache yet
        missing_types = [t for t in span_type if t not in self._span_cache]

        # If all requested types are cached, return from cache
        if not missing_types:
            return self._get_from_cache(span_type)

        # Fetch only the missing types
        await self._fetch_spans(missing_types)
        return self._get_from_cache(span_type)

    async def _fetch_spans(self, span_type: Optional[list[str]]) -> None:
        """Fetch spans from the server."""
        spans = await self._fetch_fn(span_type)

        for span in spans:
            span_attrs = span.span_attributes or {}
            span_type_str = span_attrs.get("type", "")
            if span_type_str not in self._span_cache:
                self._span_cache[span_type_str] = []
            self._span_cache[span_type_str].append(span)

    def _get_from_cache(self, span_type: Optional[list[str]]) -> list[SpanData]:
        """Get spans from cache, optionally filtering by type."""
        if not span_type or len(span_type) == 0:
            # Return all spans
            result = []
            for spans in self._span_cache.values():
                result.extend(spans)
            return result

        # Return only requested types
        result = []
        for type_str in span_type:
            if type_str in self._span_cache:
                result.extend(self._span_cache[type_str])
        return result


class Trace(Protocol):
    """
    Interface for trace objects that can be used by scorers.
    Both the SDK's LocalTrace class and the API wrapper's WrapperTrace implement this.
    """

    def get_configuration(self) -> dict[str, str]:
        """Get the trace configuration (object_type, object_id, root_span_id)."""
        ...

    async def get_spans(self, span_type: Optional[list[str]] = None) -> list[SpanData]:
        """
        Fetch all spans for this root span.

        Args:
            span_type: Optional list of span types to filter by

        Returns:
            List of matching spans
        """
        ...


class LocalTrace(dict):
    """
    SDK implementation of Trace that uses local span cache and falls back to BTQL.
    Carries identifying information about the evaluation so scorers can perform
    richer logging or side effects.

    Inherits from dict so that it serializes to {"trace_ref": {...}} when passed
    to json.dumps(). This allows LocalTrace to be transparently serialized when
    passed through invoke() or other JSON-serializing code paths.
    """

    def __init__(
        self,
        object_type: str,  # Literal["experiment", "project_logs", "playground_logs"]
        object_id: str,
        root_span_id: str,
        ensure_spans_flushed: Optional[Callable[[], Awaitable[None]]],
        state: BraintrustState,
    ):
        # Initialize dict with trace_ref for JSON serialization
        super().__init__({
            "trace_ref": {
                "object_type": object_type,
                "object_id": object_id,
                "root_span_id": root_span_id,
            }
        })

        self._object_type = object_type
        self._object_id = object_id
        self._root_span_id = root_span_id
        self._ensure_spans_flushed = ensure_spans_flushed
        self._state = state
        self._spans_flushed = False
        self._spans_flush_promise: Optional[asyncio.Task[None]] = None

        async def get_state() -> BraintrustState:
            await self._ensure_spans_ready()
            # Ensure state is logged in
            await asyncio.get_event_loop().run_in_executor(None, lambda: state.login())
            return state

        self._cached_fetcher = CachedSpanFetcher(
            object_type=object_type,
            object_id=object_id,
            root_span_id=root_span_id,
            get_state=get_state,
        )

    def get_configuration(self) -> dict[str, str]:
        """Get the trace configuration."""
        return {
            "object_type": self._object_type,
            "object_id": self._object_id,
            "root_span_id": self._root_span_id,
        }

    async def get_spans(self, span_type: Optional[list[str]] = None) -> list[SpanData]:
        """
        Fetch all rows for this root span from its parent object (experiment or project logs).
        First checks the local span cache for recently logged spans, then falls
        back to CachedSpanFetcher which handles BTQL fetching and caching.

        Args:
            span_type: Optional list of span types to filter by

        Returns:
            List of matching spans
        """
        # Try local span cache first (for recently logged spans not yet flushed)
        cached_spans = self._state.span_cache.get_by_root_span_id(self._root_span_id)
        if cached_spans and len(cached_spans) > 0:
            # Filter by purpose
            spans = [span for span in cached_spans if not (span.span_attributes or {}).get("purpose") == "scorer"]

            # Filter by span type if requested
            if span_type and len(span_type) > 0:
                spans = [span for span in spans if (span.span_attributes or {}).get("type", "") in span_type]

            # Convert to SpanData
            return [
                SpanData(
                    input=span.input,
                    output=span.output,
                    metadata=span.metadata,
                    span_id=span.span_id,
                    span_parents=span.span_parents,
                    span_attributes=span.span_attributes,
                )
                for span in spans
            ]

        # Fall back to CachedSpanFetcher for BTQL fetching with caching
        return await self._cached_fetcher.get_spans(span_type)

    async def _ensure_spans_ready(self) -> None:
        """Ensure spans are flushed before fetching."""
        if self._spans_flushed or not self._ensure_spans_flushed:
            return

        if self._spans_flush_promise is None:

            async def flush_and_mark():
                try:
                    await self._ensure_spans_flushed()
                    self._spans_flushed = True
                except Exception as err:
                    self._spans_flush_promise = None
                    raise err

            self._spans_flush_promise = asyncio.create_task(flush_and_mark())

        await self._spans_flush_promise
