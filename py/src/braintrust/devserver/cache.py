"""LRU cache implementation for the dev server."""

import json

from ..logger import BraintrustState, login_to_state


class LRUCache:
    """Simple LRU (Least Recently Used) cache implementation."""

    def __init__(self, max_size: int = 32):
        self.max_size = max_size
        self.cache: dict[str, BraintrustState] = {}
        self.access_order: list[str] = []

    def get(self, key: str) -> BraintrustState | None:
        """Get a value from the cache, updating access order."""
        if key in self.cache:
            # Move to end to mark as recently used
            self.access_order.remove(key)
            self.access_order.append(key)
            return self.cache[key]
        return None

    def set(self, key: str, value: BraintrustState) -> None:
        """Set a value in the cache, evicting LRU item if needed."""
        if key in self.cache:
            # Update existing and move to end
            self.access_order.remove(key)
        elif len(self.cache) >= self.max_size:
            # Remove least recently used
            lru_key = self.access_order.pop(0)
            del self.cache[lru_key]

        self.cache[key] = value
        self.access_order.append(key)


# Global login cache
_login_cache = LRUCache(max_size=32)  # TODO: Make this configurable


async def cached_login(api_key: str, app_url: str, org_name: str | None = None) -> BraintrustState:
    """Login with caching to avoid repeated API calls."""
    cache_key = json.dumps({"api_key": api_key, "app_url": app_url, "org_name": org_name})

    cached = _login_cache.get(cache_key)
    if cached:
        return cached

    state = login_to_state(api_key=api_key, app_url=app_url, org_name=org_name)
    _login_cache.set(cache_key, state)
    return state
