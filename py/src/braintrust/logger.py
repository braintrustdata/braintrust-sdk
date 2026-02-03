import atexit
import base64
import concurrent.futures
import contextlib
import contextvars
import dataclasses
import datetime
import inspect
import io
import json
import logging
import os
import sys
import textwrap
import threading
import time
import traceback
import types
import uuid
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterator, Mapping, MutableMapping, Sequence
from functools import partial, wraps
from multiprocessing import cpu_count
from types import TracebackType
from typing import (
    Any,
    Dict,
    Generic,
    Literal,
    Optional,
    TypedDict,
    TypeVar,
    Union,
    cast,
    overload,
)
from urllib.parse import urlencode

import chevron
import exceptiongroup
import requests
import urllib3
from braintrust.functions.stream import BraintrustStream
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from . import context, id_gen
from .bt_json import bt_dumps, bt_safe_deep_copy
from .db_fields import (
    AUDIT_METADATA_FIELD,
    AUDIT_SOURCE_FIELD,
    IS_MERGE_FIELD,
    OBJECT_DELETE_FIELD,
    OBJECT_ID_KEYS,
    TRANSACTION_ID_FIELD,
    VALID_SOURCES,
)
from .generated_types import (
    AttachmentReference,
    AttachmentStatus,
    DatasetEvent,
    ExperimentEvent,
    PromptOptions,
    SpanAttributes,
)
from .git_fields import GitMetadataSettings, RepoInfo
from .gitutil import get_past_n_ancestors, get_repo_info
from .merge_row_batch import batch_items, merge_row_batch
from .object import DEFAULT_IS_LEGACY_DATASET, ensure_dataset_record
from .prompt import BRAINTRUST_PARAMS, ImagePart, PromptBlockData, PromptData, PromptMessage, PromptSchema, TextPart
from .prompt_cache.disk_cache import DiskCache
from .prompt_cache.lru_cache import LRUCache
from .prompt_cache.prompt_cache import PromptCache
from .queue import DEFAULT_QUEUE_SIZE, LogQueue
from .serializable_data_class import SerializableDataClass
from .span_identifier_v3 import SpanComponentsV3, SpanObjectTypeV3
from .span_identifier_v4 import SpanComponentsV4
from .span_types import SpanTypeAttribute
from .util import (
    GLOBAL_PROJECT,
    AugmentedHTTPError,
    LazyValue,
    _urljoin,
    add_azure_blob_headers,
    bt_iscoroutinefunction,
    coalesce,
    encode_uri_component,
    eprint,
    get_caller_location,
    mask_api_key,
    merge_dicts,
    parse_env_var_float,
    response_raise_for_status,
)

# Fields that should be passed to the masking function
# Note: "tags" field is intentionally excluded, but can be added if needed
REDACTION_FIELDS = ["input", "output", "expected", "metadata", "context", "scores", "metrics"]
from .xact_ids import prettify_xact

Metadata = dict[str, Any]
DATA_API_VERSION = 2
LOGS3_OVERFLOW_REFERENCE_TYPE = "logs3_overflow"
# 6 MB for the AWS lambda gateway (from our own testing).
DEFAULT_MAX_REQUEST_SIZE = 6 * 1024 * 1024


@dataclasses.dataclass
class Logs3OverflowInputRow:
    object_ids: dict[str, Any]
    has_comment: bool
    is_delete: bool
    byte_size: int


@dataclasses.dataclass
class LogItemWithMeta:
    str_value: str
    overflow_meta: Logs3OverflowInputRow


class DatasetRef(TypedDict, total=False):
    """Reference to a dataset by ID and optional version."""

    id: str
    version: str


T = TypeVar("T")
TMapping = TypeVar("TMapping", bound=Mapping[str, Any])
TMutableMapping = TypeVar("TMutableMapping", bound=MutableMapping[str, Any])


TEST_API_KEY = "___TEST_API_KEY__"

DEFAULT_APP_URL = "https://www.braintrust.dev"


def _get_exporter():
    """Return the active exporter (e.g. the version of SpanComponentsv*)"""
    use_v4 = os.getenv("BRAINTRUST_OTEL_COMPAT", "false").lower() == "true"
    return SpanComponentsV4 if use_v4 else SpanComponentsV3


class Exportable(ABC):
    @abstractmethod
    def export(self) -> str:
        """Return a serialized representation of the object that can be used to start subspans in other places. See `Span.start_span` for more details."""


class Span(Exportable, contextlib.AbstractContextManager, ABC):
    """
    A Span encapsulates logged data and metrics for a unit of work. This interface is shared by all span implementations.

    We suggest using one of the various `start_span` methods, instead of creating Spans directly. See `Span.start_span` for full details.
    """

    @property
    @abstractmethod
    def id(self) -> str:
        """Row ID of the span."""

    @abstractmethod
    def log(self, **event: Any) -> None:
        """Incrementally update the current span with new data. The event will be batched and uploaded behind the scenes.

        :param **event: Data to be logged. See `Experiment.log` for full details.
        """

    @abstractmethod
    def log_feedback(self, **event: Any) -> None:
        """Add feedback to the current span. Unlike `Experiment.log_feedback` and `Logger.log_feedback`, this method does not accept an id parameter, because it logs feedback to the current span.

        :param **event: Data to be logged. See `Experiment.log_feedback` for full details.
        """

    @abstractmethod
    def start_span(
        self,
        name: str | None = None,
        type: SpanTypeAttribute | None = None,
        span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
        start_time: float | None = None,
        set_current: bool | None = None,
        parent: str | None = None,
        **event: Any,
    ) -> "Span":
        """Create a new span. This is useful if you want to log more detailed trace information beyond the scope of a single log event. Data logged over several calls to `Span.log` will be merged into one logical row.

        We recommend running spans within context managers (`with start_span(...) as span`) to automatically mark them as current and ensure they are ended. Only spans run within a context manager will be marked current, so they can be accessed using `braintrust.current_span()`. If you wish to start a span outside a context manager, be sure to end it with `span.end()`.

        :param name: Optional name of the span. If not provided, a name will be inferred from the call stack.
        :param type: Optional type of the span. Use the `SpanTypeAttribute` enum or just provide a string directly.
        If not provided, the type will be unset.
        :param span_attributes: Optional additional attributes to attach to the span, such as a type name.
        :param start_time: Optional start time of the span, as a timestamp in seconds.
        :param set_current: If true (the default), the span will be marked as the currently-active span for the duration of the context manager.
        :param parent: Optional parent info string for the span. The string can be generated from `[Span,Experiment,Logger].export`. If not provided, the current span will be used (depending on context). This is useful for adding spans to an existing trace.
        :param **event: Data to be logged. See `Experiment.log` for full details.
        :returns: The newly-created `Span`
        """

    @abstractmethod
    def export(self) -> str:
        """
        Serialize the identifiers of this span. The return value can be used to identify this span when starting a subspan elsewhere, such as another process or service, without needing to access this `Span` object. See the parameters of `Span.start_span` for usage details.

        Callers should treat the return value as opaque. The serialization format may change from time to time. If parsing is needed, use `SpanComponentsV4.from_str`.

        :returns: Serialized representation of this span's identifiers.
        """

    @abstractmethod
    def link(self) -> str:
        """
        Format a link to the Braintrust application for viewing this span.

        Links can be generated at any time, but they will only become viewable
        after the span and its root have been flushed to the server and ingested.

        There are some conditions when a Span doesn't have enough information
        to return a stable link (e.g. during an unresolved experiment). In this case
        or if there's an error generating link, we'll return a placeholder link.

        :returns: A link to the span.
        """

    @abstractmethod
    def permalink(self) -> str:
        """
        Format a permalink to the Braintrust application for viewing this span.

        Links can be generated at any time, but they will only become viewable after the span and its root have been flushed to the server and ingested.

        This function can block resolving data with the server. For production
        applications it's preferable to call `Span.link` instead.


        :returns: A permalink to the span.
        """

    @abstractmethod
    def end(self, end_time: float | None = None) -> float:
        """Log an end time to the span (defaults to the current time). Returns the logged time.

        Will be invoked automatically if the span is bound to a context manager.

        :param end_time: Optional end time of the span, as a timestamp in seconds.
        :returns: The end time logged to the span metrics.
        """

    @abstractmethod
    def flush(self) -> None:
        """Flush any pending rows to the server."""

    @abstractmethod
    def close(self, end_time: float | None = None) -> float:
        """Alias for `end`."""

    @abstractmethod
    def set_attributes(
        self,
        name: str | None = None,
        type: SpanTypeAttribute | None = None,
        span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
    ) -> None:
        """Set the span's name, type, or other attributes. These attributes will be attached to all log events within the span.
        The attributes are equivalent to the arguments to start_span.

        :param name: Optional name of the span. If not provided, a name will be inferred from the call stack.
        :param type: Optional type of the span. Use the `SpanTypeAttribute` enum or just provide a string directly.
        If not provided, the type will be unset.
        :param span_attributes: Optional additional attributes to attach to the span, such as a type name.
        """
        pass

    @abstractmethod
    def set_current(self) -> None:
        """Set the span as the current span. This is used to mark the span as the active span for the current thread."""
        pass

    @abstractmethod
    def unset_current(self) -> None:
        """Unset the span as the current span."""
        pass


class _NoopSpan(Span):
    """A fake implementation of the Span API which does nothing. This can be used as the default span."""

    def __init__(self, *args: Any, **kwargs: Any):
        pass

    @property
    def id(self):
        return ""

    @property
    def propagated_event(self):
        return None

    def log(self, **event: Any):
        pass

    def log_feedback(self, **event: Any):
        pass

    def start_span(
        self,
        name: str | None = None,
        type: SpanTypeAttribute | None = None,
        span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
        start_time: float | None = None,
        set_current: bool | None = None,
        parent: str | None = None,
        **event: Any,
    ):
        return self

    def end(self, end_time: float | None = None) -> float:
        return end_time or time.time()

    def export(self):
        return ""

    def link(self) -> str:
        return NOOP_SPAN_PERMALINK

    def permalink(self) -> str:
        return NOOP_SPAN_PERMALINK

    def flush(self):
        pass

    def close(self, end_time: float | None = None) -> float:
        return self.end(end_time)

    def set_attributes(
        self,
        name: str | None = None,
        type: SpanTypeAttribute | None = None,
        span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
    ):
        pass

    def set_current(self):
        pass

    def unset_current(self):
        pass

    def __enter__(self):
        return super().__enter__()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ):
        pass


NOOP_SPAN: Span = _NoopSpan()
NOOP_SPAN_PERMALINK = "https://www.braintrust.dev/noop-span"


class BraintrustState:
    def __init__(self):
        self.id = str(uuid.uuid4())
        self.current_experiment: Experiment | None = None
        # We use both a ContextVar and a plain attribute for the current logger:
        # - _cv_logger (ContextVar): Provides async context isolation so different
        #   async tasks can have different loggers without affecting each other.
        # - _local_logger (plain attribute): Fallback for threads, since ContextVars
        #   don't propagate to new threads. This way if users don't want to do
        #   anything specific they'll always have a "global logger"
        self._cv_logger: contextvars.ContextVar[Logger | None] = contextvars.ContextVar(
            "braintrust_current_logger", default=None
        )
        self._local_logger: Logger | None = None
        self.current_parent: contextvars.ContextVar[str | None] = contextvars.ContextVar(
            "braintrust_current_parent", default=None
        )
        self.current_span: contextvars.ContextVar[Span] = contextvars.ContextVar(
            "braintrust_current_span", default=NOOP_SPAN
        )

        # Context manager is dynamically selected based on current environment
        self._context_manager = None
        self._context_manager_lock = threading.Lock()

        def default_get_api_conn():
            self.login()
            return self.api_conn()

        # Any time we re-log in, we directly update the api_conn inside the
        # logger. This is preferable to replacing the whole logger, which would
        # create the possibility of multiple loggers floating around.
        #
        # We lazily-initialize the logger so that it does any initialization
        # (including reading env variables) upon the first actual usage.
        self._global_bg_logger = LazyValue(
            lambda: _HTTPBackgroundLogger(LazyValue(default_get_api_conn, use_mutex=True)), use_mutex=True
        )

        self._id_generator = None

        # For unit-testing, tests may wish to temporarily override the global
        # logger with a custom one. We allow this but keep the override variable
        # thread-local to prevent the possibility that tests running on
        # different threads unintentionally use the same override.
        self._override_bg_logger = threading.local()

        self.reset_login_info()

        self._prompt_cache = PromptCache(
            memory_cache=LRUCache(
                max_size=int(os.environ.get("BRAINTRUST_PROMPT_CACHE_MEMORY_MAX_SIZE", str(1 << 10)))
            ),
            disk_cache=DiskCache(
                cache_dir=os.environ.get(
                    "BRAINTRUST_PROMPT_CACHE_DIR", f"{os.environ.get('HOME')}/.braintrust/prompt_cache"
                ),
                max_size=int(os.environ.get("BRAINTRUST_PROMPT_CACHE_DISK_MAX_SIZE", str(1 << 20))),
                serializer=lambda x: x.as_dict(),
                deserializer=PromptSchema.from_dict_deep,
            ),
        )

        from braintrust.span_cache import SpanCache

        self.span_cache = SpanCache()
        self._otel_flush_callback: Any | None = None

    def reset_login_info(self):
        self.app_url: str | None = None
        self.app_public_url: str | None = None
        self.login_token: str | None = None
        self.org_id: str | None = None
        self.org_name: str | None = None
        self.api_url: str | None = None
        self.proxy_url: str | None = None
        self.logged_in: bool = False
        self.git_metadata_settings: GitMetadataSettings | None = None

        self._app_conn: HTTPConnection | None = None
        self._api_conn: HTTPConnection | None = None
        self._proxy_conn: HTTPConnection | None = None
        self._user_info: Mapping[str, Any] | None = None

    def reset_parent_state(self):
        # reset possible parent state for tests
        self.current_experiment = None
        self._cv_logger.set(None)
        self._local_logger = None
        self.current_parent.set(None)
        self.current_span.set(NOOP_SPAN)

    def _reset_id_generator(self):
        # used in tests when we want to test with a different id generators
        # which are controlled by env vars.
        self._id_generator = None

    def _reset_context_manager(self):
        # used in tests when we want to test with a different context manager
        # which is controlled by BRAINTRUST_OTEL_COMPAT env var.
        self._context_manager = None

    @property
    def id_generator(self):
        """Return the active id generator."""
        # While we probably only need one id generator per process (and it's configured with env vars), it's part of state
        # so that we could possibly have parallel tests using different id generators.
        if self._id_generator is None:
            self._id_generator = id_gen.get_id_generator()
        return self._id_generator

    @property
    def context_manager(self):
        """Get the appropriate context manager based on current environment."""
        # Cache the context manager on first access
        if self._context_manager is None:
            with self._context_manager_lock:
                # Double-check after acquiring lock
                if self._context_manager is None:
                    from braintrust.context import get_context_manager

                    self._context_manager = get_context_manager()

        return self._context_manager

    def register_otel_flush(self, callback: Any) -> None:
        """
        Register an OTEL flush callback. This is called by the OTEL integration
        when it initializes a span processor/exporter.
        """
        self._otel_flush_callback = callback

    async def flush_otel(self) -> None:
        """
        Flush OTEL spans if a callback is registered.
        Called during ensure_spans_flushed to ensure OTEL spans are visible in BTQL.
        """
        if self._otel_flush_callback:
            await self._otel_flush_callback()

    def copy_state(self, other: "BraintrustState"):
        """Copy login information from another BraintrustState instance."""
        self.__dict__.update(
            {
                k: v
                for (k, v) in other.__dict__.items()
                if k
                not in (
                    "current_experiment",
                    "_cv_logger",
                    "_local_logger",
                    "current_parent",
                    "current_span",
                    "_global_bg_logger",
                    "_override_bg_logger",
                    "_context_manager",
                    "_last_otel_setting",
                    "_context_manager_lock",
                )
            }
        )

    def login(
        self,
        app_url: str | None = None,
        api_key: str | None = None,
        org_name: str | None = None,
        force_login: bool = False,
    ) -> None:
        if not force_login and self.logged_in:
            # We have already logged in. If any provided login inputs disagree
            # with our existing settings, raise an Exception warning the user to
            # try again with `force_login=True`.
            def check_updated_param(varname, arg, orig):
                if arg is not None and orig is not None and arg != orig:
                    raise Exception(
                        f"Re-logging in with different {varname} ({arg}) than original ({orig}). To force re-login, pass `force_login=True`"
                    )

            sanitized_api_key = HTTPConnection.sanitize_token(api_key) if api_key else None
            check_updated_param("app_url", app_url, self.app_url)
            check_updated_param("api_key", sanitized_api_key, self.login_token)
            check_updated_param("org_name", org_name, self.org_name)
            return

        state = login_to_state(
            app_url=app_url,
            api_key=api_key,
            org_name=org_name,
        )
        self.copy_state(state)

    def app_conn(self):
        if not self._app_conn:
            if not self.app_url:
                raise RuntimeError("Must initialize app_url before requesting app_conn")
            self._app_conn = HTTPConnection(self.app_url, adapter=_http_adapter)
        return self._app_conn

    def api_conn(self):
        if not self._api_conn:
            if not self.api_url:
                raise RuntimeError("Must initialize api_url before requesting api_conn")
            self._api_conn = HTTPConnection(self.api_url, adapter=_http_adapter)
        return self._api_conn

    def proxy_conn(self):
        if not self.proxy_url:
            return self.api_conn()

        if not self._proxy_conn:
            if not self.proxy_url:
                raise RuntimeError("Must initialize proxy_url before requesting proxy_conn")
            self._proxy_conn = HTTPConnection(self.proxy_url, adapter=_http_adapter)
        return self._proxy_conn

    def user_info(self) -> Mapping[str, Any]:
        if not self._user_info:
            self._user_info = self.api_conn().get_json("ping")
        return self._user_info

    def global_bg_logger(self) -> "_BackgroundLogger":
        return getattr(self._override_bg_logger, "logger", None) or self._global_bg_logger.get()

    # Should only be called by the login function.
    def login_replace_api_conn(self, api_conn: "HTTPConnection"):
        self._global_bg_logger.get().internal_replace_api_conn(api_conn)

    def flush(self):
        self._global_bg_logger.get().flush()

    def enforce_queue_size_limit(self, enforce: bool) -> None:
        """
        Set queue size limit enforcement for the global background logger.
        """
        bg_logger = self._global_bg_logger.get()
        bg_logger.enforce_queue_size_limit(enforce)

    def set_masking_function(self, masking_function: Callable[[Any], Any] | None) -> None:
        """Set the masking function on the background logger."""
        self.global_bg_logger().set_masking_function(masking_function)


_state: BraintrustState = None  # type: ignore


_http_adapter: HTTPAdapter | None = None


def set_http_adapter(adapter: HTTPAdapter) -> None:
    """
    Specify a custom HTTP adapter to use for all network requests. This is useful for setting custom retry policies, timeouts, etc.
    Braintrust uses the `requests` library, so the adapter should be an instance of `requests.adapters.HTTPAdapter`. Alternatively, consider
    sub-classing our `RetryRequestExceptionsAdapter` to get automatic retries on network-related exceptions.

    :param adapter: The adapter to use.
    """

    global _http_adapter

    _http_adapter = adapter

    if _state._app_conn:
        _state._app_conn._set_adapter(adapter=adapter)
        _state._app_conn._reset()
    if _state._api_conn:
        _state._api_conn._set_adapter(adapter=adapter)
        _state._api_conn._reset()


class RetryRequestExceptionsAdapter(HTTPAdapter):
    """An HTTP adapter that automatically retries requests on connection exceptions.

    This adapter extends requests' HTTPAdapter to add retry logic for common network-related
    exceptions including connection errors, timeouts, and other HTTP errors. It implements
    an exponential backoff strategy between retries to avoid overwhelming servers during
    intermittent connectivity issues.

    Attributes:
        base_num_retries: Maximum number of retries before giving up and re-raising the exception.
        backoff_factor: A multiplier used to determine the time to wait between retries.
                       The actual wait time is calculated as: backoff_factor * (2 ** retry_count).
        default_timeout_secs: Default timeout in seconds for requests that don't specify one.
                             Prevents indefinite hangs on stale connections.
    """

    def __init__(
        self,
        *args: Any,
        base_num_retries: int = 0,
        backoff_factor: float = 0.5,
        default_timeout_secs: float = 60,
        **kwargs: Any,
    ):
        self.base_num_retries = base_num_retries
        self.backoff_factor = backoff_factor
        self.default_timeout_secs = default_timeout_secs
        super().__init__(*args, **kwargs)

    def send(self, *args, **kwargs):
        # Apply default timeout if none provided to prevent indefinite hangs
        if kwargs.get("timeout") is None:
            kwargs["timeout"] = self.default_timeout_secs

        num_prev_retries = 0
        while True:
            try:
                response = super().send(*args, **kwargs)
                # Fully-download the content to ensure we catch any errors from
                # downloading.
                if not response.is_redirect and response.content:
                    pass
                return response
            except (urllib3.exceptions.HTTPError, requests.exceptions.RequestException) as e:
                if num_prev_retries < self.base_num_retries:
                    if isinstance(e, requests.exceptions.ReadTimeout):
                        # Clear all connection pools to discard stale connections. This
                        # fixes hangs caused by NAT gateways silently dropping idle TCP
                        # connections (e.g., Azure's ~4 min timeout). close() calls
                        # PoolManager.clear() which is thread-safe: in-flight requests
                        # keep their checked-out connections, and new requests create
                        # fresh pools on demand.
                        self.close()
                    # Emulates the sleeping logic in the backoff_factor of urllib3 Retry
                    sleep_s = self.backoff_factor * (2**num_prev_retries)
                    print("Retrying request after error:", e, file=sys.stderr)
                    print("Sleeping for", sleep_s, "seconds", file=sys.stderr)
                    time.sleep(sleep_s)
                    num_prev_retries += 1
                else:
                    raise e


class HTTPConnection:
    def __init__(self, base_url: str, adapter: HTTPAdapter | None = None):
        self.base_url = base_url
        self.token = None
        self.adapter = adapter

        self._reset(total=0)

    def ping(self) -> bool:
        try:
            resp = self.get("ping")
            return resp.ok
        except requests.exceptions.ConnectionError:
            return False

    def make_long_lived(self) -> None:
        if not self.adapter:
            timeout_secs = parse_env_var_float("BRAINTRUST_HTTP_TIMEOUT", 60.0)
            self.adapter = RetryRequestExceptionsAdapter(
                base_num_retries=10, backoff_factor=0.5, default_timeout_secs=timeout_secs
            )
        self._reset()

    @staticmethod
    def sanitize_token(token: str) -> str:
        return token.rstrip("\n")

    def set_token(self, token: str) -> None:
        token = HTTPConnection.sanitize_token(token)
        self.token = token
        self._set_session_token()

    def _set_adapter(self, adapter: HTTPAdapter | None) -> None:
        self.adapter = adapter

    def _reset(self, **retry_kwargs: Any) -> None:
        self.session = requests.Session()

        adapter = self.adapter
        if adapter is None:
            retry = Retry(**retry_kwargs)
            adapter = HTTPAdapter(max_retries=retry)

        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)

        self._set_session_token()

    def _set_session_token(self) -> None:
        if self.token:
            self.session.headers.update({"Authorization": f"Bearer {self.token}"})

    def get(self, path: str, *args: Any, **kwargs: Any) -> requests.Response:
        return self.session.get(_urljoin(self.base_url, path), *args, **kwargs)

    def post(self, path: str, *args: Any, **kwargs: Any) -> requests.Response:
        return self.session.post(_urljoin(self.base_url, path), *args, **kwargs)

    def put(self, path: str, *args: Any, **kwargs: Any) -> requests.Response:
        return self.session.put(_urljoin(self.base_url, path), *args, **kwargs)

    def delete(self, path: str, *args: Any, **kwargs: Any) -> requests.Response:
        return self.session.delete(_urljoin(self.base_url, path), *args, **kwargs)

    def get_json(self, object_type: str, args: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
        resp = self.get(f"/{object_type}", params=args)
        response_raise_for_status(resp)
        return resp.json()

    def post_json(self, object_type: str, args: Mapping[str, Any] | None = None) -> Any:
        resp = self.post(f"/{object_type.lstrip('/')}", json=args)
        response_raise_for_status(resp)
        return resp.json()


# Sometimes we'd like to launch network requests concurrently. We provide a
# thread pool to accomplish this. Use a multiple of number of CPU cores to limit
# concurrency.
HTTP_REQUEST_THREAD_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=cpu_count())


def api_conn():
    return _state.api_conn()


def app_conn():
    return _state.app_conn()


def proxy_conn():
    return _state.proxy_conn()


def user_info():
    return _state.user_info()


def org_id():
    return _state.org_id


def construct_json_array(items: Sequence[str]):
    return "[" + ",".join(items) + "]"


def construct_logs3_data(items: Sequence[LogItemWithMeta]):
    rowsS = construct_json_array([item.str_value for item in items])
    return '{"rows": ' + rowsS + ', "api_version": ' + str(DATA_API_VERSION) + "}"


def construct_logs3_overflow_request(key: str, size_bytes: int | None = None) -> dict[str, Any]:
    rows: dict[str, Any] = {"type": LOGS3_OVERFLOW_REFERENCE_TYPE, "key": key}
    if size_bytes is not None:
        rows["size_bytes"] = size_bytes
    return {"rows": rows, "api_version": DATA_API_VERSION}


def pick_logs3_overflow_object_ids(row: Mapping[str, Any]) -> dict[str, Any]:
    object_ids: dict[str, Any] = {}
    for key in OBJECT_ID_KEYS:
        if key in row:
            object_ids[key] = row[key]
    return object_ids


def stringify_with_overflow_meta(item: dict[str, Any]) -> LogItemWithMeta:
    str_value = bt_dumps(item)
    return LogItemWithMeta(
        str_value=str_value,
        overflow_meta=Logs3OverflowInputRow(
            object_ids=pick_logs3_overflow_object_ids(item),
            has_comment="comment" in item,
            is_delete=item.get(OBJECT_DELETE_FIELD) is True,
            byte_size=utf8_byte_length(str_value),
        ),
    )


def utf8_byte_length(value: str) -> int:
    return len(value.encode("utf-8"))


class _MaskingError:
    """Internal class to signal masking errors that need special handling."""

    def __init__(self, field_name: str, error_type: str):
        self.field_name = field_name
        self.error_type = error_type
        self.error_msg = f"ERROR: Failed to mask field '{field_name}' - {error_type}"


def _apply_masking_to_field(masking_function: Callable[[Any], Any], data: Any, field_name: str) -> Any:
    """Apply masking function to data and handle errors gracefully.

    If the masking function raises an exception, returns an error message.
    Returns _MaskingError for scores/metrics fields to signal they should be dropped.
    """
    try:
        return masking_function(data)
    except Exception as mask_error:
        # Return a generic error message without the stack trace to avoid leaking PII
        error_type = type(mask_error).__name__

        # For scores and metrics fields, return a special error object
        # to signal the field should be dropped and error logged
        if field_name in ["scores", "metrics"]:
            return _MaskingError(field_name, error_type)

        # For metadata field that expects dict type, return a dict with error key
        if field_name == "metadata":
            return {"error": f"ERROR: Failed to mask field '{field_name}' - {error_type}"}

        # For other fields, return the error message as a string
        return f"ERROR: Failed to mask field '{field_name}' - {error_type}"


class _BackgroundLogger(ABC):
    @abstractmethod
    def log(self, *args: LazyValue[dict[str, Any]]) -> None:
        pass

    @abstractmethod
    def flush(self, batch_size: int | None = None):
        pass


class _MemoryBackgroundLogger(_BackgroundLogger):
    def __init__(self):
        self.lock = threading.Lock()
        self.logs = []
        self.masking_function: Callable[[Any], Any] | None = None
        self.upload_attempts: list[BaseAttachment] = []  # Track upload attempts

    def enforce_queue_size_limit(self, enforce: bool) -> None:
        pass

    def log(self, *args: LazyValue[dict[str, Any]]) -> None:
        with self.lock:
            self.logs.extend(args)

    def set_masking_function(self, masking_function: Callable[[Any], Any] | None) -> None:
        """Set the masking function for the memory logger."""
        self.masking_function = masking_function

    def flush(self, batch_size: int | None = None):
        """Flush the memory logger, extracting attachments and tracking upload attempts."""
        with self.lock:
            if not self.logs:
                return

            # Unwrap lazy values and extract attachments
            logs = [l.get() for l in self.logs]

            # Extract attachments from all logs
            attachments: list[BaseAttachment] = []
            for log in logs:
                _extract_attachments(log, attachments)

            # Track upload attempts (don't actually call upload() in tests)
            self.upload_attempts.extend(attachments)

    def pop(self):
        with self.lock:
            logs = [l.get() for l in self.logs]  # unwrap the LazyValues
            self.logs = []

            if not logs:
                return []

            # all the logs get merged before gettig sent to the server, so simulate that
            # here
            batch = merge_row_batch(logs)

            # Apply masking after merge, similar to HTTPBackgroundLogger
            if self.masking_function:
                for i in range(len(batch)):
                    item = batch[i]
                    masked_item = item.copy()

                    # Only mask specific fields if they exist
                    for field in REDACTION_FIELDS:
                        if field in item:
                            masked_value = _apply_masking_to_field(self.masking_function, item[field], field)
                            if isinstance(masked_value, _MaskingError):
                                # Drop the field and add error message
                                if field in masked_item:
                                    del masked_item[field]
                                if "error" in masked_item:
                                    masked_item["error"] = f"{masked_item['error']}; {masked_value.error_msg}"
                                else:
                                    masked_item["error"] = masked_value.error_msg
                            else:
                                masked_item[field] = masked_value

                    batch[i] = masked_item

            return batch


BACKGROUND_LOGGER_BASE_SLEEP_TIME_S = 1.0


# We should only have one instance of this object in
# 'BraintrustState._global_bg_logger'. Be careful about spawning multiple
# instances of this class, because concurrent _BackgroundLoggers will not log to
# the backend in a deterministic order.
class _HTTPBackgroundLogger:
    def __init__(self, api_conn: LazyValue[HTTPConnection]):
        self.api_conn = api_conn
        self.masking_function: Callable[[Any], Any] | None = None
        self.outfile = sys.stderr
        self.flush_lock = threading.RLock()
        self._max_request_size_override: int | None = None
        self._max_request_size_result: dict[str, Any] | None = None
        self._max_request_size_lock = threading.Lock()

        try:
            self.sync_flush = bool(int(os.environ["BRAINTRUST_SYNC_FLUSH"]))
        except:
            self.sync_flush = False

        try:
            self._max_request_size_override = int(os.environ["BRAINTRUST_MAX_REQUEST_SIZE"])
        except:
            pass

        try:
            self.default_batch_size = int(os.environ["BRAINTRUST_DEFAULT_BATCH_SIZE"])
        except:
            self.default_batch_size = 100

        try:
            self.num_tries = int(os.environ["BRAINTRUST_NUM_RETRIES"]) + 1
        except:
            self.num_tries = 3

        try:
            self.queue_maxsize = int(os.environ["BRAINTRUST_QUEUE_SIZE"])
        except:
            self.queue_maxsize = DEFAULT_QUEUE_SIZE

        try:
            self.queue_drop_logging_period = float(os.environ["BRAINTRUST_QUEUE_DROP_LOGGING_PERIOD"])
        except:
            self.queue_drop_logging_period = 60

        self._queue_drop_logging_state = dict(lock=threading.Lock(), num_dropped=0, last_logged_timestamp=0)

        try:
            self.failed_publish_payloads_dir = os.environ["BRAINTRUST_FAILED_PUBLISH_PAYLOADS_DIR"]
        except:
            self.failed_publish_payloads_dir = None

        try:
            self.all_publish_payloads_dir = os.environ["BRAINTRUST_ALL_PUBLISH_PAYLOADS_DIR"]
        except:
            self.all_publish_payloads_dir = None

        self.start_thread_lock = threading.RLock()
        self.thread = threading.Thread(target=self._publisher, daemon=True)
        self.started = False

        self.logger = logging.getLogger("braintrust")
        self.queue: "LogQueue[LazyValue[Dict[str, Any]]]" = LogQueue(maxsize=self.queue_maxsize)

        # Counter for tracking overflow uploads (useful for testing)
        self._overflow_upload_count = 0

        atexit.register(self._finalize)

    def enforce_queue_size_limit(self, enforce: bool) -> None:
        """
        Set queue size limit enforcement. When enabled, the queue will drop new items
        when it reaches maxsize. When disabled (default), the queue can grow unlimited.
        """
        self.queue.enforce_queue_size_limit(enforce)

    def log(self, *args: LazyValue[dict[str, Any]]) -> None:
        self._start()
        dropped_items = []
        for event in args:
            dropped = self.queue.put(event)
            dropped_items.extend(dropped)

        if dropped_items:
            self._register_dropped_item_count(len(dropped_items))
            if self.all_publish_payloads_dir or self.failed_publish_payloads_dir:
                try:
                    HTTP_REQUEST_THREAD_POOL.submit(self._dump_dropped_events, dropped_items)
                except Exception as e:
                    traceback.print_exc(file=self.outfile)

    def _start(self):
        # Double read to avoid contention in the common case.
        if not self.started:
            with self.start_thread_lock:
                if not self.started:
                    self.thread.start()
                    self.started = True

    def _finalize(self):
        self.logger.debug("Flushing final log events...")
        self.flush()

    def _publisher(self):
        while True:
            # Wait for some data on the queue before trying to flush.
            self.queue.wait_for_items()

            while self.sync_flush:
                time.sleep(0.1)

            try:
                self.flush()
            except:
                # Print exception but don't worry if stderr is closed because the process is shutting down.
                try:
                    traceback.print_exc(file=self.outfile)
                except ValueError as e:
                    if "operation on closed file" in str(e):
                        pass
                    else:
                        raise

    def _get_max_request_size(self) -> dict[str, Any]:
        if self._max_request_size_result is not None:
            return self._max_request_size_result
        with self._max_request_size_lock:
            if self._max_request_size_result is not None:
                return self._max_request_size_result
            server_limit: int | None = None
            try:
                conn = self.api_conn.get()
                info = conn.get_json("version")
                limit = info.get("logs3_payload_max_bytes")
                if isinstance(limit, (int, float)) and int(limit) > 0:
                    server_limit = int(limit)
            except Exception as e:
                print(f"Failed to fetch version info for payload limit: {e}", file=self.outfile)
            valid_server_limit = server_limit if server_limit is not None and server_limit > 0 else None
            can_use_overflow = valid_server_limit is not None
            max_request_size = DEFAULT_MAX_REQUEST_SIZE
            if self._max_request_size_override is not None:
                max_request_size = (
                    min(self._max_request_size_override, valid_server_limit)
                    if valid_server_limit is not None
                    else self._max_request_size_override
                )
            elif valid_server_limit is not None:
                max_request_size = valid_server_limit
            self._max_request_size_result = {
                "max_request_size": max_request_size,
                "can_use_overflow": can_use_overflow,
            }
            return self._max_request_size_result

    def flush(self, batch_size: int | None = None):
        if batch_size is None:
            batch_size = self.default_batch_size

        # We cannot have multiple threads flushing in parallel, because the
        # order of published elements would be undefined.
        with self.flush_lock:
            # Drain the queue.
            wrapped_items = self.queue.drain_all()

            all_items, attachments = self._unwrap_lazy_values(wrapped_items)
            if len(all_items) == 0:
                return

            # Construct batches of records to flush in parallel.
            all_items_with_meta = [stringify_with_overflow_meta(item) for item in all_items]
            max_request_size_result = self._get_max_request_size()
            batches = batch_items(
                items=all_items_with_meta,
                batch_max_num_items=batch_size,
                batch_max_num_bytes=max_request_size_result["max_request_size"] // 2,
                get_byte_size=lambda item: len(item.str_value),
            )

            post_promises = []
            try:
                post_promises = [
                    HTTP_REQUEST_THREAD_POOL.submit(self._submit_logs_request, batch, max_request_size_result)
                    for batch in batches
                ]
            except RuntimeError:
                # If the thread pool has shut down, e.g. because the process
                # is terminating, run the requests the old fashioned way.
                for batch in batches:
                    self._submit_logs_request(batch, max_request_size_result)

            concurrent.futures.wait(post_promises)
            # Raise any exceptions from the promises as one group.
            post_promise_exceptions = [e for e in (f.exception() for f in post_promises) if e is not None]
            if post_promise_exceptions:
                raise exceptiongroup.BaseExceptionGroup(
                    f"Encountered the following errors while logging:", post_promise_exceptions
                )

            attachment_errors: list[Exception] = []
            for attachment in attachments:
                try:
                    result = attachment.upload()
                    if result["upload_status"] == "error":
                        raise RuntimeError(result.get("error_message"))
                except Exception as e:
                    attachment_errors.append(e)

            if len(attachment_errors) == 1:
                raise attachment_errors[0]
            elif len(attachment_errors) > 1:
                raise exceptiongroup.ExceptionGroup(
                    "Encountered errors while uploading attachments",
                    attachment_errors,
                )

    def _unwrap_lazy_values(
        self, wrapped_items: Sequence[LazyValue[dict[str, Any]]]
    ) -> tuple[list[dict[str, Any]], list["BaseAttachment"]]:
        for i in range(self.num_tries):
            try:
                unwrapped_items = [item.get() for item in wrapped_items]
                merged_items = merge_row_batch(unwrapped_items)

                # Apply masking after merging but before sending to backend
                if self.masking_function:
                    for item_idx in range(len(merged_items)):
                        item = merged_items[item_idx]
                        masked_item = item.copy()

                        # Only mask specific fields if they exist
                        for field in REDACTION_FIELDS:
                            if field in item:
                                masked_value = _apply_masking_to_field(self.masking_function, item[field], field)
                                if isinstance(masked_value, _MaskingError):
                                    # Drop the field and add error message
                                    if field in masked_item:
                                        del masked_item[field]
                                    if "error" in masked_item:
                                        masked_item["error"] = f"{masked_item['error']}; {masked_value.error_msg}"
                                    else:
                                        masked_item["error"] = masked_value.error_msg
                                else:
                                    masked_item[field] = masked_value

                        merged_items[item_idx] = masked_item

                attachments: list["BaseAttachment"] = []
                for item in merged_items:
                    _extract_attachments(item, attachments)

                return merged_items, attachments
            except Exception as e:
                errmsg = "Encountered error when constructing records to flush"
                is_retrying = i + 1 < self.num_tries
                if is_retrying:
                    errmsg += ". Retrying"

                if not is_retrying and self.sync_flush:
                    raise Exception(errmsg) from e
                else:
                    print(errmsg, file=self.outfile)
                    traceback.print_exc(file=self.outfile)
                    if is_retrying:
                        sleep_time_s = BACKGROUND_LOGGER_BASE_SLEEP_TIME_S * (2**i)
                        print(f"Sleeping for {sleep_time_s}s", file=self.outfile)
                        time.sleep(sleep_time_s)

        print(
            f"Failed to construct log records to flush after {self.num_tries} attempts. Dropping batch",
            file=self.outfile,
        )
        return [], []

    def _request_logs3_overflow_upload(
        self, conn: HTTPConnection, payload_size_bytes: int, rows: list[dict[str, Any]]
    ) -> dict[str, Any]:
        try:
            resp = conn.post(
                "/logs3/overflow",
                json={"content_type": "application/json", "size_bytes": payload_size_bytes, "rows": rows},
            )
            resp.raise_for_status()
            payload = resp.json()
        except Exception as e:
            raise RuntimeError(f"Failed to request logs3 overflow upload URL: {e}") from e

        method = payload.get("method")
        if method not in ("PUT", "POST"):
            raise RuntimeError(f"Invalid response from API server (method must be PUT or POST): {payload}")
        signed_url = payload.get("signedUrl")
        headers = payload.get("headers")
        fields = payload.get("fields")
        key = payload.get("key")
        if not isinstance(signed_url, str) or not isinstance(key, str):
            raise RuntimeError(f"Invalid response from API server: {payload}")
        if method == "PUT" and not isinstance(headers, dict):
            raise RuntimeError(f"Invalid response from API server: {payload}")
        if method == "POST" and not isinstance(fields, dict):
            raise RuntimeError(f"Invalid response from API server: {payload}")

        if method == "PUT":
            add_azure_blob_headers(headers, signed_url)

        return {
            "method": method,
            "signed_url": signed_url,
            "headers": headers if isinstance(headers, dict) else {},
            "fields": fields if isinstance(fields, dict) else {},
            "key": key,
        }

    def _upload_logs3_overflow_payload(self, upload: dict[str, Any], payload: str) -> None:
        obj_conn = HTTPConnection(base_url="", adapter=_http_adapter)
        method = upload["method"]
        if method == "POST":
            fields = upload.get("fields")
            if not isinstance(fields, dict):
                raise RuntimeError("Missing logs3 overflow upload fields")
            content_type = fields.get("Content-Type", "application/json")
            headers = {k: v for k, v in upload.get("headers", {}).items() if k.lower() != "content-type"}
            obj_response = obj_conn.post(
                upload["signed_url"],
                headers=headers,
                data=fields,
                files={"file": ("logs3.json", payload.encode("utf-8"), content_type)},
            )
        else:
            obj_response = obj_conn.put(
                upload["signed_url"],
                headers=upload["headers"],
                data=payload.encode("utf-8"),
            )
        obj_response.raise_for_status()

    def _submit_logs_request(self, items: Sequence[LogItemWithMeta], max_request_size_result: dict[str, Any]):
        conn = self.api_conn.get()
        dataStr = construct_logs3_data(items)
        payload_bytes = utf8_byte_length(dataStr)
        max_request_size = max_request_size_result["max_request_size"]
        can_use_overflow = max_request_size_result["can_use_overflow"]
        use_overflow = can_use_overflow and payload_bytes > max_request_size
        if self.all_publish_payloads_dir:
            _HTTPBackgroundLogger._write_payload_to_dir(payload_dir=self.all_publish_payloads_dir, payload=dataStr)
        overflow_upload: dict[str, Any] | None = None
        overflow_rows = (
            [
                {
                    "object_ids": item.overflow_meta.object_ids,
                    "has_comment": item.overflow_meta.has_comment,
                    "is_delete": item.overflow_meta.is_delete,
                    "input_row": {"byte_size": item.overflow_meta.byte_size},
                }
                for item in items
            ]
            if use_overflow
            else None
        )
        for i in range(self.num_tries):
            start_time = time.time()
            resp = None
            error = None
            try:
                if overflow_rows:
                    if overflow_upload is None:
                        current_upload = self._request_logs3_overflow_upload(conn, payload_bytes, overflow_rows)
                        self._upload_logs3_overflow_payload(current_upload, dataStr)
                        overflow_upload = current_upload
                    resp = conn.post(
                        "/logs3",
                        json=construct_logs3_overflow_request(overflow_upload["key"], payload_bytes),
                    )
                else:
                    resp = conn.post("/logs3", data=dataStr.encode("utf-8"))
            except Exception as e:
                error = e
            if error is None and resp is not None and resp.ok:
                if overflow_rows:
                    self._overflow_upload_count += 1
                return
            if error is None and resp is not None:
                resp_errmsg = f"{resp.status_code}: {resp.text}"
            else:
                resp_errmsg = str(error)

            is_retrying = i + 1 < self.num_tries
            retrying_text = "" if is_retrying else " Retrying"
            errmsg = f"log request failed. Elapsed time: {time.time() - start_time} seconds. Payload size: {payload_bytes}.{retrying_text}\nError: {resp_errmsg}"

            if not is_retrying and self.failed_publish_payloads_dir:
                _HTTPBackgroundLogger._write_payload_to_dir(
                    payload_dir=self.failed_publish_payloads_dir, payload=dataStr
                )
                self._log_failed_payloads_dir()

            if not is_retrying and self.sync_flush:
                raise Exception(errmsg)
            else:
                print(errmsg, file=self.outfile)
                if is_retrying:
                    sleep_time_s = BACKGROUND_LOGGER_BASE_SLEEP_TIME_S * (2**i)
                    print(f"Sleeping for {sleep_time_s}s", file=self.outfile)
                    time.sleep(sleep_time_s)

        print(f"log request failed after {self.num_tries} retries. Dropping batch", file=self.outfile)

    def _dump_dropped_events(self, wrapped_items):
        publish_payloads_dir = [x for x in [self.all_publish_payloads_dir, self.failed_publish_payloads_dir] if x]
        if not (wrapped_items and publish_payloads_dir):
            return
        try:
            all_items, attachments = self._unwrap_lazy_values(wrapped_items)
            items_with_meta = [stringify_with_overflow_meta(item) for item in all_items]
            dataStr = construct_logs3_data(items_with_meta)
            attachment_str = bt_dumps([a.debug_info() for a in attachments])
            payload = "{" + f""""data": {dataStr}, "attachments": {attachment_str}""" + "}"
            for output_dir in publish_payloads_dir:
                if not output_dir:
                    continue
                _HTTPBackgroundLogger._write_payload_to_dir(payload_dir=output_dir, payload=payload)
        except Exception:
            traceback.print_exc(file=self.outfile)

    def _register_dropped_item_count(self, num_items):
        if num_items <= 0:
            return
        with self._queue_drop_logging_state["lock"]:
            self._queue_drop_logging_state["num_dropped"] += num_items
            time_now = time.time()
            if time_now - self._queue_drop_logging_state["last_logged_timestamp"] >= self.queue_drop_logging_period:
                print(
                    f"Dropped {self._queue_drop_logging_state['num_dropped']} elements due to full queue",
                    file=self.outfile,
                )
                if self.failed_publish_payloads_dir:
                    self._log_failed_payloads_dir()
                self._queue_drop_logging_state["num_dropped"] = 0
                self._queue_drop_logging_state["last_logged_timestamp"] = time_now

    @staticmethod
    def _write_payload_to_dir(payload_dir, payload, debug_logging_adjective=None):
        payload_file = os.path.join(payload_dir, f"payload_{time.time()}_{str(uuid.uuid4())[:8]}.json")
        try:
            os.makedirs(payload_dir, exist_ok=True)
            with open(payload_file, "w") as f:
                f.write(payload)
        except Exception as e:
            eprint(f"Failed to write failed payload to output file {payload_file}:\n", e)

    def _log_failed_payloads_dir(self):
        print(f"Logging failed payloads to {self.failed_publish_payloads_dir}", file=self.outfile)

    # Should only be called by BraintrustState.
    def internal_replace_api_conn(self, api_conn: HTTPConnection):
        self.api_conn = LazyValue(lambda: api_conn, use_mutex=False)

    def set_masking_function(self, masking_function: Callable[[Any], Any] | None):
        """Set or update the masking function."""
        self.masking_function = masking_function


def _internal_reset_global_state() -> None:
    global _state
    _state = BraintrustState()


def _internal_get_global_state() -> BraintrustState:
    return _state


_internal_reset_global_state()
_logger = logging.getLogger("braintrust")


@contextlib.contextmanager
def _internal_with_custom_background_logger():
    custom_logger = _HTTPBackgroundLogger(LazyValue(lambda: _state.api_conn(), use_mutex=True))
    _state._override_bg_logger.logger = custom_logger
    try:
        yield custom_logger
    finally:
        _state._override_bg_logger.logger = None


@contextlib.contextmanager
def _internal_with_memory_background_logger():
    memory_logger = _MemoryBackgroundLogger()
    _state._override_bg_logger.logger = memory_logger
    try:
        yield memory_logger
    finally:
        _state._override_bg_logger.logger = None


@dataclasses.dataclass
class ObjectMetadata:
    id: str
    name: str
    full_info: dict[str, Any]


@dataclasses.dataclass
class ProjectExperimentMetadata:
    project: ObjectMetadata
    experiment: ObjectMetadata


@dataclasses.dataclass
class ProjectDatasetMetadata:
    project: ObjectMetadata
    dataset: ObjectMetadata


@dataclasses.dataclass
class OrgProjectMetadata:
    org_id: str
    project: ObjectMetadata


# Pyright produces an error for overlapping overloads
# (reportOverlappingOverload) because of the default argument to `open`. It
# thinks a call like `init()` with no arguments could match both overloads.
# However, Pyright is also able to use both overloads properly when type
# checking the caller. We can eventually add `type: ignore` if we cannot resolve
# this.
@overload
def init(
    project: str | None = ...,
    experiment: str | None = ...,
    description: str | None = ...,
    dataset: Optional["Dataset"] = ...,
    open: Literal[False] = ...,
    base_experiment: str | None = ...,
    is_public: bool = ...,
    app_url: str | None = ...,
    api_key: str | None = ...,
    org_name: str | None = ...,
    metadata: Metadata | None = ...,
    git_metadata_settings: GitMetadataSettings | None = ...,
    set_current: bool = ...,
    update: bool | None = ...,
    project_id: str | None = ...,
    base_experiment_id: str | None = ...,
    repo_info: RepoInfo | None = ...,
    state: BraintrustState | None = ...,
) -> "Experiment": ...


@overload
def init(
    project: str | None = ...,
    experiment: str | None = ...,
    description: str | None = ...,
    dataset: Optional["Dataset"] = ...,
    open: Literal[True] = ...,
    base_experiment: str | None = ...,
    is_public: bool = ...,
    app_url: str | None = ...,
    api_key: str | None = ...,
    org_name: str | None = ...,
    metadata: Metadata | None = ...,
    git_metadata_settings: GitMetadataSettings | None = ...,
    set_current: bool = ...,
    update: bool | None = ...,
    project_id: str | None = ...,
    base_experiment_id: str | None = ...,
    repo_info: RepoInfo | None = ...,
    state: BraintrustState | None = ...,
) -> "ReadonlyExperiment": ...


def init(
    project: str | None = None,
    experiment: str | None = None,
    description: str | None = None,
    dataset: Optional["Dataset"] | DatasetRef = None,
    open: bool = False,
    base_experiment: str | None = None,
    is_public: bool = False,
    app_url: str | None = None,
    api_key: str | None = None,
    org_name: str | None = None,
    metadata: Metadata | None = None,
    git_metadata_settings: GitMetadataSettings | None = None,
    set_current: bool = True,
    update: bool | None = None,
    project_id: str | None = None,
    base_experiment_id: str | None = None,
    repo_info: RepoInfo | None = None,
    state: BraintrustState | None = None,
) -> Union["Experiment", "ReadonlyExperiment"]:
    """
    Log in, and then initialize a new experiment in a specified project. If the project does not exist, it will be created.

    :param project: The name of the project to create the experiment in. Must specify at least one of `project` or `project_id`.
    :param experiment: The name of the experiment to create. If not specified, a name will be generated automatically.
    :param description: (Optional) An optional description of the experiment.
    :param dataset: (Optional) A dataset to associate with the experiment. The dataset must be initialized with `braintrust.init_dataset` before passing
    it into the experiment.
    :param update: If the experiment already exists, continue logging to it. If it does not exist, creates the experiment with the specified arguments.
    :param base_experiment: An optional experiment name to use as a base. If specified, the new experiment will be summarized and compared to this experiment. Otherwise, it will pick an experiment by finding the closest ancestor on the default (e.g. main) branch.
    :param is_public: An optional parameter to control whether the experiment is publicly visible to anybody with the link or privately visible to only members of the organization. Defaults to private.
    :param app_url: The URL of the Braintrust App. Defaults to https://www.braintrust.dev.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :param metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
    :param git_metadata_settings: (Optional) Settings for collecting git metadata. By default, will collect all git metadata fields allowed in org-level settings.
    :param set_current: If true (the default), set the global current-experiment to the newly-created one.
    :param open: If the experiment already exists, open it in read-only mode. Throws an error if the experiment does not already exist.
    :param project_id: The id of the project to create the experiment in. This takes precedence over `project` if specified.
    :param base_experiment_id: An optional experiment id to use as a base. If specified, the new experiment will be summarized and compared to this. This takes precedence over `base_experiment` if specified.
    :param repo_info: (Optional) Explicitly specify the git metadata for this experiment. This takes precedence over `git_metadata_settings` if specified.
    :param state: (Optional) A BraintrustState object to use. If not specified, will use the global state. This is for advanced use only.
    :returns: The experiment object.
    """

    state: BraintrustState = state or _state

    if project is None and project_id is None:
        raise ValueError("Must specify at least one of project or project_id")

    if open and update:
        raise ValueError("Cannot open and update an experiment at the same time")

    if open:
        if experiment is None:
            raise ValueError(f"Cannot open an experiment without specifying its name")

        def compute_metadata():
            state.login(org_name=org_name, api_key=api_key, app_url=app_url)
            args = {
                "experiment_name": experiment,
                "project_name": project,
                "project_id": project_id,
                "org_name": state.org_name,
            }

            response = state.app_conn().post_json("api/experiment/get", args)
            if len(response) == 0:
                raise ValueError(f"Experiment {experiment} not found in project {project}.")

            info = response[0]
            return ProjectExperimentMetadata(
                project=ObjectMetadata(id=info["project_id"], name=project or "UNKNOWN_PROJECT", full_info=dict()),
                experiment=ObjectMetadata(
                    id=info["id"],
                    name=info["name"],
                    full_info=info,
                ),
            )

        lazy_metadata = LazyValue(compute_metadata, use_mutex=True)
        return ReadonlyExperiment(lazy_metadata=lazy_metadata, state=state)

    # pylint: disable=function-redefined
    def compute_metadata():
        state.login(org_name=org_name, api_key=api_key, app_url=app_url)
        args = {
            "project_name": project,
            "project_id": project_id,
            "org_id": state.org_id,
            "update": update,
        }

        if experiment is not None:
            args["experiment_name"] = experiment

        if description is not None:
            args["description"] = description

        if repo_info:
            repo_info_arg = repo_info
        else:
            merged_git_metadata_settings = state.git_metadata_settings
            if git_metadata_settings is not None:
                merged_git_metadata_settings = GitMetadataSettings.merge(
                    merged_git_metadata_settings, git_metadata_settings
                )
            repo_info_arg = get_repo_info(merged_git_metadata_settings)

        if repo_info_arg:
            args["repo_info"] = repo_info_arg.as_dict()

        if base_experiment_id is not None:
            args["base_exp_id"] = base_experiment_id
        elif base_experiment is not None:
            args["base_experiment"] = base_experiment
        elif merged_git_metadata_settings and merged_git_metadata_settings.collect != "none":
            args["ancestor_commits"] = list(get_past_n_ancestors())

        if dataset is not None:
            if isinstance(dataset, dict):
                # Simple {"id": ..., "version": ...} dict
                args["dataset_id"] = dataset["id"]
                if "version" in dataset:
                    args["dataset_version"] = dataset["version"]
            else:
                # Full Dataset object
                args["dataset_id"] = dataset.id
                args["dataset_version"] = dataset.version

        if is_public is not None:
            args["public"] = is_public

        if metadata is not None:
            args["metadata"] = metadata

        while True:
            try:
                response = state.app_conn().post_json("api/experiment/register", args)
                break
            except AugmentedHTTPError as e:
                if args.get("base_experiment") is not None and "base experiment" in str(e):
                    _logger.warning(f"Base experiment {args['base_experiment']} not found.")
                    args["base_experiment"] = None
                else:
                    raise

        resp_project = response["project"]
        resp_experiment = response["experiment"]
        return ProjectExperimentMetadata(
            project=ObjectMetadata(id=resp_project["id"], name=resp_project["name"], full_info=resp_project),
            experiment=ObjectMetadata(
                id=resp_experiment["id"], name=resp_experiment["name"], full_info=resp_experiment
            ),
        )

    # For experiments, disable queue size limit enforcement (unlimited queue)
    state.enforce_queue_size_limit(False)

    ret = Experiment(
        lazy_metadata=LazyValue(compute_metadata, use_mutex=True),
        dataset=dataset if isinstance(dataset, Dataset) else None,
        state=state,
    )
    if set_current:
        state.current_experiment = ret
    return ret


def init_experiment(*args, **kwargs) -> Union["Experiment", "ReadonlyExperiment"]:
    """Alias for `init`"""

    return init(*args, **kwargs)


def init_dataset(
    project: str | None = None,
    name: str | None = None,
    description: str | None = None,
    version: str | int | None = None,
    app_url: str | None = None,
    api_key: str | None = None,
    org_name: str | None = None,
    project_id: str | None = None,
    metadata: Metadata | None = None,
    use_output: bool = DEFAULT_IS_LEGACY_DATASET,
    _internal_btql: dict[str, Any] | None = None,
    state: BraintrustState | None = None,
) -> "Dataset":
    """
    Create a new dataset in a specified project. If the project does not exist, it will be created.

    :param project_name: The name of the project to create the dataset in. Must specify at least one of `project_name` or `project_id`.
    :param name: The name of the dataset to create. If not specified, a name will be generated automatically.
    :param description: An optional description of the dataset.
    :param version: An optional version of the dataset (to read). If not specified, the latest version will be used.
    :param app_url: The URL of the Braintrust App. Defaults to https://www.braintrust.dev.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :param project_id: The id of the project to create the dataset in. This takes precedence over `project` if specified.
    :param metadata: (Optional) a dictionary with additional data about the dataset. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
    :param use_output: (Deprecated) If True, records will be fetched from this dataset in the legacy format, with the "expected" field renamed to "output". This option will be removed in a future version of Braintrust.
    :param _internal_btql: (Internal) If specified, the dataset will be created with the given BTQL filters.
    :param state: (Internal) The Braintrust state to use. If not specified, will use the global state. For advanced use only.
    :returns: The dataset object.
    """

    state = state or _state

    def compute_metadata():
        state.login(org_name=org_name, api_key=api_key, app_url=app_url)
        args = _populate_args(
            {"project_name": project, "project_id": project_id, "org_id": state.org_id},
            dataset_name=name,
            description=description,
            metadata=metadata,
        )
        response = state.app_conn().post_json("api/dataset/register", args)
        resp_project = response["project"]
        resp_dataset = response["dataset"]
        return ProjectDatasetMetadata(
            project=ObjectMetadata(id=resp_project["id"], name=resp_project["name"], full_info=resp_project),
            dataset=ObjectMetadata(id=resp_dataset["id"], name=resp_dataset["name"], full_info=resp_dataset),
        )

    return Dataset(
        lazy_metadata=LazyValue(compute_metadata, use_mutex=True),
        version=version,
        legacy=use_output,
        _internal_btql=_internal_btql,
        state=state,
    )


def _compute_logger_metadata(project_name: str | None = None, project_id: str | None = None):
    login()
    org_id = _state.org_id
    if project_id is None:
        response = _state.app_conn().post_json(
            "api/project/register",
            {
                "project_name": project_name or GLOBAL_PROJECT,
                "org_id": org_id,
            },
        )
        resp_project = response["project"]
        return OrgProjectMetadata(
            org_id=org_id,
            project=ObjectMetadata(id=resp_project["id"], name=resp_project["name"], full_info=resp_project),
        )
    elif project_name is None:
        response = _state.app_conn().get_json("api/project", {"id": project_id})
        return OrgProjectMetadata(
            org_id=org_id, project=ObjectMetadata(id=project_id, name=response["name"], full_info=response)
        )
    else:
        return OrgProjectMetadata(
            org_id=org_id, project=ObjectMetadata(id=project_id, name=project_name, full_info=dict())
        )


def init_logger(
    project: str | None = None,
    project_id: str | None = None,
    async_flush: bool = True,
    app_url: str | None = None,
    api_key: str | None = None,
    org_name: str | None = None,
    force_login: bool = False,
    set_current: bool = True,
    state: BraintrustState | None = None,
) -> "Logger":
    """
    Create a new logger in a specified project. If the project does not exist, it will be created.

    :param project: The name of the project to log into. If unspecified, will default to the Global project.
    :param project_id: The id of the project to log into. This takes precedence over project if specified.
    :param async_flush: If true (the default), log events will be batched and sent asynchronously in a background thread. If false, log events will be sent synchronously. Set to false in serverless environments.
    :param app_url: The URL of the Braintrust API. Defaults to https://www.braintrust.dev.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :param force_login: Login again, even if you have already logged in (by default, the logger will not login if you are already logged in)
    :param set_current: If true (the default), set the global current-experiment to the newly-created one.
    :returns: The newly created Logger.
    """

    state = state or _state
    compute_metadata_args = dict(project_name=project, project_id=project_id)

    link_args = {
        "app_url": app_url,
        "org_name": org_name,
        "project_name": project,
        "project_id": project_id,
    }

    def compute_metadata():
        state.login(org_name=org_name, api_key=api_key, app_url=app_url, force_login=force_login)
        return _compute_logger_metadata(**compute_metadata_args)

    # For loggers, enable queue size limit enforcement (bounded queue)
    state.enforce_queue_size_limit(True)

    ret = Logger(
        lazy_metadata=LazyValue(compute_metadata, use_mutex=True),
        async_flush=async_flush,
        compute_metadata_args=compute_metadata_args,
        link_args=link_args,
        state=state,
    )
    if set_current:
        if _state is None:
            raise RuntimeError("_state is None in init_logger. This should never happen.")
        _state._cv_logger.set(ret)
        _state._local_logger = ret
    return ret


def load_prompt(
    project: str | None = None,
    slug: str | None = None,
    version: str | int | None = None,
    project_id: str | None = None,
    id: str | None = None,
    defaults: Mapping[str, Any] | None = None,
    no_trace: bool = False,
    environment: str | None = None,
    app_url: str | None = None,
    api_key: str | None = None,
    org_name: str | None = None,
) -> "Prompt":
    """
    Loads a prompt from the specified project.

    :param project: The name of the project to load the prompt from. Must specify at least one of `project` or `project_id`.
    :param slug: The slug of the prompt to load.
    :param version: An optional version of the prompt (to read). If not specified, the latest version will be used.
    :param project_id: The id of the project to load the prompt from. This takes precedence over `project` if specified.
    :param id: The id of a specific prompt to load. If specified, this takes precedence over all other parameters (project, slug, version).
    :param defaults: (Optional) A dictionary of default values to use when rendering the prompt. Prompt values will override these defaults.
    :param no_trace: If true, do not include logging metadata for this prompt when build() is called.
    :param environment: The environment to load the prompt from. Cannot be used together with version.
    :param app_url: The URL of the Braintrust App. Defaults to https://www.braintrust.dev.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :returns: The prompt object.
    """
    if version is not None and environment is not None:
        raise ValueError(
            "Cannot specify both 'version' and 'environment' parameters. Please use only one (remove the other)."
        )

    if id:
        # When loading by ID, we don't need project or slug
        pass
    elif not project and not project_id:
        raise ValueError("Must specify at least one of project or project_id")
    elif not slug:
        raise ValueError("Must specify slug")

    def compute_metadata():
        try:
            login(org_name=org_name, api_key=api_key, app_url=app_url)
            if id:
                # Load prompt by ID using the /v1/prompt/{id} endpoint
                prompt_args = {}
                if version is not None:
                    prompt_args["version"] = version
                if environment is not None:
                    prompt_args["environment"] = environment
                response = _state.api_conn().get_json(f"/v1/prompt/{id}", prompt_args)
                # Wrap single prompt response in objects array to match list API format
                if response is not None:
                    response = {"objects": [response]}
            else:
                args = _populate_args(
                    {
                        "project_name": project,
                        "project_id": project_id,
                        "slug": slug,
                        "version": version,
                        "environment": environment,
                    },
                )
                response = _state.api_conn().get_json("/v1/prompt", args)
        except Exception as server_error:
            # If environment or version was specified, don't fall back to cache
            if environment is not None or version is not None:
                raise ValueError(f"Prompt not found with specified parameters") from server_error

            eprint(f"Failed to load prompt, attempting to fall back to cache: {server_error}")
            try:
                if id:
                    return _state._prompt_cache.get(id=id)
                else:
                    return _state._prompt_cache.get(
                        slug,
                        version=str(version) if version else "latest",
                        project_id=project_id,
                        project_name=project,
                    )
            except Exception as cache_error:
                if id:
                    raise ValueError(
                        f"Prompt with id {id} not found (not found on server or in local cache): {cache_error}"
                    ) from server_error
                else:
                    raise ValueError(
                        f"Prompt {slug} (version {version or 'latest'}) not found in {project or project_id} (not found on server or in local cache): {cache_error}"
                    ) from server_error
        if response is None or "objects" not in response or len(response["objects"]) == 0:
            if id:
                raise ValueError(f"Prompt with id {id} not found.")
            else:
                raise ValueError(f"Prompt {slug} not found in project {project or project_id}.")
        elif len(response["objects"]) > 1:
            if id:
                raise ValueError(f"Multiple prompts found with id {id}. This should never happen.")
            else:
                raise ValueError(
                    f"Multiple prompts found with slug {slug} in project {project or project_id}. This should never happen."
                )
        resp_prompt = response["objects"][0]
        prompt = PromptSchema.from_dict_deep(resp_prompt)
        try:
            if id:
                _state._prompt_cache.set(
                    prompt,
                    id=id,
                )
            elif slug:
                _state._prompt_cache.set(
                    prompt,
                    slug=slug,
                    version=str(version) if version else "latest",
                    project_id=project_id,
                    project_name=project,
                )
        except Exception as e:
            eprint(f"Failed to store prompt in cache: {e}")
        return prompt

    return Prompt(
        lazy_metadata=LazyValue(compute_metadata, use_mutex=True), defaults=defaults or {}, no_trace=no_trace
    )


login_lock = threading.RLock()


def login(
    app_url: str | None = None,
    api_key: str | None = None,
    org_name: str | None = None,
    force_login: bool = False,
) -> None:
    """
    Log into Braintrust. This will prompt you for your API token, which you can find at
    https://www.braintrust.dev/app/token. This method is called automatically by `init()`.

    :param app_url: The URL of the Braintrust App. Defaults to https://www.braintrust.dev.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :param force_login: Login again, even if you have already logged in (by default, this function will exit quickly if you have already logged in)
    """
    # FIXME[matt] Remove thrown exceptions from this method. Perhaps a better pattern is (is_success, message) = login()
    # to guarantee we don't throw into userland.

    global _state

    # Only permit one thread to login at a time
    with login_lock:
        _state.login(app_url=app_url, api_key=api_key, org_name=org_name, force_login=force_login)


def register_otel_flush(callback: Any) -> None:
    """
    Register a callback to flush OTEL spans. This is called by the OTEL integration
    when it initializes a span processor/exporter.

    When ensure_spans_flushed is called (e.g., before a BTQL query in scorers),
    this callback will be invoked to ensure OTEL spans are flushed to the server.

    Also disables the span cache, since OTEL spans aren't in the local cache
    and we need BTQL to see the complete span tree (both native + OTEL spans).

    :param callback: The async callback function to flush OTEL spans.
    """
    global _state
    _state.register_otel_flush(callback)
    # Disable span cache since OTEL spans aren't in the local cache
    _state.span_cache.disable()


def login_to_state(
    app_url: str | None = None,
    api_key: str | None = None,
    org_name: str | None = None,
) -> BraintrustState:
    app_url = _get_app_url(app_url)

    app_public_url = os.environ.get("BRAINTRUST_APP_PUBLIC_URL", app_url)

    if api_key is None:
        api_key = os.environ.get("BRAINTRUST_API_KEY")

    org_name = _get_org_name(org_name)

    state = BraintrustState()

    state.app_url = app_url
    state.app_public_url = app_public_url
    state.org_name = org_name

    conn = None
    if api_key == TEST_API_KEY:
        # a small hook for pseudo-logins
        test_org_info = [
            {
                "id": "test-org-id",
                "name": org_name or "test-org-name",
                "api_url": "https://api.braintrust.ai",
                "proxy_url": "https://proxy.braintrust.ai",
            }
        ]
        _check_org_info(state, test_org_info, org_name)
        state.login_token = TEST_API_KEY
        state.logged_in = True
        return state
    elif api_key is not None:
        app_conn = HTTPConnection(state.app_url, adapter=_http_adapter)
        app_conn.set_token(api_key)
        resp = app_conn.post("api/apikey/login")
        if not resp.ok:
            masked_api_key = mask_api_key(api_key)
            raise ValueError(f"Invalid API key {masked_api_key}: [{resp.status_code}] {resp.text}")
        info = resp.json()

        _check_org_info(state, info["org_info"], org_name)

        if not state.api_url:
            if org_name:
                raise ValueError(
                    f"Unable to log into organization '{org_name}'."
                    " Are you sure this credential is scoped to the organization?"
                )
            else:
                raise ValueError("Unable to log into any organization with the provided credential.")

        conn = state.api_conn()
        conn.set_token(api_key)

    if not conn:
        raise ValueError("Could not login to Braintrust. You may need to set BRAINTRUST_API_KEY in your environment.")

    # make_long_lived() allows the connection to retry if it breaks, which we're okay with after
    # this point because we know the connection _can_ successfully ping.
    conn.make_long_lived()

    # Same for the app conn, which we know is valid because we have
    # successfully logged in.
    state.app_conn().make_long_lived()

    # Set the same token in the API
    state.app_conn().set_token(conn.token)
    if state.proxy_url:
        state.proxy_conn().set_token(conn.token)
        state.proxy_conn().make_long_lived()
    state.login_token = conn.token
    state.logged_in = True

    # Replace the global logger's api_conn with this one.
    state.login_replace_api_conn(conn)

    return state


def set_masking_function(masking_function: Callable[[Any], Any] | None) -> None:
    """
    Set a global masking function that will be applied to all logged data before sending to Braintrust.
    The masking function will be applied after records are merged but before they are sent to the backend.

    :param masking_function: A function that takes a JSON-serializable object and returns a masked version.
                           Set to None to disable masking.
    """
    _state.set_masking_function(masking_function)


def log(**event: Any) -> str:
    """
    Log a single event to the current experiment. The event will be batched and uploaded behind the scenes.

    :param **event: Data to be logged. See `Experiment.log` for full details.
    :returns: The `id` of the logged event.
    """
    eprint(
        "braintrust.log is deprecated and will be removed in a future version of braintrust. Use `experiment.log` instead."
    )
    e = current_experiment()
    if not e:
        raise Exception("Not initialized. Please call init() first")
    return e.log(**event)


def summarize(summarize_scores: bool = True, comparison_experiment_id: str | None = None) -> "ExperimentSummary":
    """
    Summarize the current experiment, including the scores (compared to the closest reference experiment) and metadata.

    :param summarize_scores: Whether to summarize the scores. If False, only the metadata will be returned.
    :param comparison_experiment_id: The experiment to compare against. If None, the most recent experiment on the comparison_commit will be used.
    :returns: `ExperimentSummary`
    """
    eprint(
        "braintrust.summarize is deprecated and will be removed in a future version of braintrust. Use `experiment.summarize` instead."
    )
    e = current_experiment()
    if e is None:
        raise Exception("Not initialized. Please call init() first")
    return e.summarize(
        summarize_scores=summarize_scores,
        comparison_experiment_id=comparison_experiment_id,
    )


def current_experiment() -> Optional["Experiment"]:
    """Returns the currently-active experiment (set by `braintrust.init(...)`). Returns None if no current experiment has been set."""

    return _state.current_experiment


def current_logger() -> Optional["Logger"]:
    """Returns the currently-active logger (set by `braintrust.init_logger(...)`). Returns None if no current logger has been set."""

    return _state._cv_logger.get() or _state._local_logger


def current_span() -> Span:
    """Return the currently-active span for logging (set by running a span under a context manager). If there is no active span, returns a no-op span object, which supports the same interface as spans but does no logging.

    See `Span` for full details.
    """

    span_info = _state.context_manager.get_current_span_info()
    if span_info and hasattr(span_info.span_object, "span_id"):
        # This is a BT span
        return span_info.span_object
    return NOOP_SPAN


@contextlib.contextmanager
def parent_context(parent: str | None, state: BraintrustState | None = None):
    """
    Context manager to temporarily set the parent context for spans.

    Args:
        parent: The parent string to set during the context
        state: Optional BraintrustState to use. If not provided, uses the global state.

    Example:
        with parent_context('parent-id-123', state=state):
            # Any spans created here will use 'parent-id-123' as their parent
            span = start_span("my-span")
    """
    state = state or _state
    token = state.current_parent.set(parent)
    try:
        yield
    finally:
        state.current_parent.reset(token)


def get_span_parent_object(
    parent: str | None = None, state: BraintrustState | None = None
) -> Union[SpanComponentsV4, "Logger", "Experiment", Span]:
    """Mainly for internal use. Return the parent object for starting a span in a global context.
    Applies precedence: current span > propagated parent string > experiment > logger."""

    if state is None:
        state = _state

    span = current_span()
    if span != NOOP_SPAN:
        return span

    parent = parent or state.current_parent.get()
    if parent:
        return SpanComponentsV4.from_str(parent)

    experiment = current_experiment()
    if experiment:
        return experiment

    logger = current_logger()
    if logger:
        return logger

    return NOOP_SPAN


def _try_log_input(span, f_sig, f_args, f_kwargs):
    if f_sig:
        input_data = f_sig.bind(*f_args, **f_kwargs).arguments
    else:
        input_data = dict(args=f_args, kwargs=f_kwargs)
    span.log(input=input_data)


def _try_log_output(span, output):
    span.log(output=output)


F = TypeVar("F", bound=Callable[..., Any])


@overload
def traced(f: F) -> F:
    """Decorator to trace the wrapped function when used without parentheses."""


@overload
def traced(*span_args: Any, **span_kwargs: Any) -> Callable[[F], F]:
    """Decorator to trace the wrapped function when used with arguments."""


def traced(*span_args: Any, **span_kwargs: Any) -> Callable[[F], F]:
    """Decorator to trace the wrapped function. Can either be applied bare (`@traced`) or by providing arguments (`@traced(*span_args, **span_kwargs)`), which will be forwarded to the created span. See `Span.start_span` for full details on the span arguments.

    It checks the following (in precedence order):

        * Currently-active span
        * Currently-active experiment
        * Currently-active logger

    and creates a span in the first one that is active. If none of these are active, it returns a no-op span object.

    The decorator will automatically log the input and output of the wrapped function to the corresponding fields of the created span. Pass the kwarg `notrace_io=True` to the decorator to prevent this.

    Unless a name is explicitly provided in `span_args` or `span_kwargs`, the name of the span will be the name of the decorated function.
    """

    trace_io = not span_kwargs.pop("notrace_io", False)

    def decorator(span_args, span_kwargs, f: F):
        # We assume 'name' is the first positional argument in `start_span`.
        if len(span_args) == 0 and span_kwargs.get("name") is None:
            span_args += (f.__name__,)

        try:
            f_sig = inspect.signature(f)
        except:
            f_sig = None

        if "span_attributes" not in span_kwargs:
            span_kwargs["span_attributes"] = {}
        if "type" not in span_kwargs["span_attributes"] and "type" not in span_kwargs:
            span_kwargs["span_attributes"]["type"] = SpanTypeAttribute.FUNCTION

        @wraps(f)
        def wrapper_sync(*f_args, **f_kwargs):
            with start_span(*span_args, **span_kwargs) as span:
                if trace_io:
                    _try_log_input(span, f_sig, f_args, f_kwargs)
                ret = f(*f_args, **f_kwargs)
                if trace_io:
                    _try_log_output(span, ret)
                return ret

        @wraps(f)
        async def wrapper_async(*f_args, **f_kwargs):
            with start_span(*span_args, **span_kwargs) as span:
                if trace_io:
                    _try_log_input(span, f_sig, f_args, f_kwargs)
                ret = await f(*f_args, **f_kwargs)
                if trace_io:
                    _try_log_output(span, ret)
                return ret

        @wraps(f)
        async def wrapper_async_gen(*f_args, **f_kwargs):
            with start_span(*span_args, **span_kwargs) as span:
                if trace_io:
                    _try_log_input(span, f_sig, f_args, f_kwargs)

                # Get max items from environment or default
                max_items = int(os.environ.get("BRAINTRUST_MAX_GENERATOR_ITEMS", "1000"))

                if trace_io and max_items != 0:
                    # Collect output up to limit
                    collected = []
                    truncated = False

                    async_gen = f(*f_args, **f_kwargs)
                    try:
                        async for value in async_gen:
                            if max_items == -1 or (not truncated and len(collected) < max_items):
                                collected.append(value)
                            else:
                                truncated = True
                                collected = []
                                _logger.warning(
                                    f"Generator output exceeded limit of {max_items} items, output not logged. "
                                    "Increase BRAINTRUST_MAX_GENERATOR_ITEMS or set to -1 to disable limit."
                                )
                            yield value

                        if not truncated:
                            _try_log_output(span, collected)
                    except Exception as e:
                        # Log partial output on error
                        if collected and not truncated:
                            _try_log_output(span, collected)
                        raise
                else:
                    # Original behavior - no collection
                    async_gen = f(*f_args, **f_kwargs)
                    async for value in async_gen:
                        yield value

        @wraps(f)
        def wrapper_sync_gen(*f_args, **f_kwargs):
            with start_span(*span_args, **span_kwargs) as span:
                if trace_io:
                    _try_log_input(span, f_sig, f_args, f_kwargs)

                # Get max items from environment or default
                max_items = int(os.environ.get("BRAINTRUST_MAX_GENERATOR_ITEMS", "1000"))

                if trace_io and max_items != 0:
                    # Collect output up to limit
                    collected = []
                    truncated = False

                    sync_gen = f(*f_args, **f_kwargs)
                    try:
                        for value in sync_gen:
                            if max_items == -1 or (not truncated and len(collected) < max_items):
                                collected.append(value)
                            else:
                                truncated = True
                                collected = []
                                _logger.warning(
                                    f"Generator output exceeded limit of {max_items} items, output not logged. "
                                    "Increase BRAINTRUST_MAX_GENERATOR_ITEMS or set to -1 to disable limit."
                                )
                            yield value

                        if not truncated:
                            _try_log_output(span, collected)
                    except Exception as e:
                        # Log partial output on error
                        if collected and not truncated:
                            _try_log_output(span, collected)
                        raise
                else:
                    # Original behavior - no collection
                    sync_gen = f(*f_args, **f_kwargs)
                    for value in sync_gen:
                        yield value

        if inspect.isasyncgenfunction(f):
            return cast(F, wrapper_async_gen)
        elif inspect.isgeneratorfunction(f):
            return cast(F, wrapper_sync_gen)
        elif bt_iscoroutinefunction(f):
            return cast(F, wrapper_async)
        else:
            return cast(F, wrapper_sync)

    # We determine if the decorator is invoked bare or with arguments by
    # checking if the first positional argument to the decorator is a callable.
    if len(span_args) == 1 and len(span_kwargs) == 0 and callable(span_args[0]):
        return decorator(span_args[1:], span_kwargs, cast(F, span_args[0]))
    else:
        return cast(Callable[[F], F], partial(decorator, span_args, span_kwargs))


def start_span(
    name: str | None = None,
    type: SpanTypeAttribute | None = None,
    span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
    start_time: float | None = None,
    set_current: bool | None = None,
    parent: str | None = None,
    propagated_event: dict[str, Any] | None = None,
    state: BraintrustState | None = None,
    **event: Any,
) -> Span:
    """Lower-level alternative to `@traced` for starting a span at the toplevel. It creates a span under the first active object (using the same precedence order as `@traced`), or if `parent` is specified, under the specified parent row, or returns a no-op span object.

    We recommend running spans bound to a context manager (`with start_span`) to automatically mark them as current and ensure they are terminated. If you wish to start a span outside a context manager, be sure to terminate it with `span.end()`.

    See `Span.start_span` for full details.
    """

    if not state:
        state = _state

    parent_obj = get_span_parent_object(parent, state)

    if isinstance(parent_obj, SpanComponentsV4):
        if parent_obj.row_id and parent_obj.span_id and parent_obj.root_span_id:
            parent_span_ids = ParentSpanIds(span_id=parent_obj.span_id, root_span_id=parent_obj.root_span_id)
        else:
            parent_span_ids = None
        return SpanImpl(
            parent_object_type=parent_obj.object_type,
            parent_object_id=LazyValue(_span_components_to_object_id_lambda(parent_obj), use_mutex=False),
            parent_compute_object_metadata_args=parent_obj.compute_object_metadata_args,
            parent_span_ids=parent_span_ids,
            name=name,
            type=type,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            propagated_event=coalesce(propagated_event, parent_obj.propagated_event),
            event=event,
            state=state,
            lookup_span_parent=False,
        )
    else:
        return parent_obj.start_span(
            name=name,
            type=type,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            parent=parent,
            propagated_event=propagated_event,
            **event,
        )


def flush():
    """Flush any pending rows to the server."""

    _state.global_bg_logger().flush()


def _check_org_info(state, org_info, org_name):
    if len(org_info) == 0:
        raise ValueError("This user is not part of any organizations.")

    for orgs in org_info:
        if org_name is None or orgs["name"] == org_name:
            state.org_id = orgs["id"]
            state.org_name = orgs["name"]
            state.api_url = os.environ.get("BRAINTRUST_API_URL", orgs["api_url"])
            state.proxy_url = os.environ.get("BRAINTRUST_PROXY_URL", orgs["proxy_url"])
            state.git_metadata_settings = GitMetadataSettings(**(orgs.get("git_metadata") or {}))
            break

    if state.org_id is None:
        raise ValueError(
            f"Organization {org_name} not found. Must be one of {', '.join([x['name'] for x in org_info])}"
        )


def _populate_args(d, **kwargs):
    for k, v in kwargs.items():
        if v is not None:
            d[k] = v

    return d


def _filter_none_args(args):
    new_args = {}
    for k, v in args.items():
        if v is not None:
            new_args[k] = v
    return new_args


def validate_tags(tags: Sequence[str]) -> None:
    # Tag should be a list, set, or tuple, not a dict or string
    if not isinstance(tags, (list, set, tuple)):
        raise ValueError("tags must be a list, set, or tuple of strings")

    seen = set()
    for tag in tags:
        if not isinstance(tag, str):
            raise ValueError("tags must be strings")
        if tag in seen:
            raise ValueError(f"duplicate tag: {tag}")
        seen.add(tag)


def _extract_attachments(event: dict[str, Any], attachments: list["BaseAttachment"]) -> None:
    """
    Helper function for uploading attachments. Recursively extracts `Attachment`
    and `ExternalAttachment` values and replaces them with their associated
    `AttachmentReference` objects.

    :param event: The event to filter. Will be modified in-place.
    :param attachments: Flat array of extracted attachments (output parameter).
    """

    def _helper(v: Any) -> Any:
        # Base case: Attachment or ExternalAttachment.
        if isinstance(v, BaseAttachment):
            attachments.append(v)
            return v.reference  # Attachment cannot be nested.

        # Recursive case: object.
        if isinstance(v, dict):
            for k, v2 in v.items():
                v[k] = _helper(v2)
            return v

        # Recursive case: array.
        if isinstance(v, list):
            for i in range(len(v)):
                v[i] = _helper(v[i])
            return v

        # Base case: non object.
        return v  # Nothing to explore recursively.

    for k, v in event.items():
        event[k] = _helper(v)


def _enrich_attachments(event: TMutableMapping) -> TMutableMapping:
    """
    Recursively hydrates any `AttachmentReference` into `ReadonlyAttachment` by modifying the input in-place.

    :returns: The same event instance as the input.
    """

    def _helper(v: Any) -> Any:
        if isinstance(v, dict):
            # Base case: AttachmentReference.
            if v.get("type") == "braintrust_attachment" or v.get("type") == "external_attachment":
                return ReadonlyAttachment(cast(AttachmentReference, v))
            else:
                # Recursive case: object.
                for k, v2 in v.items():
                    v[k] = _helper(v2)
                return v

        # Recursive case: array.
        if isinstance(v, list):
            for i in range(len(v)):
                v[i] = _helper(v[i])
            return v

        # Base case: non object.
        return v  # Nothing to explore recursively.

    for k, v in event.items():
        event[k] = _helper(v)

    return event


def _validate_and_sanitize_experiment_log_partial_args(event: Mapping[str, Any]) -> dict[str, Any]:
    scores = event.get("scores")
    if scores:
        for name, score in scores.items():
            if not isinstance(name, str):
                raise ValueError("score names must be strings")

            if score is None:
                continue

            if isinstance(score, bool):
                score = 1 if score else 0
                scores[name] = score

            if not isinstance(score, (int, float)):
                raise ValueError("score values must be numbers")
            if score < 0 or score > 1:
                raise ValueError("score values must be between 0 and 1")

    metadata = event.get("metadata")
    if metadata:
        if not isinstance(metadata, dict):
            raise ValueError("metadata must be a dictionary")
        for key in metadata.keys():
            if not isinstance(key, str):
                raise ValueError("metadata keys must be strings")

    metrics = event.get("metrics")
    if metrics:
        if not isinstance(metrics, dict):
            raise ValueError("metrics must be a dictionary")
        for key in metrics.keys():
            if not isinstance(key, str):
                raise ValueError("metric keys must be strings")

        for value in metrics.values():
            if not isinstance(value, (int, float)):
                raise ValueError("metric values must be numbers")

    tags = event.get("tags")
    if tags:
        validate_tags(tags)

    span_attributes = event.get("span_attributes")
    if span_attributes:
        if not isinstance(span_attributes, dict):
            raise ValueError("span_attributes must be a dictionary")
        for key in span_attributes.keys():
            if not isinstance(key, str):
                raise ValueError("span_attributes keys must be strings")

    input = event.get("input")
    inputs = event.get("inputs")
    if input is not None and inputs is not None:
        raise ValueError("Only one of input or inputs (deprecated) can be specified. Prefer input.")
    if inputs is not None:
        return dict(**{k: v for k, v in event.items() if k not in ["input", "inputs"]}, input=inputs)
    else:
        return {k: v for k, v in event.items()}


# Note that this only checks properties that are expected of a complete event.
# _validate_and_sanitize_experiment_log_partial_args should still be invoked
# (after handling special fields like 'id').
def _validate_and_sanitize_experiment_log_full_args(event: Mapping[str, Any], has_dataset: bool) -> Mapping[str, Any]:
    input = event.get("input")
    inputs = event.get("inputs")
    if (input is not None and inputs is not None) or (input is None and inputs is None):
        raise ValueError("Exactly one of input or inputs (deprecated) must be specified. Prefer input.")

    if event.get("output") is None:
        raise ValueError("output must be specified")
    if event.get("scores") is None:
        raise ValueError("scores must be specified")
    elif not isinstance(event["scores"], dict):
        raise ValueError("scores must be a dictionary of names with scores")

    return event


class ObjectIterator(Generic[T]):
    def __init__(self, refetch_fn: Callable[[], Sequence[T]]):
        self.refetch_fn = refetch_fn
        self.idx = 0

    def __iter__(self):
        return self

    def __next__(self) -> T:
        data = self.refetch_fn()
        if self.idx >= len(data):
            raise StopIteration
        value = data[self.idx]
        self.idx += 1

        return value


DEFAULT_FETCH_BATCH_SIZE = 1000
MAX_BTQL_ITERATIONS = 10000


class ObjectFetcher(ABC, Generic[TMapping]):
    def __init__(
        self,
        object_type: str,
        pinned_version: None | int | str = None,
        mutate_record: Callable[[TMapping], TMapping] | None = None,
        _internal_btql: dict[str, Any] | None = None,
    ):
        self.object_type = object_type

        if pinned_version is not None:
            try:
                pv = int(pinned_version)
                assert pv >= 0
            except (ValueError, AssertionError):
                raise ValueError(f"version ({pinned_version}) must be a positive integer")

        self._pinned_version = str(pinned_version) if pinned_version is not None else None
        self._mutate_record = mutate_record

        self._fetched_data: list[TMapping] | None = None
        self._internal_btql = _internal_btql

    def fetch(self, batch_size: int | None = None) -> Iterator[TMapping]:
        """
        Fetch all records.

        ```python
        for record in object.fetch():
            print(record)

        # You can also iterate over the object directly.
        for record in object:
            print(record)
        ```

        :param batch_size: The number of records to fetch per request. Defaults to 1000.
        :returns: An iterator over the records.
        """
        return ObjectIterator(lambda: self._refetch(batch_size=batch_size))

    def __iter__(self) -> Iterator[TMapping]:
        return self.fetch()

    @property
    def fetched_data(self):
        eprint(
            ".fetched_data is deprecated and will be removed in a future version of braintrust. Use .fetch() or the iterator instead"
        )
        return self._refetch()

    @abstractmethod
    def _get_state(self) -> BraintrustState: ...

    @property
    @abstractmethod
    def id(self) -> str: ...

    def _refetch(self, batch_size: int | None = None) -> list[TMapping]:
        state = self._get_state()
        limit = batch_size if batch_size is not None else DEFAULT_FETCH_BATCH_SIZE
        if self._fetched_data is None:
            cursor = None
            data = None
            iterations = 0
            while True:
                resp = state.api_conn().post(
                    f"btql",
                    json={
                        "query": {
                            "select": [{"op": "star"}],
                            "from": {
                                "op": "function",
                                "name": {
                                    "op": "ident",
                                    "name": [self.object_type],
                                },
                                "args": [
                                    {
                                        "op": "literal",
                                        "value": self.id,
                                    },
                                ],
                            },
                            "cursor": cursor,
                            "limit": limit,
                            **(self._internal_btql or {}),
                        },
                        "use_columnstore": False,
                        "brainstore_realtime": True,
                        "query_source": f"py_sdk_object_fetcher_{self.object_type}",
                        **({"version": self._pinned_version} if self._pinned_version is not None else {}),
                    },
                    headers={
                        "Accept-Encoding": "gzip",
                    },
                )
                response_raise_for_status(resp)
                resp_json = resp.json()
                data = (data or []) + cast(list[TMapping], resp_json["data"])
                if not resp_json.get("cursor", None):
                    break
                cursor = resp_json.get("cursor", None)
                iterations += 1
                if iterations > MAX_BTQL_ITERATIONS:
                    raise RuntimeError("Too many BTQL iterations")

            if not isinstance(data, list):
                raise ValueError(f"Expected a list in the response, got {type(data)}")
            if self._mutate_record is not None:
                self._fetched_data = [self._mutate_record(r) for r in data]
            else:
                self._fetched_data = data

        return self._fetched_data

    def _clear_cache(self) -> None:
        self._fetched_data = None

    @property
    def version(self) -> str:
        if self._pinned_version is not None:
            return self._pinned_version
        else:
            return max([str(record.get(TRANSACTION_ID_FIELD, "0")) for record in self._refetch()] or ["0"])


class BaseAttachment(ABC):
    @property
    @abstractmethod
    def reference(self) -> AttachmentReference: ...

    @property
    @abstractmethod
    def data(self) -> bytes: ...

    @abstractmethod
    def upload(self) -> AttachmentStatus: ...

    @abstractmethod
    def debug_info(self) -> Mapping[str, Any]: ...


class Attachment(BaseAttachment):
    """
    Represents an attachment to be uploaded and the associated metadata.

    `Attachment` objects can be inserted anywhere in an event, allowing you to
    log arbitrary file data. The SDK will asynchronously upload the file to
    object storage and replace the `Attachment` object with an
    `AttachmentReference`.
    """

    def __init__(
        self,
        *,
        data: str | bytes | bytearray,
        filename: str,
        content_type: str,
    ):
        """
        Construct an attachment.

        :param data: A string representing the path of the file on disk, or a `bytes`/`bytearray` with the file's contents. The caller is responsible for ensuring the file on disk or mutable `bytearray` is not modified until upload is complete.

        :param filename: The desired name of the file in Braintrust after uploading. This parameter is for visualization purposes only and has no effect on attachment storage.

        :param content_type: The MIME type of the file.
        """
        self._reference: AttachmentReference = {
            "type": "braintrust_attachment",
            "filename": filename,
            "content_type": content_type,
            "key": str(uuid.uuid4()),
        }
        self._data_debug_string = data if isinstance(data, str) else "<in-memory data>"

        self._data = self._init_data(data)
        self._uploader = self._init_uploader()

    @property
    def reference(self) -> AttachmentReference:
        """The object that replaces this `Attachment` at upload time."""
        return self._reference

    @property
    def data(self) -> bytes:
        """The attachment contents. This is a lazy value that will read the attachment contents from disk or memory on first access."""
        return self._data.get()

    def upload(self) -> AttachmentStatus:
        """
        On first access, (1) reads the attachment from disk if needed, (2) authenticates with the data plane to request a signed URL, (3) uploads to object store, and (4) updates the attachment.

        :returns: The attachment status.
        """
        return self._uploader.get()

    def debug_info(self) -> Mapping[str, Any]:
        """
        A human-readable description for logging and debugging.

        :returns: The debug object. The return type is not stable and may change in a future release.
        """
        return {"input_data": self._data_debug_string, "reference": self._reference}

    def _init_uploader(self) -> LazyValue[AttachmentStatus]:
        def do_upload(api_conn: HTTPConnection, org_id: str) -> Mapping[str, Any]:
            assert self._reference["type"] == "braintrust_attachment"

            request_params = {
                "key": self._reference["key"],
                "filename": self._reference["filename"],
                "content_type": self._reference["content_type"],
                "org_id": org_id,
            }

            try:
                metadata_response = api_conn.post("/attachment", json=request_params)
                metadata_response.raise_for_status()
                metadata = metadata_response.json()
            except Exception as e:
                raise RuntimeError(f"Failed to request signed URL from API server: {e}") from e

            try:
                data = self._data.get()
            except Exception as e:
                raise OSError(f"Failed to read file: {e}") from e

            signed_url = metadata.get("signedUrl")
            headers = metadata.get("headers")
            if not isinstance(signed_url, str) or not isinstance(headers, dict):
                raise RuntimeError(f"Invalid response from API server: {metadata}")

            add_azure_blob_headers(headers, signed_url)

            # TODO multipart upload.
            try:
                obj_conn = HTTPConnection(base_url="", adapter=_http_adapter)
                obj_response = obj_conn.put(signed_url, headers=headers, data=data)
                obj_response.raise_for_status()
            except Exception as e:
                raise RuntimeError(f"Failed to upload attachment to object store: {e}") from e

            return {
                "signed_url": signed_url,
                "metadata_response": metadata_response,
                "object_store_response": obj_response,
            }

        def error_wrapper() -> AttachmentStatus:
            """Catches error messages and updates the attachment status."""
            status = AttachmentStatus(upload_status="uploading")

            login()
            api_conn = _state.api_conn()
            org_id = _state.org_id or ""

            try:
                do_upload(api_conn, org_id)
                status["upload_status"] = "done"
            except Exception as e:
                status["upload_status"] = "error"
                status["error_message"] = str(e)

            request_params = {
                "key": self._reference["key"],
                "org_id": org_id,
                "status": status,
            }
            try:
                status_response = api_conn.post("/attachment/status", json=request_params)
                status_response.raise_for_status()
            except Exception as e:
                raise RuntimeError(f"Couldn't log attachment status: {e}") from e

            return status

        return LazyValue(error_wrapper, use_mutex=True)

    def _init_data(self, data: str | bytes | bytearray) -> LazyValue[bytes]:
        if isinstance(data, str):
            self._ensure_file_readable(data)

            def read_file() -> bytes:
                with open(data, "rb") as f:
                    return f.read()

            return LazyValue(read_file, use_mutex=True)
        else:
            return LazyValue(lambda: bytes(data), use_mutex=False)

    def _ensure_file_readable(self, data: str) -> None:
        try:
            os.stat(data)
        except Exception as e:
            _logger.warning(f"Failed to read file: {e}")


class JSONAttachment(Attachment):
    """
    A convenience class for creating attachments from JSON-serializable objects.

    `JSONAttachment` objects can be inserted anywhere in an event, allowing you to
    log JSON data as an attachment. The SDK will serialize the object to JSON and
    upload it asynchronously to object storage.
    """

    def __init__(
        self,
        data: Any,
        *,
        filename: str = "data.json",
        pretty: bool = False,
    ):
        """
        Construct a JSONAttachment from a JSON-serializable object.

        :param data: The JSON object to attach. Must be JSON-serializable.
        :param filename: The filename for the attachment (defaults to "data.json")
        :param pretty: Whether to pretty-print the JSON (defaults to False)

        Example:
            ```python
            large_transcript = [
                {"role": "user", "content": "..."},
                {"role": "assistant", "content": "..."},
                # ... many more messages
            ]

            logger.log(
                input={
                    "type": "chat",
                    "transcript": JSONAttachment(large_transcript, filename="transcript.json")
                }
            )
            ```
        """
        json_string = json.dumps(data, indent=2 if pretty else None)
        json_bytes = json_string.encode("utf-8")

        super().__init__(
            data=json_bytes,
            filename=filename,
            content_type="application/json",
        )


class ExternalAttachment(BaseAttachment):
    """
    Represents an attachment that resides in an external object store and the associated metadata.

    `ExternalAttachment` objects can be inserted anywhere in an event, similar to
    `Attachment` objects, but they reference files that already exist in an external
    object store rather than requiring upload. The SDK will replace the `ExternalAttachment`
    object with an `AttachmentReference` during logging.
    """

    def __init__(
        self,
        *,
        url: str,
        filename: str,
        content_type: str,
    ):
        """
        Construct an external attachment reference.

        :param url: A fully qualified URL to the object in the external object store.

        :param filename: The desired name of the file in Braintrust. This parameter is for visualization
        purposes only and has no effect on attachment storage.

        :param content_type: The MIME type of the file.
        """
        self._reference: AttachmentReference = {
            "type": "external_attachment",
            "filename": filename,
            "content_type": content_type,
            "url": url,
        }
        self._data = self._init_downloader()

    @property
    def reference(self) -> AttachmentReference:
        """The object that replaces this `Attachment` at upload time."""
        return self._reference

    @property
    def data(self) -> bytes:
        """The attachment contents. This is a lazy value that will read the attachment contents from the external object store on first access."""
        return self._data.get()

    def upload(self) -> AttachmentStatus:
        """
        For ExternalAttachment, this is a no-op since the data already resides
        in the external object store. It marks the attachment as already uploaded.

        :returns: The attachment status, which will always indicate success.
        """
        return AttachmentStatus(upload_status="done")

    def debug_info(self) -> Mapping[str, Any]:
        """
        A human-readable description for logging and debugging.

        :returns: The debug object. The return type is not stable and may change in a future release.
        """
        return {"reference": self._reference}

    def _init_downloader(self) -> LazyValue[bytes]:
        def download() -> bytes:
            readonly = ReadonlyAttachment(self.reference)
            return readonly.data

        return LazyValue(download, use_mutex=True)


class AttachmentMetadata(TypedDict):
    downloadUrl: str
    status: AttachmentStatus


class ReadonlyAttachment:
    """
    A readonly alternative to `Attachment`, which can be used for fetching
    already-uploaded Attachments.
    """

    def __init__(self, reference: AttachmentReference):
        self.reference = reference
        self._data = self._init_downloader()

    @property
    def data(self) -> bytes:
        """The attachment contents. This is a lazy value that will read the attachment contents from the object store on first access."""
        return self._data.get()

    def metadata(self) -> AttachmentMetadata:
        """Fetch the attachment metadata, which includes a downloadUrl and a status. This will re-fetch the status each time in case it changes over time."""
        login()
        api_conn = _state.api_conn()
        org_id = _state.org_id or ""

        params = {
            "filename": self.reference["filename"],
            "content_type": self.reference["content_type"],
            "org_id": org_id,
        }
        if self.reference["type"] == "braintrust_attachment":
            params["key"] = self.reference["key"]
        elif self.reference["type"] == "external_attachment":
            params["url"] = self.reference["url"]
        else:
            raise RuntimeError(f"Unknown attachment type: {self.reference['type']}")

        response = api_conn.get("/attachment", params=params)
        response.raise_for_status()
        metadata = response.json()
        try:
            if not isinstance(metadata["downloadUrl"], str) or not isinstance(metadata["status"], dict):
                raise RuntimeError()
        except Exception:
            raise RuntimeError(f"Invalid response from API server: {metadata}")
        return metadata

    def status(self) -> AttachmentStatus:
        """Fetch the attachment upload status. This will re-fetch the status each time in case it changes over time."""
        return self.metadata()["status"]

    def _init_downloader(self) -> LazyValue[bytes]:
        def download() -> bytes:
            metadata = self.metadata()
            download_url = metadata["downloadUrl"]
            status = metadata["status"]
            try:
                if status["upload_status"] != "done":
                    raise RuntimeError(f"""Expected attachment status "done", got \"{status["upload_status"]}\"""")

                obj_conn = HTTPConnection(base_url="", adapter=_http_adapter)
                obj_response = obj_conn.get(download_url)
                obj_response.raise_for_status()
            except Exception as e:
                raise RuntimeError(f"Couldn't download attachment: {e}") from e

            return obj_response.content

        return LazyValue(download, use_mutex=True)

    def __str__(self) -> str:
        b64_content = base64.b64encode(self.data).decode("utf-8")
        return f"data:{self.reference['content_type']};base64,{b64_content}"


def _log_feedback_impl(
    parent_object_type: SpanObjectTypeV3,
    parent_object_id: LazyValue[str],
    id: str,
    scores: Mapping[str, int | float] | None = None,
    expected: Any | None = None,
    tags: Sequence[str] | None = None,
    comment: str | None = None,
    metadata: Mapping[str, Any] | None = None,
    source: Literal["external", "app", "api", None] = None,
):
    if source is None:
        source = "external"
    elif source not in VALID_SOURCES:
        raise ValueError(f"source must be one of {VALID_SOURCES}")

    if scores is None and expected is None and tags is None and comment is None:
        raise ValueError("At least one of scores, expected, tags, or comment must be specified")

    update_event = _validate_and_sanitize_experiment_log_partial_args(
        event=dict(
            scores=scores,
            metadata=metadata,
            expected=expected,
            tags=tags,
        )
    )

    # Although we validate metadata the normal way, we want to save it as audit metadata,
    # not ordinary metadata
    metadata = update_event.pop("metadata")
    update_event = {k: v for k, v in update_event.items() if v is not None}

    update_event = bt_safe_deep_copy(update_event)

    def parent_ids():
        exporter = _get_exporter()
        return exporter(
            object_type=parent_object_type,
            object_id=parent_object_id.get(),
        ).object_id_fields()

    if len(update_event) > 0:

        def compute_update_record():
            return dict(
                id=id,
                **update_event,
                **parent_ids(),
                **{
                    AUDIT_SOURCE_FIELD: source,
                    AUDIT_METADATA_FIELD: metadata,
                    IS_MERGE_FIELD: True,
                },
            )

        _state.global_bg_logger().log(LazyValue(compute_update_record, use_mutex=False))

    if comment is not None:
        # pylint: disable=function-redefined
        def compute_comment_record():
            return dict(
                id=str(uuid.uuid4()),
                created=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                origin={
                    # NOTE: We do not know (or care?) what the transaction id of the row that
                    # we're commenting on is here, so we omit it.
                    "id": id,
                },
                comment={
                    "text": comment,
                },
                **parent_ids(),
                **{AUDIT_SOURCE_FIELD: source, AUDIT_METADATA_FIELD: metadata},
            )

        _state.global_bg_logger().log(LazyValue(compute_comment_record, use_mutex=False))


def _update_span_impl(
    parent_object_type: SpanObjectTypeV3,
    parent_object_id: LazyValue[str],
    id: str,
    **event: Any,
):
    update_event = _validate_and_sanitize_experiment_log_partial_args(
        event=event,
    )

    update_event = bt_safe_deep_copy(update_event)

    def parent_ids():
        exporter = _get_exporter()
        return exporter(
            object_type=parent_object_type,
            object_id=parent_object_id.get(),
        ).object_id_fields()

    def compute_record():
        return dict(
            id=id,
            **update_event,
            **parent_ids(),
            **{
                IS_MERGE_FIELD: True,
            },
        )

    _state.global_bg_logger().log(LazyValue(compute_record, use_mutex=False))


def update_span(exported: str, **event: Any) -> None:
    """
    Update a span using the output of `span.export()`. It is important that you only resume updating
    to a span once the original span has been fully written and flushed, since otherwise updates to
    the span may conflict with the original span.

    :param exported: The output of `span.export()`.
    :param **event: Data to update. See `Experiment.log` for a full list of valid fields.
    """
    if event.get("id") is not None:
        raise ValueError(
            "Cannot specify id when updating a span with `update_span`. Use the output of `span.export()` instead."
        )

    components = SpanComponentsV4.from_str(exported)
    if not components.row_id:
        raise ValueError("Exported span must have a row_id")
    return _update_span_impl(
        parent_object_type=components.object_type,
        parent_object_id=LazyValue(_span_components_to_object_id_lambda(components), use_mutex=False),
        id=components.row_id,
        **event,
    )


@dataclasses.dataclass
class ParentSpanIds:
    span_id: str
    root_span_id: str


@dataclasses.dataclass
class SpanIds:
    """The three IDs that define a span's position in the trace tree."""

    span_id: str
    root_span_id: str
    span_parents: list[str] | None


def _resolve_span_ids(
    span_id: str | None,
    root_span_id: str | None,
    parent_span_ids: ParentSpanIds | None,
    lookup_span_parent: bool,
    id_generator: "id_gen.IDGenerator",
    context_manager: "context.ContextManager",
) -> SpanIds:
    """Resolve all span IDs (span_id, root_span_id, span_parents) from explicit values, parent info, or context.

    Args:
        span_id: Optional explicit span_id (from public API)
        root_span_id: Optional explicit root_span_id (from public API)
        parent_span_ids: Optional explicit parent span IDs (from parent string or parent span)
        lookup_span_parent: Whether to look up parent from context manager if no explicit parent.
            - True (default): start_span() inherits parent/root ids from the active span (if it exists)
            - False: don't look up parent in context (e.g. logger.log() .. )
        id_generator: ID generator for creating new span/trace IDs
        context_manager: Context manager for looking up parent spans

    Returns:
        SpanIds with resolved span_id, root_span_id, and span_parents
        3. Otherwise → create new root span (generate or use explicit root_span_id)
    """
    # Generate span_id if not provided
    if span_id is None:
        span_id = id_generator.get_span_id()

    # If we have explicit parent span ids, use them.
    if parent_span_ids:
        return SpanIds(
            span_id=span_id, root_span_id=parent_span_ids.root_span_id, span_parents=[parent_span_ids.span_id]
        )

    # If we're using the context manager, get to see if there's an active parent
    # span.
    if lookup_span_parent:
        parent_info = context_manager.get_parent_span_ids()
        if parent_info:
            return SpanIds(
                span_id=span_id, root_span_id=parent_info.root_span_id, span_parents=parent_info.span_parents
            )

    # No parent - create new root span
    if root_span_id:
        resolved_root_span_id = root_span_id
    elif id_generator.share_root_span_id():
        resolved_root_span_id = span_id  # Backwards compat for UUID mode
    else:
        resolved_root_span_id = id_generator.get_trace_id()

    return SpanIds(span_id=span_id, root_span_id=resolved_root_span_id, span_parents=None)


def _span_components_to_object_id_lambda(components: SpanComponentsV4) -> Callable[[], str]:
    if components.object_id:
        captured_object_id = components.object_id
        return lambda: captured_object_id
    assert components.compute_object_metadata_args
    if components.object_type == SpanObjectTypeV3.EXPERIMENT:
        raise Exception("Impossible: compute_object_metadata_args not supported for experiments")
    elif components.object_type == SpanObjectTypeV3.PROJECT_LOGS:
        captured_compute_object_metadata_args = components.compute_object_metadata_args
        return lambda: _compute_logger_metadata(**captured_compute_object_metadata_args).project.id
    else:
        raise Exception(f"Unknown object type: {components.object_type}")


def span_components_to_object_id(components: SpanComponentsV4) -> str:
    """
    Utility function to resolve the object ID of a SpanComponentsV4 object. This
    function may trigger a login to braintrust if the object ID is encoded
    lazily.
    """
    return _span_components_to_object_id_lambda(components)()


def permalink(slug: str, org_name: str | None = None, app_url: str | None = None) -> str:
    """
    Format a permalink to the Braintrust application for viewing the span represented by the provided `slug`.

    Links can be generated at any time, but they will only become viewable after the span and its root have been flushed to the server and ingested.

    If you have a `Span` object, use `Span.permalink` instead.

    :param slug: The identifier generated from `Span.export`.
    :param org_name: The org name to use. If not provided, the org name will be inferred from the global login state.
    :param app_url: The app URL to use. If not provided, the app URL will be inferred from the global login state.
    :returns: A permalink to the exported span.
    """
    if not slug:
        # Noop spans have an empty slug, so return a dummy permalink.
        return NOOP_SPAN_PERMALINK

    try:
        if not org_name:
            login()
            if not _state.org_name:
                raise Exception("Must either provide org_name explicitly or be logged in to a specific org")
            org_name = _state.org_name

        if not app_url:
            login()
            if not _state.app_url:
                raise Exception("Must either provide app_url explicitly or be logged in")
            app_url = _state.app_url

        components = SpanComponentsV4.from_str(slug)

        object_type = str(components.object_type)
        object_id = span_components_to_object_id(components)
        id = components.row_id

        if not id:
            raise ValueError("Span slug does not refer to an individual row")

        url_params = urlencode({"object_type": object_type, "object_id": object_id, "id": id})
        return f"{app_url}/app/{org_name}/object?{url_params}"
    except Exception as e:
        if "BRAINTRUST_API_KEY" in str(e):
            return _get_error_link("login-or-provide-org-name")
        else:
            return _get_error_link()


def _start_span_parent_args(
    parent: str | None,
    parent_object_type: SpanObjectTypeV3,
    parent_object_id: LazyValue[str],
    parent_compute_object_metadata_args: dict[str, Any] | None,
    parent_span_ids: ParentSpanIds | None,
    propagated_event: dict[str, Any] | None,
) -> dict[str, Any]:
    if parent:
        assert parent_span_ids is None, "Cannot specify both parent and parent_span_ids"
        parent_components = SpanComponentsV4.from_str(parent)
        assert (
            parent_object_type == parent_components.object_type
        ), f"Mismatch between expected span parent object type {parent_object_type} and provided type {parent_components.object_type}"

        parent_components_object_id_lambda = _span_components_to_object_id_lambda(parent_components)

        def compute_parent_object_id():
            parent_components_object_id = parent_components_object_id_lambda()
            assert (
                parent_object_id.get() == parent_components_object_id
            ), f"Mismatch between expected span parent object id {parent_object_id.get()} and provided id {parent_components_object_id}"
            return parent_object_id.get()

        arg_parent_object_id = LazyValue(compute_parent_object_id, use_mutex=False)
        if parent_components.row_id:
            arg_parent_span_ids = ParentSpanIds(
                span_id=parent_components.span_id, root_span_id=parent_components.root_span_id
            )
        else:
            arg_parent_span_ids = None
        arg_propagated_event = coalesce(propagated_event, parent_components.propagated_event)
    else:
        arg_parent_object_id = parent_object_id
        arg_parent_span_ids = parent_span_ids
        arg_propagated_event = propagated_event

    return dict(
        parent_object_type=parent_object_type,
        parent_object_id=arg_parent_object_id,
        parent_compute_object_metadata_args=parent_compute_object_metadata_args,
        parent_span_ids=arg_parent_span_ids,
        propagated_event=arg_propagated_event,
    )


@dataclasses.dataclass
class ExperimentIdentifier:
    id: str
    name: str


class _ExperimentDatasetEvent(TypedDict):
    """
    TODO: This could be unified with `framework._EvalCaseDict` like we do in the
    TypeScript SDK, or generated from OpenAPI spec. For now, marking as internal
    to exclude it from the docs.
    """

    id: str
    _xact_id: str
    input: Any | None
    expected: Any | None
    tags: Sequence[str] | None


class ExperimentDatasetIterator:
    def __init__(self, iterator: Iterator[ExperimentEvent]):
        self.iterator = iterator

    def __iter__(self):
        return self

    def __next__(self) -> _ExperimentDatasetEvent:
        while True:
            value = next(self.iterator)
            if value["root_span_id"] != value["span_id"]:
                continue

            output, expected = value.get("output"), value.get("expected")
            ret: _ExperimentDatasetEvent = {
                "input": value.get("input"),
                "expected": expected if expected is not None else output,
                "tags": value.get("tags"),
                "metadata": value.get("metadata"),
                "id": value["id"],
                "_xact_id": value["_xact_id"],
            }
            return ret


class Experiment(ObjectFetcher[ExperimentEvent], Exportable):
    """
    An experiment is a collection of logged events, such as model inputs and outputs, which represent
    a snapshot of your application at a particular point in time. An experiment is meant to capture more
    than just the model you use, and includes the data you use to test, pre- and post- processing code,
    comparison metrics (scores), and any other metadata you want to include.

    Experiments are associated with a project, and two experiments are meant to be easily comparable via
    their `input`. You can change the attributes of the experiments in a project (e.g. scoring functions)
    over time, simply by changing what you log.

    You should not create `Experiment` objects directly. Instead, use the `braintrust.init()` method.
    """

    def __init__(
        self,
        lazy_metadata: LazyValue[ProjectExperimentMetadata],
        dataset: Optional["Dataset"] = None,
        state: BraintrustState | None = None,
    ):
        self._lazy_metadata = lazy_metadata
        self.dataset = dataset
        self.last_start_time = time.time()
        self._lazy_id = LazyValue(lambda: self.id, use_mutex=False)
        self._called_start_span = False
        self.state = state or _state

        ObjectFetcher.__init__(
            self,
            object_type="experiment",
            pinned_version=None,
            mutate_record=_enrich_attachments,
        )

    @property
    def id(self) -> str:
        return self._lazy_metadata.get().experiment.id

    @property
    def name(self) -> str:
        return self._lazy_metadata.get().experiment.name

    @property
    def data(self) -> Mapping[str, Any]:
        return self._lazy_metadata.get().experiment.full_info

    @property
    def project(self) -> ObjectMetadata:
        return self._lazy_metadata.get().project

    @property
    def logging_state(self) -> BraintrustState:
        return self.state

    @staticmethod
    def _parent_object_type():
        return SpanObjectTypeV3.EXPERIMENT

    # Capture all metadata attributes which aren't covered by existing methods.
    def __getattr__(self, name: str) -> Any:
        return self._lazy_metadata.get().experiment.full_info[name]

    def _get_state(self) -> BraintrustState:
        # Ensure the login state is populated by fetching the lazy_metadata.
        self._lazy_metadata.get()
        return self.state

    def log(
        self,
        input: Any | None = None,
        output: Any | None = None,
        expected: Any | None = None,
        error: str | None = None,
        tags: Sequence[str] | None = None,
        scores: Mapping[str, int | float] | None = None,
        metadata: Mapping[str, Any] | None = None,
        metrics: Mapping[str, int | float] | None = None,
        id: str | None = None,
        dataset_record_id: str | None = None,
        allow_concurrent_with_spans: bool = False,
    ) -> str:
        """
        Log a single event to the experiment. The event will be batched and uploaded behind the scenes.

        :param input: The arguments that uniquely define a test case (an arbitrary, JSON serializable object). Later on, Braintrust will use the `input` to know whether two test cases are the same between experiments, so they should not contain experiment-specific state. A simple rule of thumb is that if you run the same experiment twice, the `input` should be identical.
        :param output: The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
        :param expected: (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate your experiments while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
        :param error: (Optional) The error that occurred, if any. If you use tracing to run an experiment, errors are automatically logged when your code throws an exception.
        :param scores: A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare experiments.
        :param metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
        :param tags: (Optional) a list of strings that you can use to filter and group records later.
        :param metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically: "start", "end".
        :param id: (Optional) a unique identifier for the event. If you don't provide one, BrainTrust will generate one for you.
        :param allow_concurrent_with_spans: (Optional) in rare cases where you need to log at the top level separately from using spans on the experiment elsewhere, set this to True.
        :param dataset_record_id: (Deprecated) the id of the dataset record that this event is associated with. This field is required if and only if the experiment is associated with a dataset. This field is unused and will be removed in a future version.
        :returns: The `id` of the logged event.
        """
        if self._called_start_span and not allow_concurrent_with_spans:
            raise Exception(
                "Cannot run toplevel `log` method while using spans. To log to the span, call `experiment.start_span` and then log with `span.log`"
            )

        event = _validate_and_sanitize_experiment_log_full_args(
            dict(
                input=input,
                output=output,
                expected=expected,
                error=error,
                tags=tags,
                scores=scores,
                metadata=metadata,
                metrics=metrics,
                id=id,
            ),
            self.dataset is not None,
        )
        span = self._start_span_impl(start_time=self.last_start_time, lookup_span_parent=False, **event)
        self.last_start_time = span.end()
        return span.id

    def log_feedback(
        self,
        id: str,
        scores: Mapping[str, int | float] | None = None,
        expected: Any | None = None,
        tags: Sequence[str] | None = None,
        comment: str | None = None,
        metadata: Mapping[str, Any] | None = None,
        source: Literal["external", "app", "api", None] = None,
    ) -> None:
        """
        Log feedback to an event in the experiment. Feedback is used to save feedback scores, set an expected value, or add a comment.

        :param id: The id of the event to log feedback for. This is the `id` returned by `log` or accessible as the `id` field of a span.
        :param scores: (Optional) a dictionary of numeric values (between 0 and 1) to log. These scores will be merged into the existing scores for the event.
        :param expected: (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not.
        :param tags: (Optional) a list of strings that you can use to filter and group records later.
        :param comment: (Optional) an optional comment string to log about the event.
        :param metadata: (Optional) a dictionary with additional data about the feedback. If you have a `user_id`, you can log it here and access it in the Braintrust UI. Note, this metadata does not correspond to the main event itself, but rather the audit log attached to the event.
        :param source: (Optional) the source of the feedback. Must be one of "external" (default), "app", or "api".
        """
        return _log_feedback_impl(
            parent_object_type=self._parent_object_type(),
            parent_object_id=self._lazy_id,
            id=id,
            scores=scores,
            expected=expected,
            tags=tags,
            comment=comment,
            metadata=metadata,
            source=source,
        )

    def start_span(
        self,
        name: str | None = None,
        type: SpanTypeAttribute | None = None,
        span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
        start_time: float | None = None,
        set_current: bool | None = None,
        parent: str | None = None,
        propagated_event: dict[str, Any] | None = None,
        **event: Any,
    ) -> Span:
        """Create a new toplevel span underneath the experiment. The name defaults to "root" and the span type to "eval".

        See `Span.start_span` for full details
        """
        self._called_start_span = True
        return self._start_span_impl(
            name=name,
            type=type,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            parent=parent,
            propagated_event=propagated_event,
            **event,
        )

    def update_span(self, id: str, **event: Any) -> None:
        """
        Update a span in the experiment using its id. It is important that you only update a span once the original span has been fully written and flushed,
        since otherwise updates to the span may conflict with the original span.

        :param id: The id of the span to update.
        :param **event: Data to update. See `Experiment.log` for a full list of valid fields.
        """
        return _update_span_impl(
            parent_object_type=self._parent_object_type(),
            parent_object_id=self._lazy_id,
            id=id,
            **event,
        )

    def fetch_base_experiment(self) -> ExperimentIdentifier | None:
        state = self._get_state()
        conn = state.app_conn()

        resp = conn.post("/api/base_experiment/get_id", json={"id": self.id})
        if resp.status_code == 400:
            # No base experiment
            return None

        response_raise_for_status(resp)
        base = resp.json()
        if base:
            return ExperimentIdentifier(id=base["base_exp_id"], name=base["base_exp_name"])
        else:
            return None

    def summarize(
        self, summarize_scores: bool = True, comparison_experiment_id: str | None = None
    ) -> "ExperimentSummary":
        """
        Summarize the experiment, including the scores (compared to the closest reference experiment) and metadata.

        :param summarize_scores: Whether to summarize the scores. If False, only the metadata will be returned.
        :param comparison_experiment_id: The experiment to compare against. If None, the most recent experiment on the origin's main branch will be used.
        :returns: `ExperimentSummary`
        """
        # Flush our events to the API, and to the data warehouse, to ensure that the link we print
        # includes the new experiment.
        self.flush()

        state = self._get_state()
        project_url = f"{state.app_public_url}/app/{encode_uri_component(state.org_name)}/p/{encode_uri_component(self.project.name)}"
        experiment_url = f"{project_url}/experiments/{encode_uri_component(self.name)}"

        score_summary = {}
        metric_summary = {}
        comparison_experiment_name = None
        if summarize_scores:
            # Get the comparison experiment
            if comparison_experiment_id is None:
                base_experiment = self.fetch_base_experiment()
                if base_experiment:
                    comparison_experiment_id = base_experiment.id
                    comparison_experiment_name = base_experiment.name

            try:
                summary_items = state.api_conn().get_json(
                    "experiment-comparison2",
                    args={
                        "experiment_id": self.id,
                        "base_experiment_id": comparison_experiment_id,
                    },
                )
            except Exception as e:
                _logger.warning(
                    f"Failed to fetch experiment scores and metrics: {e}\n\nView complete results in Braintrust or run experiment.summarize() again."
                )
                summary_items = {}

            score_items = summary_items.get("scores", {})
            metric_items = summary_items.get("metrics", {})

            longest_score_name = max(len(k) for k in score_items.keys()) if score_items else 0
            score_summary = {
                k: ScoreSummary(_longest_score_name=longest_score_name, **v) for (k, v) in score_items.items()
            }

            longest_metric_name = max(len(k) for k in metric_items.keys()) if metric_items else 0
            metric_summary = {
                k: MetricSummary(_longest_metric_name=longest_metric_name, **v) for (k, v) in metric_items.items()
            }

        return ExperimentSummary(
            project_name=self.project.name,
            project_id=self.project.id,
            experiment_id=self.id,
            experiment_name=self.name,
            project_url=project_url,
            experiment_url=experiment_url,
            comparison_experiment_name=comparison_experiment_name,
            scores=score_summary,
            metrics=metric_summary,
        )

    def export(self) -> str:
        exporter = _get_exporter()
        return exporter(object_type=self._parent_object_type(), object_id=self.id).to_str()

    def close(self) -> str:
        """This function is deprecated. You can simply remove it from your code."""

        eprint(
            "close is deprecated and will be removed in a future version of braintrust. It is now a no-op and can be removed"
        )
        return self.id

    def flush(self) -> None:
        """Flush any pending rows to the server."""

        self.state.global_bg_logger().flush()

    def _start_span_impl(
        self,
        name: str | None = None,
        type: SpanTypeAttribute | None = None,
        span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
        start_time: float | None = None,
        set_current: bool | None = None,
        parent: str | None = None,
        propagated_event: dict[str, Any] | None = None,
        lookup_span_parent: bool = True,
        **event: Any,
    ) -> Span:
        parent_args = _start_span_parent_args(
            parent=parent,
            parent_object_type=self._parent_object_type(),
            parent_object_id=self._lazy_id,
            parent_compute_object_metadata_args=None,
            parent_span_ids=None,
            propagated_event=propagated_event,
        )
        return SpanImpl(
            **parent_args,
            name=name,
            type=type,
            lookup_span_parent=lookup_span_parent,
            default_root_type=SpanTypeAttribute.EVAL,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            event=event,
            state=self.state,
        )

    def __enter__(self) -> "Experiment":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback


class ReadonlyExperiment(ObjectFetcher[ExperimentEvent]):
    """
    A read-only view of an experiment, initialized by passing `open=True` to `init()`.
    """

    def __init__(
        self,
        lazy_metadata: LazyValue[ProjectExperimentMetadata],
        state: BraintrustState | None = None,
    ):
        self._lazy_metadata = lazy_metadata
        self.state = state or _state

        ObjectFetcher.__init__(
            self,
            object_type="experiment",
            pinned_version=None,
            mutate_record=_enrich_attachments,
        )

    @property
    def id(self) -> str:
        return self._lazy_metadata.get().experiment.id

    @property
    def logging_state(self) -> BraintrustState:
        return self.state

    def _get_state(self) -> BraintrustState:
        # Ensure the login state is populated by fetching the lazy_metadata.
        self._lazy_metadata.get()
        return self.state

    def as_dataset(self, batch_size: int | None = None) -> Iterator[_ExperimentDatasetEvent]:
        """
        Return the experiment's data as a dataset iterator.

        :param batch_size: The number of records to fetch per request. Defaults to 1000.
        :returns: An iterator over the experiment data as dataset records.
        """
        return ExperimentDatasetIterator(self.fetch(batch_size=batch_size))


_EXEC_COUNTER_LOCK = threading.Lock()
_EXEC_COUNTER = 0


class SpanImpl(Span):
    """Primary implementation of the `Span` interface. See the `Span` interface for full details on each method.

    We suggest using one of the various `start_span` methods, instead of creating Spans directly. See `Span.start_span` for full details.
    """

    can_set_current: bool

    def __init__(
        self,
        parent_object_type: SpanObjectTypeV3,
        parent_object_id: LazyValue[str],
        parent_compute_object_metadata_args: dict[str, Any] | None,
        parent_span_ids: ParentSpanIds | None,
        name: str | None = None,
        type: SpanTypeAttribute | None = None,
        default_root_type: SpanTypeAttribute | None = None,
        span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
        start_time: float | None = None,
        set_current: bool | None = None,
        event: dict[str, Any] | None = None,
        propagated_event: dict[str, Any] | None = None,
        span_id: str | None = None,
        root_span_id: str | None = None,
        state: BraintrustState | None = None,
        lookup_span_parent: bool = True,
    ):
        if span_attributes is None:
            span_attributes = SpanAttributes()
        if event is None:
            event = {}
        if type is None and not parent_span_ids:
            type = default_root_type

        self.state = state or _state

        self.can_set_current = cast(bool, coalesce(set_current, True))
        self._logged_end_time: float | None = None

        # Context token for proper cleanup - used by both OTEL and Braintrust context managers
        # This is set by the context manager when the span becomes active
        self._context_token: Any | None = None

        self.parent_object_type = parent_object_type
        self.parent_object_id = parent_object_id
        self.parent_compute_object_metadata_args = parent_compute_object_metadata_args

        # Merge propagated_event into event. The propagated_event data will get
        # propagated-and-merged into every subspan.
        self.propagated_event = propagated_event
        if self.propagated_event:
            merge_dicts(event, self.propagated_event)

        caller_location = get_caller_location()
        if name is None:
            if not parent_span_ids:
                name = "root"
            elif caller_location:
                filename = os.path.basename(caller_location["caller_filename"])
                name = ":".join(
                    [caller_location["caller_functionname"]]
                    + ([f"{filename}:{caller_location['caller_lineno']}"] if filename else [])
                )
            else:
                name = "subspan"

        # `internal_data` contains fields that are not part of the
        # "user-sanitized" set of fields which we want to log in just one of the
        # span rows.
        global _EXEC_COUNTER
        with _EXEC_COUNTER_LOCK:
            _EXEC_COUNTER += 1
            exec_counter = _EXEC_COUNTER

        internal_data: dict[str, Any] = dict(
            metrics=dict(
                start=start_time or time.time(),
            ),
            # Set type first, in case they override it in `span_attributes`.
            span_attributes=dict(**{"type": type, "name": name, **span_attributes}, exec_counter=exec_counter),
            created=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )
        if caller_location:
            internal_data["context"] = caller_location

        # TODO: can be simplified after `event` is typed.
        id = event.pop("id", None)
        if id is None or not isinstance(id, str):
            id = str(uuid.uuid4())
        self._id = id

        # Resolve all span IDs (span_id, root_span_id, span_parents)
        span_ids = _resolve_span_ids(
            span_id=span_id,
            root_span_id=root_span_id,
            parent_span_ids=parent_span_ids,
            lookup_span_parent=lookup_span_parent,
            id_generator=self.state.id_generator,
            context_manager=self.state.context_manager,
        )
        self.span_id = span_ids.span_id
        self.root_span_id = span_ids.root_span_id
        self.span_parents = span_ids.span_parents

        # The first log is a replacement, but subsequent logs to the same span
        # object will be merges.
        self._is_merge = False
        self.log_internal(event=event, internal_data=internal_data)
        self._is_merge = True

    @property
    def id(self) -> str:
        return self._id

    def set_attributes(
        self,
        name: str | None = None,
        type: SpanTypeAttribute | None = None,
        span_attributes: Mapping[str, Any] | None = None,
    ) -> None:
        self.log_internal(
            internal_data={
                "span_attributes": _strip_nones(
                    {
                        "name": name,
                        "type": type,
                        **(span_attributes or {}),
                    },
                    deep=False,
                ),
            }
        )

    def log(self, **event: Any) -> None:
        return self.log_internal(event=event, internal_data=None)

    def log_internal(self, event: dict[str, Any] | None = None, internal_data: dict[str, Any] | None = None) -> None:
        serializable_partial_record, lazy_partial_record = split_logging_data(event, internal_data)

        # We both check for serializability and round-trip `partial_record`
        # through JSON in order to create a "deep copy". This has the benefit of
        # cutting out any reference to user objects when the object is logged
        # asynchronously, so that in case the objects are modified, the logging
        # is unaffected.
        partial_record: dict[str, Any] = dict(
            id=self.id,
            span_id=self.span_id,
            root_span_id=self.root_span_id,
            span_parents=self.span_parents,
            **serializable_partial_record,
            **{IS_MERGE_FIELD: self._is_merge},
        )

        serializable_partial_record = bt_safe_deep_copy(partial_record)
        if serializable_partial_record.get("metrics", {}).get("end") is not None:
            self._logged_end_time = serializable_partial_record["metrics"]["end"]

        # Write to local span cache for scorer access
        # Only cache experiment spans - regular logs don't need caching
        if self.parent_object_type == SpanObjectTypeV3.EXPERIMENT:
            from braintrust.span_cache import CachedSpan

            cached_span = CachedSpan(
                span_id=self.span_id,
                input=serializable_partial_record.get("input"),
                output=serializable_partial_record.get("output"),
                metadata=serializable_partial_record.get("metadata"),
                span_parents=self.span_parents,
                span_attributes=serializable_partial_record.get("span_attributes"),
            )
            self.state.span_cache.queue_write(self.root_span_id, self.span_id, cached_span)

        def compute_record() -> dict[str, Any]:
            exporter = _get_exporter()
            return dict(
                **serializable_partial_record,
                **{k: v.get() for k, v in lazy_partial_record.items()},
                **exporter(
                    object_type=self.parent_object_type,
                    object_id=self.parent_object_id.get(),
                ).object_id_fields(),
            )

        self.state.global_bg_logger().log(LazyValue(compute_record, use_mutex=False))

    def log_feedback(self, **event: Any) -> None:
        return _log_feedback_impl(
            parent_object_type=self.parent_object_type,
            parent_object_id=self.parent_object_id,
            id=self.id,
            **event,
        )

    def start_span(
        self,
        name: str | None = None,
        type: SpanTypeAttribute | None = None,
        span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
        start_time: float | None = None,
        set_current: bool | None = None,
        parent: str | None = None,
        propagated_event: dict[str, Any] | None = None,
        **event: Any,
    ) -> Span:
        if parent:
            parent_span_ids = None
        else:
            parent_span_ids = ParentSpanIds(span_id=self.span_id, root_span_id=self.root_span_id)

        # Always set lookup_span_parent=False because:
        # - If parent is provided, _start_span_parent_args will extract parent info from it
        # - If parent is not provided, we explicitly set parent_span_ids from self
        # Either way, we don't want to look up parent from context manager
        lookup_span_parent = False
        return SpanImpl(
            **_start_span_parent_args(
                parent=parent,
                parent_object_type=self.parent_object_type,
                parent_object_id=self.parent_object_id,
                parent_compute_object_metadata_args=self.parent_compute_object_metadata_args,
                parent_span_ids=parent_span_ids,
                propagated_event=coalesce(propagated_event, self.propagated_event),
            ),
            name=name,
            type=type,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            event=event,
            lookup_span_parent=lookup_span_parent,
            state=self.state,
        )

    def end(self, end_time: float | None = None) -> float:
        internal_data = {}
        if not self._logged_end_time:
            end_time = end_time or time.time()
            internal_data = dict(metrics=dict(end=end_time))
        else:
            end_time = self._logged_end_time
        self.log_internal(internal_data=internal_data)
        return end_time

    def export(self) -> str:
        if self.parent_compute_object_metadata_args and not self.parent_object_id.has_succeeded:
            object_id = None
            compute_object_metadata_args = self.parent_compute_object_metadata_args
        else:
            object_id = self.parent_object_id.get()
            compute_object_metadata_args = None

        # Choose SpanComponents version based on BRAINTRUST_OTEL_COMPAT env var
        use_v4 = os.getenv("BRAINTRUST_OTEL_COMPAT", "false").lower() == "true"
        span_components_class = SpanComponentsV4 if use_v4 else SpanComponentsV3

        # Disable span cache since remote function spans won't be in the local cache
        self.state.span_cache.disable()

        return span_components_class(
            object_type=self.parent_object_type,
            object_id=object_id,
            compute_object_metadata_args=compute_object_metadata_args,
            row_id=self.id,
            span_id=self.span_id,
            root_span_id=self.root_span_id,
            propagated_event=self.propagated_event,
        ).to_str()

    def link(self) -> str:
        parent_type, info = self._get_parent_info()
        if parent_type == SpanObjectTypeV3.PROJECT_LOGS:
            cur_logger = self.state._cv_logger.get() or self.state._local_logger
            if not cur_logger:
                return NOOP_SPAN_PERMALINK
            base_url = cur_logger._get_link_base_url()
            if not base_url:
                return _get_error_link("login-or-provide-org-name")

            project_id = info.get("id")
            project_name = info.get("name")
            if project_id:
                return f"{base_url}/object?object_type=project_logs&object_id={project_id}&id={self._id}"
            elif project_name:
                return f"{base_url}/p/{project_name}/logs?oid={self._id}"
            else:
                return _get_error_link("no-project-id-or-name")
        elif parent_type == SpanObjectTypeV3.EXPERIMENT:
            app_url = self.state.app_url or _get_app_url()
            org_name = self.state.org_name or _get_org_name()
            if not app_url or not org_name:
                return _get_error_link("provide-app-url-or-org-name")
            base_url = f"{app_url}/app/{org_name}"

            exp_id = info.get("id")
            if exp_id:
                return f"{base_url}/object?object_type=experiment&object_id={exp_id}&id={self._id}"
            else:
                return _get_error_link("resolve-experiment-id")

        return NOOP_SPAN_PERMALINK

    def permalink(self) -> str:
        try:
            return permalink(self.export())
        except Exception as e:
            if "BRAINTRUST_API_KEY" in str(e):
                return _get_error_link("login-or-provide-org-name")
            else:
                return _get_error_link("")

    def close(self, end_time=None) -> float:
        return self.end(end_time)

    def flush(self) -> None:
        """Flush any pending rows to the server."""

        self.state.global_bg_logger().flush()

    def set_current(self):
        if self.can_set_current:
            # Get token from context manager and store it
            self._context_token = self.state.context_manager.set_current_span(self)

    def unset_current(self):
        """
        Unset current span context.

        Note: self._context_token may be None if set_current() failed.
        This is safe - context_manager.unset_current_span() handles None.
        """
        if self.can_set_current:
            try:
                self.state.context_manager.unset_current_span(self._context_token)
            except Exception as e:
                logging.debug(f"Failed to unset current span: {e}")
            finally:
                # Always clear the token reference
                self._context_token = None

    def __enter__(self) -> Span:
        self.set_current()
        return self

    def __exit__(self, exc_type, exc_value, tb) -> None:
        try:
            if exc_type is not None:
                self.log_internal(dict(error=stringify_exception(exc_type, exc_value, tb)))
        finally:
            try:
                self.unset_current()
            except Exception as e:
                logging.debug(f"Failed to unset current in __exit__: {e}")

            try:
                self.end()
            except Exception as e:
                logging.warning(f"Error ending span: {e}")

    def _get_parent_info(self):
        if self.parent_object_type == SpanObjectTypeV3.PROJECT_LOGS:
            is_resolved, id1 = self.parent_object_id.get_sync()
            meta = self.parent_compute_object_metadata_args or {}
            id2 = meta.get("project_id")
            name = meta.get("project_name")
            _id = id1 if is_resolved else id2
            return self.parent_object_type, {"name": name, "id": _id}
        elif self.parent_object_type == SpanObjectTypeV3.EXPERIMENT:
            is_resolved, experiment_id = self.parent_object_id.get_sync()
            if is_resolved:
                return self.parent_object_type, {"id": experiment_id}
            # For experiments, we resolve the ID by calling get(). We can't pass
            # along the "lazy compuete metadata args" because we can't tell OTel to do that.
            # We must pass along an explicit resolved parent.
            try:
                experiment_id = self.parent_object_id.get()
                return self.parent_object_type, {"id": experiment_id}
            except Exception:
                return self.parent_object_type, {}
        else:
            return None, {}

    def _get_otel_parent(self):
        parent_type, info = self._get_parent_info()
        if parent_type == SpanObjectTypeV3.PROJECT_LOGS:
            _id = info.get("id")
            _name = info.get("name")
            if _id:
                return f"project_id:{_id}"
            elif _name:
                return f"project_name:{_name}"
        if parent_type == SpanObjectTypeV3.EXPERIMENT:
            _id = info.get("id")
            if _id:
                return f"experiment_id:{_id}"
        return None


def log_exc_info_to_span(
    span: Span, exc_type: type[BaseException], exc_value: BaseException, tb: TracebackType | None
) -> None:
    error = stringify_exception(exc_type, exc_value, tb)
    span.log(error=error)


def stringify_exception(exc_type: type[BaseException], exc_value: BaseException, tb: TracebackType | None) -> str:
    return "".join(
        traceback.format_exception_only(exc_type, exc_value)
        + ["\nTraceback (most recent call last):\n"]
        + traceback.format_tb(tb)
    )


def _strip_nones(d: T, deep: bool) -> T:
    if not isinstance(d, dict):
        return d
    return {k: (_strip_nones(v, deep) if deep else v) for (k, v) in d.items() if v is not None}  # type: ignore


def split_logging_data(
    event: dict[str, Any] | None, internal_data: dict[str, Any] | None
) -> tuple[dict[str, Any], dict[str, Any]]:
    # There should be no overlap between the dictionaries being merged,
    # except for `sanitized` and `internal_data`, where the former overrides
    # the latter.
    sanitized = _validate_and_sanitize_experiment_log_partial_args(event or {})
    sanitized_and_internal_data = _strip_nones(internal_data or {}, deep=True)
    merge_dicts(sanitized_and_internal_data, _strip_nones(sanitized, deep=False))

    serializable_partial_record: dict[str, Any] = {}
    lazy_partial_record: dict[str, Any] = {}
    for k, v in sanitized_and_internal_data.items():
        if isinstance(v, BraintrustStream):
            # Python has weird semantics with loop variables and lambda functions, so we
            # capture `v` by plugging it through a closure that itself returns the LazyValue
            def make_final_value_callback(v):
                return LazyValue(lambda: v.copy().final_value(), use_mutex=False)

            lazy_partial_record[k] = make_final_value_callback(v)
        else:
            serializable_partial_record[k] = v

    return serializable_partial_record, lazy_partial_record


class Dataset(ObjectFetcher[DatasetEvent]):
    """
    A dataset is a collection of records, such as model inputs and outputs, which represent
    data you can use to evaluate and fine-tune models. You can log production data to datasets,
    curate them with interesting examples, edit/delete records, and run evaluations against them.

    You should not create `Dataset` objects directly. Instead, use the `braintrust.init_dataset()` method.
    """

    def __init__(
        self,
        lazy_metadata: LazyValue[ProjectDatasetMetadata],
        version: None | int | str = None,
        legacy: bool = DEFAULT_IS_LEGACY_DATASET,
        _internal_btql: dict[str, Any] | None = None,
        state: BraintrustState | None = None,
    ):
        if legacy:
            eprint(
                f"""Records will be fetched from this dataset in the legacy format, with the "expected" field renamed to "output". Please update your code to use "expected", and use `braintrust.init_dataset()` with `use_output=False`, which will become the default in a future version of Braintrust."""
            )

        def mutate_record(r: DatasetEvent) -> DatasetEvent:
            _enrich_attachments(cast(dict[str, Any], r))
            return ensure_dataset_record(r, legacy)

        self._lazy_metadata = lazy_metadata
        self.new_records = 0

        ObjectFetcher.__init__(
            self,
            object_type="dataset",
            pinned_version=version,
            mutate_record=mutate_record,
            _internal_btql=_internal_btql,
        )

        self.state = state or _state

    @property
    def id(self) -> str:
        return self._lazy_metadata.get().dataset.id

    @property
    def name(self) -> str:
        return self._lazy_metadata.get().dataset.name

    @property
    def data(self):
        return self._lazy_metadata.get().dataset.full_info

    @property
    def project(self):
        return self._lazy_metadata.get().project

    @property
    def logging_state(self) -> BraintrustState:
        return self.state

    # Capture all metadata attributes which aren't covered by existing methods.
    def __getattr__(self, name: str) -> Any:
        return self._lazy_metadata.get().dataset.full_info[name]

    def _get_state(self) -> BraintrustState:
        # Ensure the login state is populated by fetching the lazy_metadata.
        self._lazy_metadata.get()
        return self.state

    def _validate_event(
        self,
        metadata: dict[str, Any] | None = None,
        expected: Any | None = None,
        output: Any | None = None,
        tags: Sequence[str] | None = None,
    ):
        if metadata is not None:
            if not isinstance(metadata, dict):
                raise ValueError("metadata must be a dictionary")
            for key in metadata.keys():
                if not isinstance(key, str):
                    raise ValueError("metadata keys must be strings")

        if expected is not None and output is not None:
            raise ValueError("Only one of expected or output (deprecated) can be specified. Prefer expected.")

        if tags:
            validate_tags(tags)

    def _create_args(
        self, id, input=None, expected=None, metadata=None, tags=None, output=None, is_merge=False
    ) -> LazyValue[dict[str, Any]]:
        expected_value = expected if expected is not None else output

        args = _populate_args(
            {
                "id": id,
                "input": input,
                "expected": expected_value,
                "tags": tags,
                "created": None if is_merge else datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
            metadata=metadata,
        )

        if is_merge:
            args[IS_MERGE_FIELD] = True
            args = _filter_none_args(args)  # If merging, then remove None values to prevent null value writes

        args = bt_safe_deep_copy(args)

        def compute_args() -> dict[str, Any]:
            return dict(
                **args,
                dataset_id=self.id,
            )

        return LazyValue(compute_args, use_mutex=False)

    def insert(
        self,
        input: Any | None = None,
        expected: Any | None = None,
        tags: Sequence[str] | None = None,
        metadata: dict[str, Any] | None = None,
        id: str | None = None,
        output: Any | None = None,
    ) -> str:
        """
        Insert a single record to the dataset. The record will be batched and uploaded behind the scenes. If you pass in an `id`,
        and a record with that `id` already exists, it will be overwritten (upsert).

        :param input: The argument that uniquely define an input case (an arbitrary, JSON serializable object).
        :param expected: The output of your application, including post-processing (an arbitrary, JSON serializable object).
        :param tags: (Optional) a list of strings that you can use to filter and group records later.
        :param metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just
        about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the
        `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any
        JSON-serializable type, but its keys must be strings.
        :param id: (Optional) a unique identifier for the event. If you don't provide one, Braintrust will generate one for you.
        :param output: (Deprecated) The output of your application. Use `expected` instead.
        :returns: The `id` of the logged record.
        """
        self._validate_event(metadata=metadata, expected=expected, output=output, tags=tags)

        row_id = id or str(uuid.uuid4())

        args = self._create_args(
            id=row_id,
            input=input,
            expected=expected,
            metadata=metadata,
            tags=tags,
            output=output,
            is_merge=False,
        )

        self._clear_cache()  # We may be able to optimize this
        self.new_records += 1
        self.state.global_bg_logger().log(args)
        return row_id

    def update(
        self,
        id: str,
        input: Any | None = None,
        expected: Any | None = None,
        tags: Sequence[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """
        Update fields of a single record in the dataset. The updated fields will be batched and uploaded behind the scenes.
        You must pass in an `id` of the record to update. Only the fields provided will be updated; other fields will remain unchanged.

        :param id: The unique identifier of the record to update.
        :param input: (Optional) The new input value for the record (an arbitrary, JSON serializable object).
        :param expected: (Optional) The new expected output value for the record (an arbitrary, JSON serializable object).
        :param tags: (Optional) A list of strings to update the tags of the record.
        :param metadata: (Optional) A dictionary to update the metadata of the record. The values in `metadata` can be any
            JSON-serializable type, but its keys must be strings.
        :returns: The `id` of the updated record.
        """
        self._validate_event(metadata=metadata, expected=expected, tags=tags)

        args = self._create_args(
            id=id,
            input=input,
            expected=expected,
            metadata=metadata,
            tags=tags,
            is_merge=True,
        )

        self._clear_cache()  # We may be able to optimize this
        self.state.global_bg_logger().log(args)
        return id

    def delete(self, id: str) -> str:
        """
        Delete a record from the dataset.

        :param id: The `id` of the record to delete.
        """

        # Validate the non-lazily-computed part of the record-to-log.
        partial_args = _populate_args(
            {
                "id": id,
                "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "_object_delete": True,  # XXX potentially place this in the logging endpoint
            },
        )
        partial_args = bt_safe_deep_copy(partial_args)

        def compute_args():
            return dict(
                **partial_args,
                dataset_id=self.id,
            )

        self.state.global_bg_logger().log(LazyValue(compute_args, use_mutex=False))
        return id

    def summarize(self, summarize_data: bool = True) -> "DatasetSummary":
        """
        Summarize the dataset, including high level metrics about its size and other metadata.

        :param summarize_data: Whether to summarize the data. If False, only the metadata will be returned.
        :returns: `DatasetSummary`
        """
        # Flush our events to the API, and to the data warehouse, to ensure that the link we print
        # includes the new experiment.
        self.flush()
        state = self._get_state()
        project_url = f"{state.app_public_url}/app/{encode_uri_component(state.org_name)}/p/{encode_uri_component(self.project.name)}"
        dataset_url = f"{project_url}/datasets/{encode_uri_component(self.name)}"

        data_summary = None
        if summarize_data:
            data_summary_d = state.api_conn().get_json(
                "dataset-summary",
                args={
                    "dataset_id": self.id,
                },
            )
            data_summary = DataSummary(new_records=self.new_records, **data_summary_d)

        return DatasetSummary(
            project_name=self.project.name,
            dataset_name=self.name,
            project_url=project_url,
            dataset_url=dataset_url,
            data_summary=data_summary,
        )

    def close(self) -> str:
        """This function is deprecated. You can simply remove it from your code."""

        eprint(
            "close is deprecated and will be removed in a future version of braintrust. It is now a no-op and can be removed"
        )
        return self.id

    def flush(self) -> None:
        """Flush any pending rows to the server."""

        self.state.global_bg_logger().flush()

    def __enter__(self) -> "Dataset":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        del exc_type, exc_value, traceback


def render_message(render: Callable[[str], str], message: PromptMessage):
    base = {k: v for (k, v) in message.as_dict().items() if v is not None}
    # TODO: shouldn't load_prompt guarantee content is a PromptMessage?
    content = cast(Union[str, list[Union[TextPart, ImagePart]], dict[str, Any]], message.content)
    if content is not None:
        if isinstance(content, str):
            base["content"] = render(content)
        else:
            rendered_content = []
            for c in content:
                if isinstance(c, str):
                    rendered_content.append(c)
                    continue

                if not isinstance(c, dict):
                    c = c.as_dict()

                if c["type"] == "text":
                    rendered_content.append({**c, "text": render(c["text"])})
                elif c["type"] == "image_url":
                    rendered_content.append(
                        {
                            **c,
                            "image_url": {**c["image_url"], "url": render(c["image_url"]["url"])},
                        }
                    )
                elif c["type"] == "file":
                    rendered_content.append(
                        {
                            **c,
                            "file": {
                                **c["file"],
                                "file_data": render(c["file"]["file_data"]),
                                **({} if "file_id" not in c["file"] else {"file_id": render(c["file"]["file_id"])}),
                                **({} if "filename" not in c["file"] else {"filename": render(c["file"]["filename"])}),
                            },
                        }
                    )
                else:
                    raise ValueError(f"Unknown content type: {c['type']}")

            base["content"] = rendered_content
    else:
        base["content"] = None

    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls is not None:
        base["tool_calls"] = [
            {
                "type": t.type,
                "id": render(t.id),
                "function": {
                    "name": render(t.function.name),
                    "arguments": render(t.function.arguments),
                },
            }
            for t in tool_calls
        ]

    tool_call_id = getattr(message, "tool_call_id", None)
    if tool_call_id is not None:
        base["tool_call_id"] = render(tool_call_id)

    return base


def _create_custom_render():
    def _get_key(key: str, scopes: list[dict[str, Any]], warn: bool) -> Any:
        thing = chevron.renderer._get_key(key, scopes, warn)  # type: ignore
        if isinstance(thing, str):
            return thing
        return json.dumps(thing)

    def _html_escape(x: Any) -> Any:
        return x

    custom_render = types.FunctionType(
        chevron.render.__code__,
        {
            **chevron.render.__globals__,
            **{
                "_get_key": _get_key,
                "_html_escape": _html_escape,
            },
        },
        chevron.render.__name__,
        chevron.render.__defaults__,
        chevron.render.__closure__,
    )
    custom_render.__kwdefaults__ = chevron.render.__kwdefaults__
    return custom_render


_custom_render = _create_custom_render()


def render_templated_object(obj: Any, args: Any) -> Any:
    strict = args.get("strict", False) if isinstance(args, dict) else False
    if isinstance(obj, str):
        return render_mustache(obj, data=args, renderer=_custom_render, strict=strict)
    elif isinstance(obj, list):
        return [render_templated_object(item, args) for item in obj]  # type: ignore
    elif isinstance(obj, dict):
        return {str(k): render_templated_object(v, args) for k, v in obj.items()}  # type: ignore
    return obj


def render_prompt_params(params: dict[str, Any], args: Any) -> dict[str, Any]:
    if not params:
        return params

    response_format = params.get("response_format")
    if not response_format or not isinstance(response_format, dict):
        return params

    if response_format.get("type") != "json_schema":
        return params

    json_schema = response_format.get("json_schema")
    if not json_schema or not isinstance(json_schema, dict):
        return params

    raw_schema = json_schema.get("schema")
    if raw_schema is None:
        return params

    templated_schema = render_templated_object(raw_schema, args)
    parsed_schema = json.loads(templated_schema) if isinstance(templated_schema, str) else templated_schema

    return {**params, "response_format": {**response_format, "json_schema": {**json_schema, "schema": parsed_schema}}}


def render_mustache(template: str, data: Any, *, strict: bool = False, renderer: Callable[..., Any] | None = None):
    if renderer is None:
        renderer = chevron.render

    if not strict:
        return renderer(template, data=data)

    # Capture stderr to check for missing keys
    stderr_capture = io.StringIO()
    with contextlib.redirect_stderr(stderr_capture):
        result = renderer(template, data=data, warn=True)

    stderr_output = stderr_capture.getvalue()

    # Check if there are missing keys in the stderr output
    if "Could not find key" in stderr_output:
        raise ValueError(f"Template rendering failed: {stderr_output.strip()}")

    return result


class Prompt:
    """
    A prompt object consists of prompt text, a model, and model parameters (such as temperature), which
    can be used to generate completions or chat messages. The prompt object supports calling `.build()`
    which uses mustache templating to build the prompt with the given formatting options and returns a
    plain dictionary that includes the built prompt and arguments. The dictionary can be passed as
    kwargs to the OpenAI client or modified as you see fit.

    You should not create `Prompt` objects directly. Instead, use the `braintrust.load_prompt()` method.
    """

    def __init__(
        self,
        lazy_metadata: LazyValue[PromptSchema],
        defaults: Mapping[str, Any],
        no_trace: bool,
    ):
        self._lazy_metadata = lazy_metadata
        self.defaults = defaults
        self.no_trace = no_trace

    @classmethod
    def from_prompt_data(
        cls,
        name: str,
        prompt_data: PromptData,
    ) -> "Prompt":
        """
        Create a `Prompt` object from the given `PromptSchema` data.
        """
        prompt_schema = PromptSchema(
            name=name,
            slug=name,
            prompt_data=prompt_data,
            id=None,
            project_id=None,
            _xact_id=None,
            description=None,
            tags=None,
        )
        lazy_metadata = LazyValue(lambda: prompt_schema, use_mutex=False)
        return cls(lazy_metadata, {}, False)

    @property
    def id(self) -> str:
        return self._lazy_metadata.get().id

    @property
    def name(self) -> str:
        return self._lazy_metadata.get().name

    @property
    def slug(self) -> str:
        return self._lazy_metadata.get().slug

    @property
    def prompt(self) -> PromptBlockData | None:
        return self._lazy_metadata.get().prompt_data.prompt

    @property
    def version(self) -> str:
        return self._lazy_metadata.get()._xact_id

    @property
    def options(self) -> PromptOptions:
        return self._lazy_metadata.get().prompt_data.options or {}

    # Capture all metadata attributes which aren't covered by existing methods.
    def __getattr__(self, name: str) -> Any:
        return getattr(self._lazy_metadata.get(), name)

    def build(self, **build_args: Any) -> Mapping[str, Any]:
        """
        Build the prompt with the given formatting options. The args you pass in will
        be forwarded to the mustache template that defines the prompt and rendered with
        the `chevron` library.

        :param build_args: Arguments to forward to the prompt template. Can include 'strict=True' to enable strict mode validation.
        :returns: A dictionary that includes the rendered prompt and arguments, that can be passed as kwargs to the OpenAI client.
        """

        # Extract strict mode setting from build_args (using get to avoid modifying the original dict)
        strict = build_args.get("strict", False)

        params = self.options.get("params") or {}
        params = {k: v for (k, v) in params.items() if k not in BRAINTRUST_PARAMS}

        ret = {
            **self.defaults,
            **render_prompt_params(params, build_args),
            **({"model": self.options["model"]} if "model" in self.options else {}),
        }

        if ret.get("model") is None:
            raise ValueError("No model specified. Either specify it in the prompt or as a default")

        if not self.no_trace:
            ret["span_info"] = {
                "metadata": {
                    "prompt": {
                        "variables": build_args,
                        "id": self.id,
                        "project_id": self.project_id,
                        "version": self.version,
                    },
                }
            }

        if not self.prompt:
            raise ValueError("Empty prompt")

        if self.prompt.type == "completion":
            ret["prompt"] = render_mustache(self.prompt.content, data=build_args, strict=strict)
        elif self.prompt.type == "chat":

            def render(template: str):
                return render_mustache(template, data=build_args, strict=strict)

            ret["messages"] = [render_message(render, m) for m in (self.prompt.messages or [])]

            if self.prompt.tools and self.prompt.tools.strip():
                ret["tools"] = json.loads(render_mustache(self.prompt.tools, data=build_args, strict=strict))

        return ret

    def _make_iter_list(self) -> Sequence[str]:
        meta_keys = list(self.options.keys())
        if self.prompt.type == "completion":
            meta_keys.append("prompt")
        else:
            meta_keys.append("chat")
            meta_keys.append("tools")

        return meta_keys

    def __iter__(self) -> Iterator[str]:
        return iter(self._make_iter_list())

    def __len__(self) -> int:
        return len(self._make_iter_list())

    def __getitem__(self, x):
        if x == "prompt":
            return self.prompt.prompt
        elif x == "chat":
            return self.prompt.messages
        elif x == "tools":
            return self.prompt.tools
        else:
            return self.options[x]


class Project:
    def __init__(self, name: str | None = None, id: str | None = None):
        self._name = name
        self._id = id
        self.init_lock = threading.RLock()

    def lazy_init(self):
        if self._id is None or self._name is None:
            with self.init_lock:
                if self._id is None:
                    response = _state.app_conn().post_json(
                        "api/project/register",
                        {
                            "project_name": self._name or GLOBAL_PROJECT,
                            "org_id": _state.org_id,
                        },
                    )
                    self._id = response["project"]["id"]
                    self._name = response["project"]["name"]
                elif self._name is None:
                    response = _state.app_conn().get_json("api/project", {"id": self._id})
                    self._name = response["name"]

        return self

    @property
    def id(self) -> str:
        self.lazy_init()
        return self._id

    @property
    def name(self):
        self.lazy_init()
        return self._name


class Logger(Exportable):
    def __init__(
        self,
        lazy_metadata: LazyValue[OrgProjectMetadata],
        async_flush: bool = True,
        compute_metadata_args: dict | None = None,
        link_args: dict | None = None,
        state: BraintrustState | None = None,
    ):
        self._lazy_metadata = lazy_metadata
        self.async_flush = async_flush
        self._compute_metadata_args = compute_metadata_args
        self.last_start_time = time.time()
        self._lazy_id = LazyValue(lambda: self.id, use_mutex=False)
        self._called_start_span = False
        # unresolved args about the org / project. Use these as potential
        # fallbacks when generating links
        self._link_args = link_args
        self.state = state or _state

    @property
    def org_id(self) -> str:
        return self._lazy_metadata.get().org_id

    @property
    def project(self) -> ObjectMetadata:
        return self._lazy_metadata.get().project

    @property
    def id(self) -> str:
        return self.project.id

    @property
    def logging_state(self) -> BraintrustState:
        return self.state

    @staticmethod
    def _parent_object_type():
        return SpanObjectTypeV3.PROJECT_LOGS

    def _get_state(self) -> BraintrustState:
        # Ensure the login state is populated by fetching the lazy_metadata.
        self._lazy_metadata.get()
        return self.state

    def log(
        self,
        input: Any | None = None,
        output: Any | None = None,
        expected: Any | None = None,
        error: str | None = None,
        tags: Sequence[str] | None = None,
        scores: Mapping[str, int | float] | None = None,
        metadata: Mapping[str, Any] | None = None,
        metrics: Mapping[str, int | float] | None = None,
        id: str | None = None,
        allow_concurrent_with_spans: bool = False,
    ) -> str:
        """
        Log a single event. The event will be batched and uploaded behind the scenes.

        :param input: (Optional) the arguments that uniquely define a user input (an arbitrary, JSON serializable object).
        :param output: (Optional) the output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
        :param expected: (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
        :param error: (Optional) The error that occurred, if any. If you use tracing to run an experiment, errors are automatically logged when your code throws an exception.
        :param tags: (Optional) a list of strings that you can use to filter and group records later.
        :param scores: (Optional) a dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare logs.
        :param metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
        :param metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically: "start", "end".
        :param id: (Optional) a unique identifier for the event. If you don't provide one, BrainTrust will generate one for you.
        :param allow_concurrent_with_spans: (Optional) in rare cases where you need to log at the top level separately from using spans on the logger elsewhere, set this to True.
        """
        if self._called_start_span and not allow_concurrent_with_spans:
            raise Exception(
                "Cannot run toplevel `log` method while using spans. To log to the span, call `logger.start_span` and then log with `span.log`"
            )

        span = self._start_span_impl(
            start_time=self.last_start_time,
            lookup_span_parent=False,
            input=input,
            output=output,
            expected=expected,
            error=error,
            tags=tags,
            scores=scores,
            metadata=metadata,
            metrics=metrics,
            id=id,
        )
        self.last_start_time = span.end()

        if not self.async_flush:
            self.flush()

        return span.id

    def log_feedback(
        self,
        id: str,
        scores: Mapping[str, int | float] | None = None,
        expected: Any | None = None,
        tags: Sequence[str] | None = None,
        comment: str | None = None,
        metadata: Mapping[str, Any] | None = None,
        source: Literal["external", "app", "api", None] = None,
    ) -> None:
        """
        Log feedback to an event. Feedback is used to save feedback scores, set an expected value, or add a comment.

        :param id: The id of the event to log feedback for. This is the `id` returned by `log` or accessible as the `id` field of a span.
        :param scores: (Optional) a dictionary of numeric values (between 0 and 1) to log. These scores will be merged into the existing scores for the event.
        :param expected: (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not.
        :param tags: (Optional) a list of strings that you can use to filter and group records later.
        :param comment: (Optional) an optional comment string to log about the event.
        :param metadata: (Optional) a dictionary with additional data about the feedback. If you have a `user_id`, you can log it here and access it in the Braintrust UI. Note, this metadata does not correspond to the main event itself, but rather the audit log attached to the event.
        :param source: (Optional) the source of the feedback. Must be one of "external" (default), "app", or "api".
        """
        return _log_feedback_impl(
            parent_object_type=self._parent_object_type(),
            parent_object_id=self._lazy_id,
            id=id,
            scores=scores,
            expected=expected,
            tags=tags,
            comment=comment,
            metadata=metadata,
            source=source,
        )

    def start_span(
        self,
        name: str | None = None,
        type: SpanTypeAttribute | None = None,
        span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
        start_time: float | None = None,
        set_current: bool | None = None,
        parent: str | None = None,
        propagated_event: dict[str, Any] | None = None,
        span_id: str | None = None,
        root_span_id: str | None = None,
        **event: Any,
    ) -> Span:
        """Create a new toplevel span underneath the logger. The name defaults to "root" and the span type to "task".

        See `Span.start_span` for full details
        """
        self._called_start_span = True
        return self._start_span_impl(
            name=name,
            type=type,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            parent=parent,
            propagated_event=propagated_event,
            span_id=span_id,
            root_span_id=root_span_id,
            **event,
        )

    def update_span(self, id: str, **event: Any) -> None:
        """
        Update a span in the experiment using its id. It is important that you only update a span once the original span
        has been fully written and flushed, since otherwise updates to the span may conflict with the original span.

        :param id: The id of the span to update.
        :param **event: Data to update. See `Experiment.log` for a full list of valid fields.
        """
        return _update_span_impl(
            parent_object_type=self._parent_object_type(),
            parent_object_id=self._lazy_id,
            id=id,
            **event,
        )

    def _start_span_impl(
        self,
        name: str | None = None,
        type: SpanTypeAttribute | None = None,
        span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
        start_time: float | None = None,
        set_current: bool | None = None,
        parent: str | None = None,
        propagated_event: dict[str, Any] | None = None,
        span_id: str | None = None,
        root_span_id: str | None = None,
        lookup_span_parent: bool = True,
        **event: Any,
    ) -> Span:
        parent_args = _start_span_parent_args(
            parent=parent,
            parent_object_type=self._parent_object_type(),
            parent_object_id=self._lazy_id,
            parent_compute_object_metadata_args=self._compute_metadata_args,
            parent_span_ids=None,
            propagated_event=propagated_event,
        )
        return SpanImpl(
            **parent_args,
            name=name,
            type=type,
            default_root_type=SpanTypeAttribute.TASK,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            event=event,
            span_id=span_id,
            root_span_id=root_span_id,
            lookup_span_parent=lookup_span_parent,
            state=self.state,
        )

    def export(self) -> str:
        """Return a serialized representation of the logger that can be used to start subspans in other places. See `Span.start_span` for more details."""
        # Note: it is important that the object id we are checking for
        # `has_succeeded` is the same as the one we are passing into the span
        # logging functions. So that if the spans actually do get logged, then
        # this `_lazy_id` object specifically will also be marked as computed.
        if self._compute_metadata_args and not self._lazy_id.has_succeeded:
            object_id = None
            compute_object_metadata_args = self._compute_metadata_args
        else:
            object_id = self._lazy_id.get()
            compute_object_metadata_args = None

        exporter = _get_exporter()
        return exporter(
            object_type=self._parent_object_type(),
            object_id=object_id,
            compute_object_metadata_args=compute_object_metadata_args,
        ).to_str()

    def __enter__(self) -> "Logger":
        return self

    def _get_link_base_url(self) -> str | None:
        """Return the base of link urls (e.g. https://braintrust.dev/app/my-org-name/) if we have the info
        otherwise return None.
        """
        # the url and org name can be passed into init_logger, resolved by login or provided as env variables
        # so this resolves all of those things. It's possible we never have an org name if the user has not
        # yet logged in and there is nothing else configured.
        app_url = self.state.app_url or self._link_args.get("app_url") or _get_app_url()
        org_name = self.state.org_name or self._link_args.get("org_name") or _get_org_name()
        if not app_url or not org_name:
            return None
        return f"{app_url}/app/{org_name}"

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        del exc_type, exc_value, traceback

    def flush(self) -> None:
        """
        Flush any pending logs to the server.
        """
        self.state.global_bg_logger().flush()


@dataclasses.dataclass
class ScoreSummary(SerializableDataClass):
    """Summary of a score's performance."""

    name: str
    """Name of the score."""

    # Used to help with formatting
    _longest_score_name: int

    score: float
    """Average score across all examples."""

    improvements: int | None
    """Number of improvements in the score."""
    regressions: int | None
    """Number of regressions in the score."""
    diff: float | None = None
    """Difference in score between the current and reference experiment."""

    def __str__(self):
        # format with 2 decimal points and pad so that it's exactly 2 characters then 2 decimals
        score_pct = f"{self.score * 100:05.2f}%"

        # pad the name with spaces so that its length is self._longest_score_name + 2
        score_name = f"'{self.name}'".ljust(self._longest_score_name + 2)

        if self.diff is not None:
            diff_pct = f"{abs(self.diff) * 100:05.2f}%"
            diff_score = f"+{diff_pct}" if self.diff > 0 else f"-{diff_pct}" if self.diff < 0 else "-"

            return textwrap.dedent(
                f"""{score_pct} ({diff_score}) {score_name} score\t({self.improvements} improvements, {self.regressions} regressions)"""
            )
        else:
            return textwrap.dedent(f"""{score_pct} {score_name} score""")


@dataclasses.dataclass
class MetricSummary(SerializableDataClass):
    """Summary of a metric's performance."""

    name: str
    """Name of the metric."""

    # Used to help with formatting
    _longest_metric_name: int

    metric: float | int
    """Average metric across all examples."""
    unit: str
    """Unit label for the metric."""
    improvements: int | None
    """Number of improvements in the metric."""
    regressions: int | None
    """Number of regressions in the metric."""
    diff: float | None = None
    """Difference in metric between the current and reference experiment."""

    def __str__(self):
        number_fmt = "{:d}" if isinstance(self.metric, int) else "{:.2f}"
        metric = number_fmt.format(self.metric)
        if self.diff is None:
            return textwrap.dedent(f"""{metric}{self.unit} {self.name}""")

        diff_pct = f"{abs(self.diff) * 100:05.2f}%"
        diff_score = f"+{diff_pct}" if self.diff > 0 else f"-{diff_pct}" if self.diff < 0 else "-"

        # pad the name with spaces so that its length is self._longest_score_name + 2
        metric_name = f"'{self.name}'".ljust(self._longest_metric_name + 2)

        return textwrap.dedent(
            f"""{metric}{self.unit} ({diff_score}) {metric_name}\t({self.improvements} improvements, {self.regressions} regressions)"""
        )


@dataclasses.dataclass
class ExperimentSummary(SerializableDataClass):
    """Summary of an experiment's scores and metadata."""

    project_name: str
    """Name of the project that the experiment belongs to."""
    project_id: str | None
    """ID of the project. May be `None` if the eval was run locally."""
    experiment_id: str | None
    """ID of the experiment. May be `None` if the eval was run locally."""
    experiment_name: str
    """Name of the experiment."""
    project_url: str | None
    """URL to the project's page in the Braintrust app."""
    experiment_url: str | None
    """URL to the experiment's page in the Braintrust app."""
    comparison_experiment_name: str | None
    """The experiment scores are baselined against."""
    scores: dict[str, ScoreSummary]
    """Summary of the experiment's scores."""
    metrics: dict[str, MetricSummary]
    """Summary of the experiment's metrics."""

    def __str__(self):
        comparison_line = ""
        if self.comparison_experiment_name:
            comparison_line = f"""{self.experiment_name} compared to {self.comparison_experiment_name}:\n"""
        return (
            f"""\n=========================SUMMARY=========================\n{comparison_line}"""
            + "\n".join([str(score) for score in self.scores.values()])
            + ("\n\n" if self.scores else "")
            + "\n".join([str(metric) for metric in self.metrics.values()])
            + ("\n\n" if self.metrics else "")
            + (
                textwrap.dedent(
                    f"""\
        See results for {self.experiment_name} at {self.experiment_url}"""
                )
                if self.experiment_url is not None
                else ""
            )
        )


@dataclasses.dataclass
class DataSummary(SerializableDataClass):
    """Summary of a dataset's data."""

    new_records: int
    """New or updated records added in this session."""
    total_records: int
    """Total records in the dataset."""

    def __str__(self):
        return textwrap.dedent(f"""Total records: {self.total_records} ({self.new_records} new or updated records)""")


@dataclasses.dataclass
class DatasetSummary(SerializableDataClass):
    """Summary of a dataset's scores and metadata."""

    project_name: str
    """Name of the project that the dataset belongs to."""
    dataset_name: str
    """Name of the dataset."""
    project_url: str
    """URL to the project's page in the Braintrust app."""
    dataset_url: str
    """URL to the experiment's page in the Braintrust app."""
    data_summary: DataSummary | None
    """Summary of the dataset's data."""

    def __str__(self):
        return textwrap.dedent(
            f"""\

             =========================SUMMARY=========================
             {str(self.data_summary)}
             See results for all datasets in {self.project_name} at {self.project_url}
             See results for {self.dataset_name} at {self.dataset_url}"""
        )


class TracedThreadPoolExecutor(concurrent.futures.ThreadPoolExecutor):
    # Returns Any because Future[T] generic typing was stabilized in Python 3.9,
    # but we maintain compatibility with older type checkers.
    def submit(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        # Capture all current context variables
        context = contextvars.copy_context()

        def wrapped_fn(*args, **kwargs):
            # Run the function inside the captured context
            return context.run(fn, *args, **kwargs)

        return super().submit(wrapped_fn, *args, **kwargs)


def get_prompt_versions(project_id: str, prompt_id: str) -> list[str]:
    """
    Get the versions for a specific prompt.

    Args:
        project_id: The ID of the project to query
        prompt_id: The ID of the prompt to get versions for

    Returns:
        List of transaction IDs (_xact_id) for entries where audit_data.action is "upsert"
    """

    query = {
        "from": {
            "op": "function",
            "name": {
                "op": "ident",
                "name": ["project_prompts"],
            },
            "args": [
                {
                    "op": "literal",
                    "value": project_id,
                },
            ],
        },
        "select": [
            {
                "op": "star",
            },
        ],
        "filter": {
            "op": "eq",
            "left": {"op": "ident", "name": ["id"]},
            "right": {"op": "literal", "value": prompt_id},
        },
    }

    resp = _state.api_conn().post(
        "btql",
        json={
            "query": query,
            "audit_log": True,
            "use_columnstore": False,
            "brainstore_realtime": True,
        },
        headers={"Accept-Encoding": "gzip"},
    )

    response_raise_for_status(resp)
    result = resp.json()

    # Filter for entries where audit_data.action is "upsert" or "merge" and return prettified _xact_id fields
    return [
        prettify_xact(entry["_xact_id"])
        for entry in result.get("data", [])
        if entry.get("audit_data", {}).get("action") in ["upsert", "merge"]
    ]


def _get_app_url(app_url: str | None = None) -> str:
    if app_url:
        return app_url
    return os.getenv("BRAINTRUST_APP_URL", DEFAULT_APP_URL)


def _get_org_name(org_name: str | None = None) -> str | None:
    if org_name:
        return org_name
    return os.getenv("BRAINTRUST_ORG_NAME")


def _get_error_link(msg="") -> str:
    return f"https://www.braintrust.dev/error-generating-link?msg={encode_uri_component(msg)}"
