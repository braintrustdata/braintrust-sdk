import unittest

from braintrust.prompt_cache import lru_cache


class TestLRUCache(unittest.TestCase):
    def test_store_and_retrieve_values(self):
        """Test storing and retrieving values."""
        cache = lru_cache.LRUCache[str, int]()
        cache.set("a", 1)
        self.assertEqual(cache.get("a"), 1)

    def test_raise_keyerror_for_missing_keys(self):
        """Test raising KeyError for missing keys."""
        cache = lru_cache.LRUCache[str, int]()
        with self.assertRaises(KeyError):
            cache.get("missing")

    def test_respect_max_size_when_specified(self):
        """Test respecting max size when specified."""
        cache = lru_cache.LRUCache[str, int](max_size=2)
        cache.set("a", 1)
        cache.set("b", 2)
        cache.set("c", 3)
        with self.assertRaises(KeyError):
            cache.get("a")
        self.assertEqual(cache.get("b"), 2)
        self.assertEqual(cache.get("c"), 3)

    def test_grow_unbounded_when_no_max_size_specified(self):
        """Test growing unbounded when no max size specified."""
        cache = lru_cache.LRUCache[int, int]()
        # Add many items.
        for i in range(1000):
            cache.set(i, i)
        # Should keep all items.
        for i in range(1000):
            self.assertEqual(cache.get(i), i)

    def test_refresh_items_on_get(self):
        """Test refreshing items on get."""
        cache = lru_cache.LRUCache[str, int](max_size=2)
        cache.set("a", 1)
        cache.set("b", 2)
        cache.get("a")  # refresh "a"
        cache.set("c", 3)
        self.assertEqual(cache.get("a"), 1)
        with self.assertRaises(KeyError):
            cache.get("b")
        self.assertEqual(cache.get("c"), 3)

    def test_update_existing_keys(self):
        """Test updating existing keys."""
        cache = lru_cache.LRUCache[str, int]()
        cache.set("a", 1)
        cache.set("a", 2)
        self.assertEqual(cache.get("a"), 2)

    def test_clear_all_items(self):
        """Test clearing all items."""
        cache = lru_cache.LRUCache[str, int]()
        cache.set("a", 1)
        cache.set("b", 2)
        cache.clear()
        with self.assertRaises(KeyError):
            cache.get("a")
        with self.assertRaises(KeyError):
            cache.get("b")


if __name__ == "__main__":
    unittest.main()
