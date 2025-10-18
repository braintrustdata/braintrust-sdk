import unittest
from unittest.mock import MagicMock

from braintrust.devserver.cache import LRUCache


class TestDevServerLRUCache(unittest.TestCase):
    def test_store_and_retrieve_values(self):
        """Test storing and retrieving values."""
        cache = LRUCache(max_size=3)
        mock_state = MagicMock()
        cache.set("key1", mock_state)
        self.assertEqual(cache.get("key1"), mock_state)

    def test_return_none_for_missing_keys(self):
        """Test returning None for missing keys."""
        cache = LRUCache()
        self.assertIsNone(cache.get("missing"))

    def test_respect_max_size_evicts_lru(self):
        """Test respecting max size and evicting least recently used."""
        cache = LRUCache(max_size=2)
        state1, state2, state3 = MagicMock(), MagicMock(), MagicMock()

        cache.set("a", state1)
        cache.set("b", state2)
        cache.set("c", state3)  # Should evict "a"

        self.assertIsNone(cache.get("a"))
        self.assertEqual(cache.get("b"), state2)
        self.assertEqual(cache.get("c"), state3)

    def test_access_order_updates_on_get(self):
        """Test that accessing an item moves it to the end (most recently used)."""
        cache = LRUCache(max_size=3)
        state1, state2, state3, state4 = MagicMock(), MagicMock(), MagicMock(), MagicMock()

        cache.set("a", state1)
        cache.set("b", state2)
        cache.set("c", state3)

        # Access "a" to make it most recently used
        self.assertEqual(cache.get("a"), state1)

        # Add "d", should evict "b" (least recently used)
        cache.set("d", state4)

        self.assertEqual(cache.get("a"), state1)  # Still present
        self.assertIsNone(cache.get("b"))  # Evicted
        self.assertEqual(cache.get("c"), state3)
        self.assertEqual(cache.get("d"), state4)

    def test_update_existing_key_maintains_position(self):
        """Test updating an existing key moves it to the end."""
        cache = LRUCache(max_size=3)
        state1, state2, state3, state1_updated = MagicMock(), MagicMock(), MagicMock(), MagicMock()

        cache.set("a", state1)
        cache.set("b", state2)
        cache.set("c", state3)

        # Update "a" with new value
        cache.set("a", state1_updated)

        # Add new item, should evict "b" not "a"
        state4 = MagicMock()
        cache.set("d", state4)

        self.assertEqual(cache.get("a"), state1_updated)
        self.assertIsNone(cache.get("b"))
        self.assertEqual(cache.get("c"), state3)
        self.assertEqual(cache.get("d"), state4)

    def test_cache_with_size_one(self):
        """Test cache behavior with max_size=1."""
        cache = LRUCache(max_size=1)
        state1, state2 = MagicMock(), MagicMock()

        cache.set("a", state1)
        self.assertEqual(cache.get("a"), state1)

        cache.set("b", state2)
        self.assertIsNone(cache.get("a"))
        self.assertEqual(cache.get("b"), state2)

    def test_empty_cache_operations(self):
        """Test operations on empty cache."""
        cache = LRUCache(max_size=5)
        self.assertIsNone(cache.get("any_key"))
        self.assertEqual(len(cache.cache), 0)
        self.assertEqual(len(cache.access_order), 0)

    def test_access_order_consistency(self):
        """Test that access_order list stays consistent with cache dict."""
        cache = LRUCache(max_size=3)
        states = [MagicMock() for _ in range(5)]

        # Add items
        for i, state in enumerate(states[:3]):
            cache.set(f"key{i}", state)

        # Verify consistency
        self.assertEqual(len(cache.cache), len(cache.access_order))
        self.assertEqual(set(cache.cache.keys()), set(cache.access_order))

        # Add more items to trigger evictions
        for i, state in enumerate(states[3:], start=3):
            cache.set(f"key{i}", state)

        # Verify consistency after evictions
        self.assertEqual(len(cache.cache), len(cache.access_order))
        self.assertEqual(set(cache.cache.keys()), set(cache.access_order))
        self.assertEqual(len(cache.cache), cache.max_size)


if __name__ == "__main__":
    unittest.main()
