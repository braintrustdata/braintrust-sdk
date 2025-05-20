"""
This module implements a two-layer caching system for Braintrust prompts.

The caching system consists of:
1. A fast in-memory LRU cache for frequently accessed prompts
2. A persistent disk-based cache that serves as a backing store

This allows for efficient prompt retrieval while maintaining persistence across sessions.
The cache is keyed by project identifier (ID or name), prompt slug, and version.
"""

from typing import Optional

from braintrust import prompt
from braintrust.prompt_cache import disk_cache, lru_cache


def _create_cache_key(project_id: Optional[str], project_name: Optional[str], slug: str, version: str) -> str:
    """Creates a unique cache key from project identifier, slug and version."""
    prefix = project_id or project_name
    if not prefix:
        raise ValueError("Either project_id or project_name must be provided")
    return f"{prefix}:{slug}:{version}"


class PromptCache:
    """
    A two-layer cache for Braintrust prompts with both in-memory and filesystem storage.

    This cache implements either a one or two-layer caching strategy:
    1. A fast in-memory LRU cache for frequently accessed prompts.
    2. An optional persistent filesystem-based cache that serves as a backing store.
    """

    def __init__(
        self,
        memory_cache: lru_cache.LRUCache[str, prompt.PromptSchema],
        disk_cache: Optional[disk_cache.DiskCache[prompt.PromptSchema]] = None,
    ):
        """
        Initialize the prompt cache.

        Args:
            memory_cache: The memory cache to use.
            disk_cache: Optional disk cache to use as backing store.
        """
        self.memory_cache = memory_cache
        self.disk_cache = disk_cache

    def get(
        self, slug: str, version: str, project_id: Optional[str] = None, project_name: Optional[str] = None
    ) -> prompt.PromptSchema:
        """
        Retrieve a prompt from the cache.

        Args:
            slug: The unique identifier for the prompt within its project.
            version: The version of the prompt.
            project_id: The ID of the project containing the prompt.
            project_name: The name of the project containing the prompt.

        Returns:
            The cached Prompt object.

        Raises:
            ValueError: If neither project_id nor project_name is provided.
            KeyError: If the prompt is not found in the cache.
        """
        cache_key = _create_cache_key(project_id, project_name, slug, version)

        # First check memory cache.
        try:
            return self.memory_cache.get(cache_key)
        except KeyError:
            pass

        # If not in memory and disk cache exists, check disk cache.
        if self.disk_cache:
            prompt = self.disk_cache.get(cache_key)
            if prompt is None:
                raise KeyError(f"Prompt not found in cache: {cache_key}")

            # Store in memory cache.
            self.memory_cache.set(cache_key, prompt)
            return prompt

        raise KeyError(f"Prompt not found in cache: {cache_key}")

    def set(
        self,
        slug: str,
        version: str,
        value: prompt.PromptSchema,
        project_id: Optional[str] = None,
        project_name: Optional[str] = None,
    ) -> None:
        """
        Store a prompt in the cache.

        Args:
            slug: The unique identifier for the prompt within its project.
            version: The version of the prompt.
            value: The Prompt object to store.
            project_id: The ID of the project containing the prompt.
            project_name: The name of the project containing the prompt.

        Raises:
            ValueError: If neither project_id nor project_name is provided.
            RuntimeError: If there is an error writing to the disk cache.
        """
        cache_key = _create_cache_key(project_id, project_name, slug, version)

        # Update memory cache.
        self.memory_cache.set(cache_key, value)

        # Update disk cache if available.
        if self.disk_cache:
            self.disk_cache.set(cache_key, value)
