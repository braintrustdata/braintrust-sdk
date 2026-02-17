from __future__ import annotations

from typing import Any

from braintrust.prompt_cache import disk_cache, lru_cache


def _create_cache_key(
    project_id: str | None,
    project_name: str | None,
    slug: str | None,
    version: str = "latest",
    id: str | None = None,
) -> str:
    if id:
        return f"parameters:id:{id}"

    prefix = project_id or project_name
    if not prefix:
        raise ValueError("Either project_id or project_name must be provided")
    if not slug:
        raise ValueError("Slug must be provided when not using ID")
    return f"parameters:{prefix}:{slug}:{version}"


class ParametersCache:
    def __init__(
        self,
        memory_cache: lru_cache.LRUCache[str, dict[str, Any]],
        disk_cache: disk_cache.DiskCache[dict[str, Any]] | None = None,
    ):
        self.memory_cache = memory_cache
        self.disk_cache = disk_cache

    def get(
        self,
        slug: str | None = None,
        version: str = "latest",
        project_id: str | None = None,
        project_name: str | None = None,
        id: str | None = None,
    ) -> dict[str, Any]:
        cache_key = _create_cache_key(project_id, project_name, slug, version, id)

        try:
            return self.memory_cache.get(cache_key)
        except KeyError:
            pass

        if self.disk_cache:
            params = self.disk_cache.get(cache_key)
            self.memory_cache.set(cache_key, params)
            return params

        raise KeyError(f"Parameters not found in cache: {cache_key}")

    def set(
        self,
        value: dict[str, Any],
        slug: str | None = None,
        version: str = "latest",
        project_id: str | None = None,
        project_name: str | None = None,
        id: str | None = None,
    ) -> None:
        cache_key = _create_cache_key(project_id, project_name, slug, version, id)

        self.memory_cache.set(cache_key, value)
        if self.disk_cache:
            self.disk_cache.set(cache_key, value)
