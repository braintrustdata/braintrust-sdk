"""
A module providing a persistent disk-based cache implementation.

This module contains a generic disk cache that can store serializable objects of any type.
The cache persists entries as compressed files on disk and implements an LRU (Least Recently Used)
eviction policy based on file modification times. It provides thread-safe access to cached items
and handles file system errors gracefully.
"""

import gzip
import hashlib
import json
import logging
import os
from collections.abc import Callable
from typing import Any, Generic, TypeVar

T = TypeVar("T")


log = logging.getLogger(__name__)


class DiskCache(Generic[T]):
    """
    A persistent filesystem-based cache implementation.

    This cache stores entries as compressed files on disk and implements an LRU eviction
    policy based on file modification times (mtime). While access times (atime) would be more
    semantically accurate for LRU, we use mtime because:

    1. Many modern filesystems mount with noatime for performance reasons.
    2. Even when atime updates are enabled, they may be subject to update delays.
    3. mtime updates are more reliably supported across different filesystems.
    """

    def __init__(
        self,
        cache_dir: str,
        max_size: int | None = None,
        serializer: Callable[[T], Any] | None = None,
        deserializer: Callable[[Any], T] | None = None,
        log_warnings: bool = True,
        mkdirs: bool = True,
    ):
        """
        Creates a new DiskCache instance.

        Args:
            cache_dir: Directory where cache files will be stored.
            max_size: Maximum number of entries to store in the cache.
                     If not specified, the cache will grow unbounded.
            serializer: Optional function to convert values to JSON-serializable format.
            deserializer: Optional function to convert JSON-deserialized data back to original type.
                         Should be the inverse of serializer.

        Example:
            # Create a cache for PromptSchema objects using its serialization methods.
            cache = DiskCache[PromptSchema](
                cache_dir="cache",
                serializer=lambda x: x.as_dict(),
                deserializer=PromptSchema.from_dict_deep
            )
        """
        self._dir = cache_dir
        self._max_size = max_size
        self._serializer = serializer
        self._deserializer = deserializer
        self._log_warnings = log_warnings
        self._mkdirs = mkdirs

    def _get_entry_path(self, key: str) -> str:
        """Gets the file path for a cache entry."""
        k = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return os.path.join(self._dir, k)

    def get(self, key: str) -> T:
        """
        Retrieves a value from the cache.
        Updates the entry's access time when read.

        Args:
            key: The key to look up in the cache.

        Returns:
            The cached value.

        Raises:
            KeyError: If the key is not found in the cache.
            RuntimeError: If there is an error reading from the disk cache.
        """
        try:
            file_path = self._get_entry_path(key)
            with gzip.open(file_path, "rb") as f:
                data = json.loads(f.read().decode("utf-8"))
                if self._deserializer is not None:
                    data = self._deserializer(data)

            # Update both access and modification times.
            os.utime(file_path, None)
            return data
        except FileNotFoundError:
            raise KeyError(f"Cache key not found: {key}")
        except Exception as e:
            # if we have any other error, it's unexpected, but we won't want to crash an app,
            # so log and treat it like a cache miss.
            if self._log_warnings:
                log.warning(f"Unexpected error reading from disk cache: {e}")
            raise KeyError(f"Cache key not found: {key}") from e

    def set(self, key: str, value: T) -> None:
        """
        Stores a value in the cache.
        If the cache is at its maximum size, the least recently used entries will be evicted.

        Args:
            key: The key to store the value under.
            value: The value to store in the cache.

        Raises:
            RuntimeError: If there is an error writing to the disk cache.
        """
        try:
            # mkdirs exists only to make it easy to simulate cross-platform write errors
            # (permissions, etc wouldn't work on github actions on windows)
            if self._mkdirs:
                os.makedirs(self._dir, exist_ok=True)
            file_path = self._get_entry_path(key)

            with gzip.open(file_path, "wb") as f:
                if self._serializer is not None:
                    value = self._serializer(value)
                f.write(json.dumps(value).encode("utf-8"))

            self._evict_if_full()
        except Exception as e:
            # Swallow any cache write errors. Don't crash the app.
            if self._log_warnings:
                log.warning(f"Failed to write to disk cache: {e}")

    def _evict_if_full(self):
        if self._max_size is None or self._max_size <= 0:
            return None

        paths = [os.path.join(self._dir, f) for f in os.listdir(self._dir)]
        if not paths or len(paths) <= self._max_size:
            return

        stats = [(p, os.path.getmtime(p)) for p in paths]
        stats.sort(key=lambda x: x[1])
        oldest_paths = stats[0 : len(stats) - self._max_size]

        for path in oldest_paths:
            os.unlink(path[0])
