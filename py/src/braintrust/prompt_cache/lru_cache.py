"""
A module providing an LRU (Least Recently Used) cache implementation.

This module contains a generic LRU cache that can store key-value pairs of any type.
The cache maintains items in order of use and can optionally evict least recently
used items when it reaches a maximum size. The implementation uses an OrderedDict
for O(1) access and update operations.
"""

from typing import Generic, Optional, OrderedDict, TypeVar

K = TypeVar("K")
V = TypeVar("V")


class LRUCache(Generic[K, V]):
    """
    A Least Recently Used (LRU) cache implementation.

    This cache maintains items in order of use, evicting the least recently used item
    when the cache reaches its maximum size (if specified). Items are considered "used"
    when they are either added to the cache or retrieved from it.

    If no maximum size is specified, the cache will grow unbounded.

    Args:
        max_size: Maximum number of items to store in the cache.
                 If not specified, the cache will grow unbounded.
    """

    def __init__(self, max_size: Optional[int] = None):
        self._cache: OrderedDict[K, V] = OrderedDict()
        self._max_size = max_size

    def get(self, key: K) -> V:
        """
        Retrieves a value from the cache.
        If the key exists, the item is marked as most recently used.

        Args:
            key: The key to look up.

        Returns:
            The cached value.

        Raises:
            KeyError: If the key is not found in the cache.
        """
        if key not in self._cache:
            raise KeyError(f"Cache key not found: {key}")

        # Refresh key by moving to end of OrderedDict.
        value = self._cache.pop(key)
        self._cache[key] = value
        return value

    def set(self, key: K, value: V) -> None:
        """
        Stores a value in the cache.
        If the key already exists, the value is updated and marked as most recently used.
        If the cache is at its maximum size, the least recently used item is evicted.

        Args:
            key: The key to store.
            value: The value to store.
        """
        if key in self._cache:
            self._cache.pop(key)
        elif self._max_size and len(self._cache) >= self._max_size:
            # Remove oldest item (first item in ordered dict).
            self._cache.popitem(last=False)

        self._cache[key] = value

    def clear(self) -> None:
        """Removes all items from the cache."""
        self._cache.clear()
