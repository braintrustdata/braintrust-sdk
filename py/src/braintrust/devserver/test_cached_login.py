import asyncio
import unittest
from unittest.mock import MagicMock, patch

from braintrust.devserver import cache


class TestCachedLogin(unittest.TestCase):
    def setUp(self):
        """Clear the cache before each test."""
        cache._login_cache = cache.LRUCache(max_size=32)

    @patch("braintrust.devserver.cache.login_to_state")
    def test_cached_login_caches_results(self, mock_login):
        """Test that cached_login caches and reuses results."""
        mock_state = MagicMock()
        mock_login.return_value = mock_state

        # First call should invoke login_to_state
        result1 = asyncio.run(cache.cached_login("api_key_1", "https://app.braintrust.com"))
        self.assertEqual(result1, mock_state)
        self.assertEqual(mock_login.call_count, 1)

        # Second call with same parameters should use cache
        result2 = asyncio.run(cache.cached_login("api_key_1", "https://app.braintrust.com"))
        self.assertEqual(result2, mock_state)
        self.assertEqual(mock_login.call_count, 1)  # Still 1, not called again

    @patch("braintrust.devserver.cache.login_to_state")
    def test_cached_login_different_keys(self, mock_login):
        """Test that different cache keys create separate entries."""
        mock_state1 = MagicMock()
        mock_state2 = MagicMock()
        mock_state3 = MagicMock()

        mock_login.side_effect = [mock_state1, mock_state2, mock_state3]

        # Different API keys
        result1 = asyncio.run(cache.cached_login("api_key_1", "https://app.braintrust.com"))
        result2 = asyncio.run(cache.cached_login("api_key_2", "https://app.braintrust.com"))

        self.assertEqual(result1, mock_state1)
        self.assertEqual(result2, mock_state2)
        self.assertEqual(mock_login.call_count, 2)

        # Different org_name
        result3 = asyncio.run(cache.cached_login("api_key_1", "https://app.braintrust.com", org_name="org1"))
        self.assertEqual(result3, mock_state3)
        self.assertEqual(mock_login.call_count, 3)

    @patch("braintrust.devserver.cache.login_to_state")
    def test_cached_login_with_org_name(self, mock_login):
        """Test caching with org_name parameter."""
        mock_state = MagicMock()
        mock_login.return_value = mock_state

        # Call with org_name
        result1 = asyncio.run(cache.cached_login("api_key_1", "https://app.braintrust.com", org_name="test_org"))
        self.assertEqual(result1, mock_state)
        self.assertEqual(mock_login.call_count, 1)

        # Same call should use cache
        result2 = asyncio.run(cache.cached_login("api_key_1", "https://app.braintrust.com", org_name="test_org"))
        self.assertEqual(result2, mock_state)
        self.assertEqual(mock_login.call_count, 1)

        # Different org_name should not use cache
        result3 = asyncio.run(cache.cached_login("api_key_1", "https://app.braintrust.com", org_name="other_org"))
        self.assertEqual(mock_login.call_count, 2)

    @patch("braintrust.devserver.cache.login_to_state")
    def test_cached_login_propagates_exceptions(self, mock_login):
        """Test that exceptions from login_to_state are propagated."""
        mock_login.side_effect = ValueError("Invalid API key")

        with self.assertRaises(ValueError) as cm:
            asyncio.run(cache.cached_login("bad_key", "https://app.braintrust.com"))

        self.assertEqual(str(cm.exception), "Invalid API key")

        # Verify exception is not cached - second call should try again
        with self.assertRaises(ValueError):
            asyncio.run(cache.cached_login("bad_key", "https://app.braintrust.com"))

        self.assertEqual(mock_login.call_count, 2)


if __name__ == "__main__":
    unittest.main()
