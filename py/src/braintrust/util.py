import inspect
import os.path
import sys
import threading
import urllib.parse
from typing import Any, Callable, Dict, Generic, Set, Tuple, TypeVar

from requests import HTTPError

GLOBAL_PROJECT = "Global"
BT_IS_ASYNC_ATTRIBUTE = "_BT_IS_ASYNC"


# Taken from
# https://stackoverflow.com/questions/5574702/how-do-i-print-to-stderr-in-python.
def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def coalesce(*args):
    """Returns the first non-None value in the list of `args`, or `None` if they
    are all `None`.
    """

    for a in args:
        if a is not None:
            return a
    return None


def merge_dicts_with_paths(merge_into: Dict, merge_from: Dict, path: Tuple[str], merge_paths: Set[Tuple[str]]):
    """Merges merge_from into merge_into, destructively updating merge_into. Does not merge any further than
    merge_paths."""

    if not isinstance(merge_into, dict):
        raise ValueError("merge_into must be a dictionary")
    if not isinstance(merge_from, dict):
        raise ValueError("merge_from must be a dictionary")

    for k, merge_from_v in merge_from.items():
        full_path = path + (k,)
        merge_into_v = merge_into.get(k)
        if isinstance(merge_into_v, dict) and isinstance(merge_from_v, dict) and full_path not in merge_paths:
            merge_dicts_with_paths(merge_into_v, merge_from_v, full_path, merge_paths)
        else:
            merge_into[k] = merge_from_v

    return merge_into


def merge_dicts(merge_into: Dict, merge_from: Dict):
    """Merges merge_from into merge_into, destructively updating merge_into."""

    return merge_dicts_with_paths(merge_into, merge_from, (), set())


def encode_uri_component(name):
    """Encode a single component of a URI. Slashes are encoded as well, so this
    should not be used for multiple slash-separated URI components."""

    return urllib.parse.quote(name, safe="")


def _urljoin(*parts):
    return "/".join(
        p for p in [x.strip("/") if i < len(parts) - 1 else x.lstrip("/") for i, x in enumerate(parts)] if p.strip()
    )


class AugmentedHTTPError(Exception):
    pass


def response_raise_for_status(resp):
    try:
        resp.raise_for_status()
    except HTTPError as e:
        raise AugmentedHTTPError(f"{resp.text}") from e


def get_caller_location():
    # Modified from
    # https://stackoverflow.com/questions/24438976/debugging-get-filename-and-line-number-from-which-a-function-is-called
    # to fetch the first stack frame not contained inside the same directory as
    # this file.
    this_dir = None
    call_stack = inspect.stack()
    for frame in call_stack:
        caller = inspect.getframeinfo(frame.frame)
        if this_dir is None:
            this_dir = os.path.dirname(caller.filename)
        if os.path.dirname(caller.filename) != this_dir:
            return dict(
                caller_functionname=caller.function,
                caller_filename=caller.filename,
                caller_lineno=caller.lineno,
            )
    return None


T = TypeVar("T")


class LazyValue(Generic[T]):
    """A simple wrapper around a callable object which computes the value
    on-demand and saves it for future retrievals.
    """

    def __init__(self, callable: Callable[[], T], use_mutex: bool):
        self.callable = callable
        self.mutex = threading.Lock() if use_mutex else None
        self.has_computed = False
        self.value = None

    def get(self) -> T:
        # Short-circuit check `has_computed`. This should be fine because
        # setting `has_computed` is atomic and python should have sequentially
        # consistent semantics, so we'll observe the write to `self.value` as
        # well.
        if self.has_computed:
            return self.value
        if self.mutex:
            self.mutex.acquire()
        try:
            if not self.has_computed:
                res = self.callable()
                self.value = res
                self.has_computed = True
            return self.value
        finally:
            if self.mutex:
                self.mutex.release()


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
    return inspect.iscoroutinefunction(f) or getattr(f, BT_IS_ASYNC_ATTRIBUTE, False)
