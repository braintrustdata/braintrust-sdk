import inspect
import json
import math
import os
import sys
import threading
import urllib.parse
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Generic, Literal, TypedDict, TypeVar, Union

from requests import HTTPError, Response


def parse_env_var_float(name: str, default: float) -> float:
    """Parse a float from an environment variable, returning default if invalid.

    Returns the default value if the env var is missing, empty, not a valid
    float, NaN, or infinity.
    """
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        result = float(value)
        if math.isnan(result) or math.isinf(result):
            return default
        return result
    except (ValueError, TypeError):
        return default

GLOBAL_PROJECT = "Global"
BT_IS_ASYNC_ATTRIBUTE = "_BT_IS_ASYNC"


# Taken from
# https://stackoverflow.com/questions/5574702/how-do-i-print-to-stderr-in-python.
def eprint(*args, **kwargs) -> None:
    print(*args, file=sys.stderr, **kwargs)


def coalesce(*args):
    """Returns the first non-None value in the list of `args`, or `None` if they
    are all `None`.
    """

    for a in args:
        if a is not None:
            return a
    return None


# Fields that automatically use set-union merge semantics (unless in merge_paths).
_SET_UNION_FIELDS = frozenset(["tags"])


def merge_dicts_with_paths(
    merge_into: dict[str, Any], merge_from: Mapping[str, Any], path: tuple[str, ...], merge_paths: set[tuple[str, ...]]
) -> dict[str, Any]:
    """Merges merge_from into merge_into, destructively updating merge_into. Does not merge any further than
    merge_paths. For fields in _SET_UNION_FIELDS (like "tags"), arrays are merged as sets (union)
    unless the field is explicitly listed in merge_paths (opt-out to replacement)."""

    if not isinstance(merge_into, dict):
        raise ValueError("merge_into must be a dictionary")
    if not isinstance(merge_from, dict):
        raise ValueError("merge_from must be a dictionary")

    for k, merge_from_v in merge_from.items():
        full_path = path + (k,)
        merge_into_v = merge_into.get(k)

        # Check if this field should use set-union merge (e.g., "tags" at top level)
        is_set_union_field = len(path) == 0 and k in _SET_UNION_FIELDS and full_path not in merge_paths

        if is_set_union_field and isinstance(merge_into_v, list) and isinstance(merge_from_v, list):
            # Set-union merge: combine arrays, deduplicate using JSON for objects
            seen: set[str] = set()
            combined = []
            for item in merge_into_v + list(merge_from_v):
                # Use JSON serialization for consistent object comparison
                item_key = json.dumps(item, sort_keys=True) if isinstance(item, (dict, list)) else str(item)
                if item_key not in seen:
                    seen.add(item_key)
                    combined.append(item)
            merge_into[k] = combined
        elif isinstance(merge_into_v, dict) and isinstance(merge_from_v, dict) and full_path not in merge_paths:
            merge_dicts_with_paths(merge_into_v, merge_from_v, full_path, merge_paths)
        else:
            merge_into[k] = merge_from_v

    return merge_into


def merge_dicts(merge_into: dict[str, Any], merge_from: Mapping[str, Any]) -> dict[str, Any]:
    """Merges merge_from into merge_into, destructively updating merge_into."""

    return merge_dicts_with_paths(merge_into, merge_from, (), set())


def encode_uri_component(name: str) -> str:
    """Encode a single component of a URI. Slashes are encoded as well, so this
    should not be used for multiple slash-separated URI components."""

    return urllib.parse.quote(name, safe="")


def mask_api_key(api_key: str) -> str:
    if len(api_key) <= 4:
        return "*" * len(api_key)
    return api_key[:2] + "*" * (len(api_key) - 4) + api_key[-2:]


def _urljoin(*parts: str) -> str:
    return "/".join(
        p for p in [x.strip("/") if i < len(parts) - 1 else x.lstrip("/") for i, x in enumerate(parts)] if p.strip()
    )


class AugmentedHTTPError(Exception):
    pass


def response_raise_for_status(resp: Response) -> None:
    try:
        resp.raise_for_status()
    except HTTPError as e:
        raise AugmentedHTTPError(f"{resp.text}") from e


class CallerLocation(TypedDict):
    caller_functionname: str
    caller_filename: str
    caller_lineno: int


def get_caller_location() -> CallerLocation | None:
    frame = inspect.currentframe()
    while frame:
        frame = frame.f_back
        if frame is None:
            return None

        mod = frame.f_globals.get("__name__")
        # NOTE[matt] we know this is only called from braintrust code,
        # so we can iterate up the callstack until we a frame that isn't
        # braintrust code and know that's our first user caller.
        if mod and not mod.startswith("braintrust."):
            return CallerLocation(
                caller_functionname=frame.f_code.co_name,
                caller_filename=frame.f_code.co_filename,
                caller_lineno=frame.f_lineno,
            )

    return None


T = TypeVar("T")


@dataclass
class _LazyValueResolvedState(Generic[T]):
    value: T
    has_succeeded: Literal[True] = True


@dataclass
class _LazyValuePendingState:
    has_succeeded: Literal[False] = False


_LazyValueState = Union[_LazyValueResolvedState[T], _LazyValuePendingState]


class LazyValue(Generic[T]):
    """A simple wrapper around a callable object which computes the value
    on-demand and saves it for future retrievals.
    """

    def __init__(self, callable: Callable[[], T], use_mutex: bool):
        self.callable = callable
        self.mutex = threading.Lock() if use_mutex else None
        self._state: _LazyValueState[T] = _LazyValuePendingState()

    @property
    def has_succeeded(self) -> bool:
        return self._state.has_succeeded

    @property
    def value(self) -> T | None:
        return self._state.value if self._state.has_succeeded == True else None

    def get(self) -> T:
        # Short-circuit check `has_succeeded`. This should be fine because
        # setting `_state` is atomic and python should have sequentially
        # consistent semantics, so we'll observe the write to
        # `self._state.value` as well.
        # https://docs.python.org/3/faq/library.html#what-kinds-of-global-value-mutation-are-thread-safe
        if self._state.has_succeeded == True:
            return self._state.value
        if self.mutex:
            self.mutex.acquire()
        try:
            if self._state.has_succeeded == False:
                res = self.callable()
                self._state = _LazyValueResolvedState(value=res)
            return self._state.value
        finally:
            if self.mutex:
                self.mutex.release()

    def get_sync(self) -> tuple[bool, T | None]:
        """Returns a tuple of (has_succeeded, value) without triggering evaluation."""
        if self._state.has_succeeded:
            # should be fine without the mutex check
            return (True, self._state.value)
        return (False, None)


_MARK_ASYNC_WRAPPER_UNDERLYING_CALLABLE_ATTRIBUTE = "_MarkAsyncWrapper_underlying_callable"


# A wrapper class to enable explicitly marking a callable object as async. This
# can be useful for scenarios where the user wants to provide an awaitable
# function that is not recognized as async with `inspect.iscoroutinefunction`.
#
# Note: Python 3.12 provides a `inspect.markcoroutinefunction` function which
# serves a similar purpose, but we do this ourselves in case this function is
# not available.
class MarkAsyncWrapper:
    def __init__(self, callable):
        setattr(self, _MARK_ASYNC_WRAPPER_UNDERLYING_CALLABLE_ATTRIBUTE, callable)
        setattr(self, BT_IS_ASYNC_ATTRIBUTE, True)

    def __getattribute__(self, name):
        if name in [_MARK_ASYNC_WRAPPER_UNDERLYING_CALLABLE_ATTRIBUTE, BT_IS_ASYNC_ATTRIBUTE]:
            return object.__getattribute__(self, name)
        else:
            return object.__getattribute__(
                object.__getattribute__(self, _MARK_ASYNC_WRAPPER_UNDERLYING_CALLABLE_ATTRIBUTE), name
            )

    def __call__(self, *args, **kwargs):
        return object.__getattribute__(self, _MARK_ASYNC_WRAPPER_UNDERLYING_CALLABLE_ATTRIBUTE)(*args, **kwargs)


def bt_iscoroutinefunction(f):
    return inspect.iscoroutinefunction(f) or inspect.isasyncgenfunction(f) or getattr(f, BT_IS_ASYNC_ATTRIBUTE, False)


def add_azure_blob_headers(headers: dict[str, str], url: str) -> None:
    # According to https://stackoverflow.com/questions/37824136/put-on-sas-blob-url-without-specifying-x-ms-blob-type-header,
    # there is no way to avoid including this.
    if "blob.core.windows.net" in url:
        headers["x-ms-blob-type"] = "BlockBlob"
