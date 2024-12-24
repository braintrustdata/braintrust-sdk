import gzip
import json
import os
import sys
from typing import Optional

from .lru_cache import LRUCache
from .prompt import PromptSchema


def _create_cache_key(project_id: Optional[str], project_name: Optional[str], slug: str, version: str) -> str:
    """Creates a unique cache key from project identifier, slug and version."""
    prefix = project_id or project_name
    if not prefix:
        raise ValueError("Either project_id or project_name must be provided")
    return f"{prefix}:{slug}:{version}"


class PromptCache:
    """
    A two-layer cache for Braintrust prompts with both in-memory and filesystem storage.

    This cache implements a two-layer caching strategy:
    1. A fast in-memory LRU cache for frequently accessed prompts
    2. A persistent filesystem-based cache that serves as a backing store

    When retrieving a prompt, the cache first checks the in-memory store. On a miss,
    it falls back to the filesystem cache and populates the memory cache with the result.
    When storing a prompt, it is written to both caches simultaneously.

    The filesystem cache manages entries using an LRU (Least Recently Used) eviction policy
    based on file modification times (mtime). While access times (atime) would be more
    semantically accurate for LRU, we use mtime because:

    1. Many modern filesystems mount with noatime for performance reasons, which disables
       atime updates entirely
    2. Even when atime updates are enabled, they may be subject to update delays or
       restrictions (e.g. relatime mount option)
    3. mtime updates are more reliably supported across different filesystems and OS configurations

    Both caches automatically evict old entries when they exceed their configured maximum sizes.
    """

    def __init__(self, cache_dir: str, max_size: Optional[int] = None, memory_cache_max_size: Optional[int] = None):
        """
        Initialize the prompt cache.

        Args:
            cache_dir: Directory to store cached files.
            max_size: Maximum number of files in disk cache.
            memory_cache_max: Maximum number of entries in memory cache.
        """
        self.dir = cache_dir
        self.max_size = max_size
        self.memory_cache = LRUCache[str, PromptSchema](max_size=memory_cache_max_size)

    def _get_entry_path(self, name: str) -> str:
        """Gets the file path for the disk cache entry for a given entry name."""
        return os.path.join(self.dir, name)

    def get(
        self, slug: str, version: str, project_id: Optional[str] = None, project_name: Optional[str] = None
    ) -> PromptSchema:
        """
        Retrieve a prompt from the cache.

        Args:
            slug: The unique identifier for the prompt within its project
            version: The version of the prompt
            project_id: The ID of the project containing the prompt
            project_name: The name of the project containing the prompt

        Returns:
            The cached Prompt object

        Raises:
            ValueError: If neither project_id nor project_name is provided
            KeyError: If the prompt is not found in the cache
        """
        cache_key = _create_cache_key(project_id, project_name, slug, version)

        # First check memory cache.
        try:
            return self.memory_cache.get(cache_key)
        except KeyError:
            pass

        # If not in memory, check disk cache.
        try:
            file_path = self._get_entry_path(cache_key)
            with gzip.open(file_path, "rb") as f:
                prompt_dict = json.loads(f.read().decode("utf-8"))

            # Update access and modification times
            os.utime(file_path, None)

            prompt = PromptSchema.from_dict_deep(prompt_dict)

            # Store in memory cache
            self.memory_cache.set(cache_key, prompt)

            return prompt
        except (FileNotFoundError, OSError) as e:
            raise KeyError(f"Prompt not found in cache: {cache_key}") from e
        except Exception as e:
            raise RuntimeError(f"Failed to read from prompt cache: {e}") from e

    def set(
        self,
        slug: str,
        version: str,
        value: PromptSchema,
        project_id: Optional[str] = None,
        project_name: Optional[str] = None,
    ) -> None:
        """
        Store a prompt in the cache.

        Args:
            slug: The unique identifier for the prompt within its project
            value: The Prompt object to store
            version: The version of the prompt
            project_id: The ID of the project containing the prompt
            project_name: The name of the project containing the prompt

        Raises:
            ValueError: If neither project_id nor project_name is provided
        """
        cache_key = _create_cache_key(project_id, project_name, slug, version)

        # Update memory cache.
        self.memory_cache.set(cache_key, value)

        try:
            # Update disk cache.
            os.makedirs(self.dir, exist_ok=True)
            file_path = self._get_entry_path(cache_key)

            with gzip.open(file_path, "wb") as f:
                f.write(json.dumps(value.as_dict()).encode("utf-8"))

            if self.max_size:
                entries = os.listdir(self.dir)
                if len(entries) > self.max_size:
                    self._evict_oldest(entries)

        except Exception as e:
            print(f"Failed to write to prompt cache: {e}", file=sys.stderr)

    def _evict_oldest(self, entries: list) -> None:
        """
        Evict the oldest entries from the cache until it is under the maximum size.

        Args:
            entries: List of cache entry names

        Preconditions:
            self.max_size is not None
        """
        assert self.max_size is not None

        stats = []
        for entry in entries:
            try:
                path = self._get_entry_path(entry)
                mtime = os.path.getmtime(path)
                stats.append({"name": entry, "mtime": mtime})
            except OSError as e:
                print(f"Failed to get mtime for {entry}: {e}", file=sys.stderr)

        stats.sort(key=lambda x: x["mtime"])
        to_remove = stats[0 : len(stats) - self.max_size]

        for entry in to_remove:
            try:
                os.unlink(self._get_entry_path(entry["name"]))
            except OSError as e:
                print(f"Failed to remove cache entry {entry['name']}: {e}", file=sys.stderr)
