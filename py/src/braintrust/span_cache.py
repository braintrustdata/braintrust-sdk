"""
SpanCache provides a disk-based cache for span data, allowing
scorers to read spans without making server round-trips when possible.

Spans are stored on disk to minimize memory usage during evaluations.
The cache file is automatically cleaned up when dispose() is called.
"""

import atexit
import json
import os
import tempfile
import uuid
from typing import Any, Optional

from braintrust.util import merge_dicts

# Global registry of active span caches for process exit cleanup
_active_caches: set["SpanCache"] = set()
_exit_handlers_registered = False


class CachedSpan:
    """Cached span data structure."""

    def __init__(
        self,
        span_id: str,
        input: Optional[Any] = None,
        output: Optional[Any] = None,
        metadata: Optional[dict[str, Any]] = None,
        span_parents: Optional[list[str]] = None,
        span_attributes: Optional[dict[str, Any]] = None,
    ):
        self.span_id = span_id
        self.input = input
        self.output = output
        self.metadata = metadata
        self.span_parents = span_parents
        self.span_attributes = span_attributes

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        result = {"span_id": self.span_id}
        if self.input is not None:
            result["input"] = self.input
        if self.output is not None:
            result["output"] = self.output
        if self.metadata is not None:
            result["metadata"] = self.metadata
        if self.span_parents is not None:
            result["span_parents"] = self.span_parents
        if self.span_attributes is not None:
            result["span_attributes"] = self.span_attributes
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CachedSpan":
        """Create from dictionary."""
        return cls(
            span_id=data["span_id"],
            input=data.get("input"),
            output=data.get("output"),
            metadata=data.get("metadata"),
            span_parents=data.get("span_parents"),
            span_attributes=data.get("span_attributes"),
        )


class DiskSpanRecord:
    """Record structure for disk storage."""

    def __init__(self, root_span_id: str, span_id: str, data: CachedSpan):
        self.root_span_id = root_span_id
        self.span_id = span_id
        self.data = data

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "rootSpanId": self.root_span_id,
            "spanId": self.span_id,
            "data": self.data.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DiskSpanRecord":
        """Create from dictionary."""
        return cls(
            root_span_id=data["rootSpanId"],
            span_id=data["spanId"],
            data=CachedSpan.from_dict(data["data"]),
        )


class SpanCache:
    """
    Disk-based cache for span data, keyed by rootSpanId.

    This cache writes spans to a temporary file to minimize memory usage.
    It uses append-only writes and reads the full file when querying.
    """

    def __init__(self, disabled: bool = False):
        self._cache_file_path: Optional[str] = None
        self._initialized = False
        # Tracks whether the cache was explicitly disabled (via constructor or disable())
        self._explicitly_disabled = disabled
        # Tracks whether the cache has been enabled (for evals only)
        self._enabled = False
        # Reference count of active evals using this cache
        self._active_eval_count = 0
        # Small in-memory index tracking which rootSpanIds have data
        self._root_span_index: set[str] = set()
        # Buffer for pending writes
        self._write_buffer: list[DiskSpanRecord] = []

    def disable(self) -> None:
        """
        Disable the cache at runtime. This is called automatically when
        OTEL is registered, since OTEL spans won't be in the cache.
        """
        self._explicitly_disabled = True

    def start(self) -> None:
        """
        Start caching spans for use during evaluations.
        This only starts caching if the cache wasn't permanently disabled.
        Called by Eval() to turn on caching for the duration of the eval.
        Uses reference counting to support parallel evals.
        """
        if not self._explicitly_disabled:
            self._enabled = True
            self._active_eval_count += 1

    def stop(self) -> None:
        """
        Stop caching spans and return to the default disabled state.
        Unlike disable(), this allows start() to work again for future evals.
        Called after an eval completes to return to the default state.
        Uses reference counting - only disables when all evals are complete.
        """
        self._active_eval_count -= 1
        if self._active_eval_count <= 0:
            self._active_eval_count = 0
            self._enabled = False

    @property
    def disabled(self) -> bool:
        """Check if cache is disabled."""
        return self._explicitly_disabled or not self._enabled

    def _ensure_initialized(self) -> None:
        """Initialize the cache file if not already done."""
        if self.disabled or self._initialized:
            return

        try:
            # Create temporary file
            unique_id = f"{int(os.times().elapsed * 1000000)}-{uuid.uuid4().hex[:8]}"
            self._cache_file_path = os.path.join(tempfile.gettempdir(), f"braintrust-span-cache-{unique_id}.jsonl")

            # Create the file
            with open(self._cache_file_path, "w") as f:
                pass

            self._initialized = True
            self._register_exit_handler()
        except Exception:
            # Silently fail if filesystem is unavailable - cache is best-effort
            # This can happen if temp directory is not writable or disk is full
            self._explicitly_disabled = True
            return

    def _register_exit_handler(self) -> None:
        """Register a handler to clean up the temp file on process exit."""
        global _exit_handlers_registered
        _active_caches.add(self)

        if not _exit_handlers_registered:
            _exit_handlers_registered = True

            def cleanup_all_caches():
                """Clean up all active caches."""
                for cache in _active_caches:
                    if cache._cache_file_path and os.path.exists(cache._cache_file_path):
                        try:
                            os.unlink(cache._cache_file_path)
                        except Exception:
                            # Ignore cleanup errors - file might not exist or already deleted
                            pass

            atexit.register(cleanup_all_caches)

    def queue_write(self, root_span_id: str, span_id: str, data: CachedSpan) -> None:
        """
        Write a span to the cache.
        In Python, we write synchronously (no async queue like in TS).
        """
        if self.disabled:
            return

        self._ensure_initialized()

        record = DiskSpanRecord(root_span_id, span_id, data)
        self._write_buffer.append(record)
        self._root_span_index.add(root_span_id)

        # Write to disk immediately (simplified compared to TS async version)
        self._flush_write_buffer()

    def _flush_write_buffer(self) -> None:
        """Flush the write buffer to disk."""
        if not self._write_buffer or not self._cache_file_path:
            return

        try:
            with open(self._cache_file_path, "a") as f:
                for record in self._write_buffer:
                    f.write(json.dumps(record.to_dict()) + "\n")
            self._write_buffer.clear()
        except Exception:
            # Silently fail if write fails - cache is best-effort
            # This can happen if disk is full or file permissions changed
            pass

    def get_by_root_span_id(self, root_span_id: str) -> Optional[list[CachedSpan]]:
        """
        Get all cached spans for a given rootSpanId.

        This reads the file and merges all records for the given rootSpanId.

        Args:
            root_span_id: The root span ID to look up

        Returns:
            List of cached spans, or None if not in cache
        """
        if self.disabled:
            return None

        # Quick check using in-memory index
        if root_span_id not in self._root_span_index:
            return None

        # Accumulate spans by spanId, merging updates
        span_map: dict[str, dict[str, Any]] = {}

        # Read from disk if initialized
        if self._initialized and self._cache_file_path and os.path.exists(self._cache_file_path):
            try:
                with open(self._cache_file_path, "r") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            record_dict = json.loads(line)
                            record = DiskSpanRecord.from_dict(record_dict)
                            if record.root_span_id != root_span_id:
                                continue

                            if record.span_id in span_map:
                                merge_dicts(span_map[record.span_id], record.data.to_dict())
                            else:
                                span_map[record.span_id] = record.data.to_dict()
                        except Exception:
                            # Skip malformed lines - may occur if file was corrupted or truncated
                            pass
            except Exception:
                # Continue to check buffer even if disk read fails
                # This can happen if file was deleted or permissions changed
                pass

        # Also check the in-memory write buffer for unflushed data
        for record in self._write_buffer:
            if record.root_span_id != root_span_id:
                continue
            if record.span_id in span_map:
                merge_dicts(span_map[record.span_id], record.data.to_dict())
            else:
                span_map[record.span_id] = record.data.to_dict()

        if not span_map:
            return None

        return [CachedSpan.from_dict(data) for data in span_map.values()]

    def has(self, root_span_id: str) -> bool:
        """Check if a rootSpanId has cached data."""
        if self.disabled:
            return False
        return root_span_id in self._root_span_index

    def clear(self, root_span_id: str) -> None:
        """
        Clear all cached spans for a given rootSpanId.
        Note: This only removes from the index. The data remains in the file
        but will be ignored on reads.
        """
        self._root_span_index.discard(root_span_id)

    def clear_all(self) -> None:
        """Clear all cached data and remove the cache file."""
        self._root_span_index.clear()
        self.dispose()

    @property
    def size(self) -> int:
        """Get the number of root spans currently tracked."""
        return len(self._root_span_index)

    def dispose(self) -> None:
        """
        Clean up the cache file. Call this when the eval is complete.
        Only performs cleanup when all active evals have completed (refcount = 0).
        """
        # Only dispose if no active evals are using this cache
        if self._active_eval_count > 0:
            return

        # Remove from global registry
        _active_caches.discard(self)

        # Clear pending writes
        self._write_buffer.clear()

        if self._cache_file_path and os.path.exists(self._cache_file_path):
            try:
                os.unlink(self._cache_file_path)
            except Exception:
                # Ignore cleanup errors - file might not exist or already deleted
                pass
            self._cache_file_path = None

        self._initialized = False
        self._root_span_index.clear()
