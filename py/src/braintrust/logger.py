import abc
import atexit
import concurrent.futures
import contextlib
import contextvars
import dataclasses
import datetime
import inspect
import json
import logging
import os
import queue
import sys
import textwrap
import threading
import time
import traceback
import uuid
from abc import ABC, abstractmethod
from functools import partial, wraps
from multiprocessing import cpu_count
from typing import Any, Dict, Optional, Union

import chevron
import exceptiongroup
import requests
from braintrust_core.bt_json import bt_dumps
from braintrust_core.db_fields import (
    AUDIT_METADATA_FIELD,
    AUDIT_SOURCE_FIELD,
    IS_MERGE_FIELD,
    TRANSACTION_ID_FIELD,
    VALID_SOURCES,
)
from braintrust_core.git_fields import GitMetadataSettings, RepoInfo
from braintrust_core.merge_row_batch import batch_items, merge_row_batch
from braintrust_core.object import DEFAULT_IS_LEGACY_DATASET, ensure_dataset_record, make_legacy_event
from braintrust_core.prompt import BRAINTRUST_PARAMS, PromptSchema
from braintrust_core.span_identifier import SpanComponents, SpanObjectType, SpanRowIds
from braintrust_core.span_types import SpanTypeAttribute
from braintrust_core.util import (
    SerializableDataClass,
    coalesce,
    encode_uri_component,
    eprint,
    merge_dicts,
)
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .gitutil import get_past_n_ancestors, get_repo_info
from .util import (
    GLOBAL_PROJECT,
    AugmentedHTTPError,
    LazyValue,
    get_caller_location,
    response_raise_for_status,
)

Metadata = Dict[str, Any]
DATA_API_VERSION = 2


class Span(ABC):
    """
    A Span encapsulates logged data and metrics for a unit of work. This interface is shared by all span implementations.

    We suggest using one of the various `start_span` methods, instead of creating Spans directly. See `Span.start_span` for full details.
    """

    @property
    @abstractmethod
    def id(self) -> str:
        """Row ID of the span."""

    @abstractmethod
    def log(self, **event):
        """Incrementally update the current span with new data. The event will be batched and uploaded behind the scenes.

        :param **event: Data to be logged. See `Experiment.log` for full details.
        """

    @abstractmethod
    def log_feedback(self, **event):
        """Add feedback to the current span. Unlike `Experiment.log_feedback` and `Logger.log_feedback`, this method does not accept an id parameter, because it logs feedback to the current span.

        :param **event: Data to be logged. See `Experiment.log_feedback` for full details.
        """

    @abstractmethod
    def start_span(
        self,
        name=None,
        type=None,
        span_attributes=None,
        start_time=None,
        set_current=None,
        parent=None,
        **event,
    ):
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
    def end(self, end_time=None) -> float:
        """Log an end time to the span (defaults to the current time). Returns the logged time.

        Will be invoked automatically if the span is bound to a context manager.

        :param end_time: Optional end time of the span, as a timestamp in seconds.
        :returns: The end time logged to the span metrics.
        """

    @abstractmethod
    def export(self) -> str:
        """Return a serialized representation of the span that can be used to start subspans in other places. See `Span.start_span` for more details."""

    @abstractmethod
    def flush(self):
        """Flush any pending rows to the server."""

    @abstractmethod
    def close(self, end_time=None) -> float:
        """Alias for `end`."""

    @abstractmethod
    def __enter__(self):
        pass

    @abstractmethod
    def __exit__(self):
        pass


class _NoopSpan(Span):
    """A fake implementation of the Span API which does nothing. This can be used as the default span."""

    def __init__(self, *args, **kwargs):
        pass

    @property
    def id(self):
        return ""

    def log(self, **event):
        pass

    def log_feedback(self, **event):
        pass

    def start_span(
        self,
        name=None,
        type=None,
        span_attributes=None,
        start_time=None,
        set_current=None,
        parent=None,
        **event,
    ):
        return self

    def end(self, end_time=None):
        return end_time or time.time()

    def export(self):
        return ""

    def flush(self):
        pass

    def close(self, end_time=None):
        return self.end(end_time)

    def __enter__(self):
        return self

    def __exit__(self, type, value, callback):
        del type, value, callback


NOOP_SPAN = _NoopSpan()


class BraintrustState:
    def __init__(self):
        self.id = str(uuid.uuid4())
        self.current_experiment = None
        self.current_logger = None
        self.current_span = contextvars.ContextVar("braintrust_current_span", default=NOOP_SPAN)

        def default_get_log_conn():
            login()
            return self.log_conn()

        # Any time we re-log in, we directly update the log_conn inside the
        # logger. This is preferable to replacing the whole logger, which would
        # create the possibility of multiple loggers floating around.
        self._global_bg_logger = _BackgroundLogger(LazyValue(default_get_log_conn, use_mutex=True))

        # For unit-testing, tests may wish to temporarily override the global
        # logger with a custom one. We allow this but keep the override variable
        # thread-local to prevent the possibility that tests running on
        # different threads unintentionally use the same override.
        self._override_bg_logger = threading.local()

        self.reset_login_info()

    def reset_login_info(self):
        self.app_url = None
        self.app_public_url = None
        self.login_token = None
        self.org_id = None
        self.org_name = None
        self.log_url = None
        self.logged_in = False
        self.git_metadata_settings = None

        self._app_conn = None
        self._log_conn = None
        self._user_info = None

    def app_conn(self):
        if not self._app_conn:
            if not self.app_url:
                raise RuntimeError("Must initialize app_url before requesting app_conn")
            self._app_conn = HTTPConnection(self.app_url, adapter=_http_adapter)
        return self._app_conn

    def log_conn(self):
        if not self._log_conn:
            if not self.log_url:
                raise RuntimeError("Must initialize log_url before requesting log_conn")
            self._log_conn = HTTPConnection(self.log_url, adapter=_http_adapter)
        return self._log_conn

    def user_info(self):
        if not self._user_info:
            self._user_info = self.log_conn().get_json("ping")
        return self._user_info

    def set_user_info_if_null(self, info):
        if not self._user_info:
            self._user_info = info

    def global_bg_logger(self):
        return getattr(self._override_bg_logger, "logger", self._global_bg_logger)

    # Should only be called by the login function.
    def login_replace_log_conn(self, log_conn: "HTTPConnection"):
        self._global_bg_logger.internal_replace_log_conn(log_conn)


_state = None


_http_adapter = None


def set_http_adapter(adapter: HTTPAdapter):
    """
    Specify a custom HTTP adapter to use for all network requests. This is useful for setting custom retry policies, timeouts, etc.
    Braintrust uses the `requests` library, so the adapter should be an instance of `requests.adapters.HTTPAdapter`.

    :param adapter: The adapter to use.
    """

    global _http_adapter

    _http_adapter = adapter

    if _state._app_conn:
        _state._app_conn._set_adapter(adapter=adapter)
        _state._app_conn._reset()
    if _state._log_conn:
        _state._app_conn._set_adapter(adapter=adapter)
        _state._log_conn._reset()


class HTTPConnection:
    def __init__(self, base_url, adapter=None):
        self.base_url = base_url
        self.token = None
        self.adapter = adapter

        self._reset(total=0)

    def ping(self):
        try:
            resp = self.get("ping")
            _state.set_user_info_if_null(resp.json())
            return resp.ok
        except requests.exceptions.ConnectionError:
            return False

    def make_long_lived(self):
        # Following a suggestion in https://stackoverflow.com/questions/23013220/max-retries-exceeded-with-url-in-requests
        self._reset(connect=10, backoff_factor=0.5)

    @staticmethod
    def sanitize_token(token):
        return token.rstrip("\n")

    def set_token(self, token):
        token = HTTPConnection.sanitize_token(token)
        self.token = token
        self._set_session_token()

    def _set_adapter(self, adapter):
        self.adapter = adapter

    def _reset(self, **retry_kwargs):
        self.session = requests.Session()

        adapter = self.adapter
        if adapter is None:
            retry = Retry(**retry_kwargs)
            adapter = HTTPAdapter(max_retries=retry)

        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)

        self._set_session_token()

    def _set_session_token(self):
        if self.token:
            self.session.headers.update({"Authorization": f"Bearer {self.token}"})

    def get(self, path, *args, **kwargs):
        return self.session.get(_urljoin(self.base_url, path), *args, **kwargs)

    def post(self, path, *args, **kwargs):
        return self.session.post(_urljoin(self.base_url, path), *args, **kwargs)

    def delete(self, path, *args, **kwargs):
        return self.session.delete(_urljoin(self.base_url, path), *args, **kwargs)

    def get_json(self, object_type, args=None, retries=0):
        tries = retries + 1
        for i in range(tries):
            resp = self.get(f"/{object_type}", params=args)
            if i < tries - 1 and not resp.ok:
                _logger.warning(f"Retrying API request {object_type} {args} {resp.status_code} {resp.text}")
                continue
            response_raise_for_status(resp)

            return resp.json()

    def post_json(self, object_type, args):
        resp = self.post(f"/{object_type.lstrip('/')}", json=args)
        response_raise_for_status(resp)
        return resp.json()


# Sometimes we'd like to launch network requests concurrently. We provide a
# thread pool to accomplish this. Use a multiple of number of CPU cores to limit
# concurrency.
HTTP_REQUEST_THREAD_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=cpu_count())


def log_conn():
    return _state.log_conn()


def api_conn():
    return _state.app_conn()


def user_info():
    return _state.user_info()


def org_id():
    return _state.org_id


def construct_json_array(items):
    return "[" + ",".join(items) + "]"


def construct_logs3_data(items):
    rowsS = construct_json_array(items)
    return '{"rows": ' + rowsS + ', "api_version": ' + str(DATA_API_VERSION) + "}"


def _check_json_serializable(event):
    try:
        return bt_dumps(event)
    except TypeError as e:
        raise Exception(f"All logged values must be JSON-serializable: {event}") from e


# We should only have one instance of this object in
# 'BraintrustState._global_bg_logger'. Be careful about spawning multiple
# instances of this class, because concurrent _BackgroundLoggers will not log to
# the backend in a deterministic order.
class _BackgroundLogger:
    def __init__(self, log_conn: LazyValue[HTTPConnection]):
        self.log_conn = log_conn
        self.outfile = sys.stderr
        self.flush_lock = threading.RLock()

        try:
            self.sync_flush = bool(int(os.environ["BRAINTRUST_SYNC_FLUSH"]))
        except:
            self.sync_flush = False

        try:
            self.max_request_size = int(os.environ["BRAINTRUST_MAX_REQUEST_SIZE"])
        except:
            # 6 MB for the AWS lambda gateway (from our own testing).
            self.max_request_size = 6 * 1024 * 1024

        try:
            self.default_batch_size = int(os.environ["BRAINTRUST_DEFAULT_BATCH_SIZE"])
        except:
            self.default_batch_size = 100

        try:
            self.num_retries = int(os.environ["BRAINTRUST_NUM_RETRIES"])
        except:
            self.num_retries = 3

        try:
            queue_maxsize = int(os.environ["BRAINTRUST_QUEUE_SIZE"])
        except:
            # Don't limit the queue size if we're in 'sync_flush' mode, because
            # otherwise logging could block indefinitely.
            queue_maxsize = 0 if self.sync_flush else 1000

        self.start_thread_lock = threading.RLock()
        self.thread = threading.Thread(target=self._publisher, daemon=True)
        self.started = False

        self.logger = logging.getLogger("braintrust")
        self.queue = queue.Queue(maxsize=queue_maxsize)
        # Each time we put items in the queue, we increment a semaphore to
        # indicate to any consumer thread that it should attempt a flush.
        self.queue_filled_semaphore = threading.Semaphore(value=0)

        atexit.register(self._finalize)

    def log(self, *args):
        self._start()
        for event in args:
            try:
                self.queue.put_nowait(event)
            except queue.Full:
                # Notify consumers to start draining the queue.
                self.queue_filled_semaphore.release()
                self.queue.put(event)
        self.queue_filled_semaphore.release()

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
            self.queue_filled_semaphore.acquire()

            while self.sync_flush:
                time.sleep(0.1)

            try:
                self.flush()
            except:
                traceback.print_exc(file=self.outfile)

    def flush(self, batch_size=None):
        if batch_size is None:
            batch_size = self.default_batch_size

        # We cannot have multiple threads flushing in parallel, because the
        # order of published elements would be undefined.
        with self.flush_lock:
            # Drain the queue.
            wrapped_items = []
            try:
                for _ in range(self.queue.qsize()):
                    wrapped_items.append(self.queue.get_nowait())
            except queue.Empty:
                pass

            all_items = self._unwrap_lazy_values(wrapped_items)
            if len(all_items) == 0:
                return

            # Construct batches of records to flush in parallel and in sequence.
            all_items_str = [[bt_dumps(item) for item in bucket] for bucket in all_items]
            batch_sets = batch_items(
                items=all_items_str, batch_max_num_items=batch_size, batch_max_num_bytes=self.max_request_size / 2
            )
            for batch_set in batch_sets:
                post_promises = []
                try:
                    post_promises = [
                        HTTP_REQUEST_THREAD_POOL.submit(self._submit_logs_request, batch) for batch in batch_set
                    ]
                except RuntimeError:
                    # If the thread pool has shut down, e.g. because the process
                    # is terminating, run the requests the old fashioned way.
                    for batch in batch_set:
                        self._submit_logs_request(batch)

                concurrent.futures.wait(post_promises)
                # Raise any exceptions from the promises as one group.
                post_promise_exceptions = [f.exception() for f in post_promises if f.exception() is not None]
                if post_promise_exceptions:
                    raise exceptiongroup.ExceptionGroup(
                        f"Encountered the following errors while logging:", post_promise_exceptions
                    )

    def _unwrap_lazy_values(self, wrapped_items):
        for i in range(self.num_retries):
            try:
                unwrapped_items = [item.get() for item in wrapped_items]
                return merge_row_batch(unwrapped_items)
            except Exception as e:
                errmsg = "Encountered error when constructing records to flush"
                is_retrying = i + 1 < self.num_retries
                if is_retrying:
                    errmsg += ". Retrying"

                if not is_retrying and self.sync_flush:
                    raise Exception(errmsg) from e
                else:
                    print(errmsg, file=self.outfile)
                    traceback.print_exc(file=self.outfile)
                    if is_retrying:
                        time.sleep(0.1)

        print(
            f"Failed to construct log records to flush after {self.num_retries} retries. Dropping batch",
            file=self.outfile,
        )
        return []

    def _submit_logs_request(self, items):
        conn = self.log_conn.get()
        dataStr = construct_logs3_data(items)
        for i in range(self.num_retries):
            start_time = time.time()
            resp = conn.post("/logs3", data=dataStr)
            if not resp.ok:
                legacyDataS = construct_json_array([json.dumps(make_legacy_event(json.loads(r))) for r in items])
                resp = conn.post("/logs", data=legacyDataS)
            if resp.ok:
                return

            is_retrying = i + 1 < self.num_retries
            retrying_text = "" if is_retrying else " Retrying"
            errmsg = f"log request failed. Elapsed time: {time.time() - start_time} seconds. Payload size: {len(dataStr)}.{retrying_text}\nError: {resp.status_code}: {resp.text}"

            if not is_retrying and self.sync_flush:
                raise Exception(errmsg)
            else:
                print(errmsg, file=self.outfile)
                if is_retrying:
                    time.sleep(0.1)

        print(f"log request failed after {self.num_retries} retries. Dropping batch", file=self.outfile)

    # Should only be called by BraintrustState.
    def internal_replace_log_conn(self, log_conn: HTTPConnection):
        self.log_conn = LazyValue(lambda: log_conn, use_mutex=False)


def _internal_reset_global_state():
    global _state
    _state = BraintrustState()


_internal_reset_global_state()
_logger = logging.getLogger("braintrust")


@contextlib.contextmanager
def _internal_with_custom_background_logger():
    custom_logger = _BackgroundLogger(LazyValue(lambda: _state.log_conn(), use_mutex=True))
    _state._override_bg_logger.logger = custom_logger
    try:
        yield custom_logger
    finally:
        _state._override_bg_logger.logger = None


@dataclasses.dataclass
class ObjectMetadata:
    id: str
    name: str
    full_info: Dict[str, Any]


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


def init(
    project: Optional[str] = None,
    experiment: Optional[str] = None,
    description: Optional[str] = None,
    dataset: Optional["Dataset"] = None,
    open: bool = False,
    base_experiment: Optional[str] = None,
    is_public: bool = False,
    app_url: Optional[str] = None,
    api_key: Optional[str] = None,
    org_name: Optional[str] = None,
    metadata: Optional[Metadata] = None,
    git_metadata_settings: Optional[GitMetadataSettings] = None,
    set_current: bool = True,
    update: Optional[bool] = None,
    project_id: Optional[str] = None,
    base_experiment_id: Optional[str] = None,
    repo_info: Optional[RepoInfo] = None,
):
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
    :param app_url: The URL of the Braintrust App. Defaults to https://www.braintrustdata.com.
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
    :returns: The experiment object.
    """

    if open and update:
        raise ValueError("Cannot open and update an experiment at the same time")

    if open:
        if experiment is None:
            raise ValueError(f"Cannot open an experiment without specifying its name")

        def compute_metadata():
            login(org_name=org_name, api_key=api_key, app_url=app_url)
            args = {
                "experiment_name": experiment,
                "project_name": project,
                "project_id": project_id,
                "org_name": _state.org_name,
            }

            response = _state.app_conn().post_json("api/experiment/get", args)
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
        return ReadonlyExperiment(lazy_metadata=lazy_metadata)

    def compute_metadata():
        login(org_name=org_name, api_key=api_key, app_url=app_url)
        args = {
            "project_name": project,
            "project_id": project_id,
            "org_id": _state.org_id,
            "update": update,
        }

        if experiment is not None:
            args["experiment_name"] = experiment

        if description is not None:
            args["description"] = description

        if repo_info:
            repo_info_arg = repo_info
        else:
            merged_git_metadata_settings = _state.git_metadata_settings
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
        else:
            args["ancestor_commits"] = list(get_past_n_ancestors())

        if dataset is not None:
            args["dataset_id"] = dataset.id
            args["dataset_version"] = dataset.version

        if is_public is not None:
            args["public"] = is_public

        if metadata is not None:
            args["metadata"] = metadata

        while True:
            try:
                response = _state.app_conn().post_json("api/experiment/register", args)
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

    ret = Experiment(lazy_metadata=LazyValue(compute_metadata, use_mutex=True), dataset=dataset)
    if set_current:
        _state.current_experiment = ret
    return ret


def init_experiment(*args, **kwargs):
    """Alias for `init`"""

    return init(*args, **kwargs)


def init_dataset(
    project: Optional[str] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
    version: Optional[Union[str, int]] = None,
    app_url: Optional[str] = None,
    api_key: Optional[str] = None,
    org_name: Optional[str] = None,
    project_id: Optional[str] = None,
    use_output: bool = DEFAULT_IS_LEGACY_DATASET,
):
    """
    Create a new dataset in a specified project. If the project does not exist, it will be created.

    :param project_name: The name of the project to create the dataset in. Must specify at least one of `project_name` or `project_id`.
    :param name: The name of the dataset to create. If not specified, a name will be generated automatically.
    :param description: An optional description of the dataset.
    :param version: An optional version of the dataset (to read). If not specified, the latest version will be used.
    :param app_url: The URL of the Braintrust App. Defaults to https://www.braintrustdata.com.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :param project_id: The id of the project to create the dataset in. This takes precedence over `project` if specified.
    :param use_output: If True (the default), records will be fetched from this dataset in the legacy format, with the "expected" field renamed to "output". This will default to False in a future version of Braintrust.
    :returns: The dataset object.
    """

    def compute_metadata():
        login(org_name=org_name, api_key=api_key, app_url=app_url)
        args = _populate_args(
            {"project_name": project, "project_id": project_id, "org_id": _state.org_id},
            dataset_name=name,
            description=description,
        )
        response = _state.app_conn().post_json("api/dataset/register", args)
        resp_project = response["project"]
        resp_dataset = response["dataset"]
        return ProjectDatasetMetadata(
            project=ObjectMetadata(id=resp_project["id"], name=resp_project["name"], full_info=resp_project),
            dataset=ObjectMetadata(id=resp_dataset["id"], name=resp_dataset["name"], full_info=resp_dataset),
        )

    return Dataset(lazy_metadata=LazyValue(compute_metadata, use_mutex=True), version=version, legacy=use_output)


def init_logger(
    project: Optional[str] = None,
    project_id: Optional[str] = None,
    async_flush: bool = True,
    app_url: Optional[str] = None,
    api_key: Optional[str] = None,
    org_name: Optional[str] = None,
    force_login: bool = False,
    set_current: bool = True,
):
    """
    Create a new logger in a specified project. If the project does not exist, it will be created.

    :param project: The name of the project to log into. If unspecified, will default to the Global project.
    :param project_id: The id of the project to log into. This takes precedence over project if specified.
    :param async_flush: If true (the default), log events will be batched and sent asynchronously in a background thread. If false, log events will be sent synchronously. Set to false in serverless environments.
    :param app_url: The URL of the Braintrust API. Defaults to https://www.braintrustdata.com.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :param force_login: Login again, even if you have already logged in (by default, the logger will not login if you are already logged in)
    :param set_current: If true (the default), set the global current-experiment to the newly-created one.
    :returns: The newly created Logger.
    """

    def compute_metadata():
        login(org_name=org_name, api_key=api_key, app_url=app_url, force_login=force_login)
        org_id = _state.org_id
        if project_id is None:
            response = _state.app_conn().post_json(
                "api/project/register",
                {
                    "project_name": project or GLOBAL_PROJECT,
                    "org_id": _state.org_id,
                },
            )
            resp_project = response["project"]
            return OrgProjectMetadata(
                org_id=org_id,
                project=ObjectMetadata(id=resp_project["id"], name=resp_project["name"], full_info=resp_project),
            )
        elif project is None:
            response = _state.app_conn().get_json("api/project", {"id": project_id})
            return OrgProjectMetadata(
                org_id=org_id, project=ObjectMetadata(id=project_id, name=response["name"], full_info=response)
            )
        else:
            return OrgProjectMetadata(
                org_id=org_id, project=ObjectMetadata(id=project_id, name=project, full_info=dict())
            )

    ret = Logger(
        lazy_metadata=LazyValue(compute_metadata, use_mutex=True),
        async_flush=async_flush,
    )
    if set_current:
        _state.current_logger = ret
    return ret


def load_prompt(
    project: Optional[str] = None,
    slug: Optional[str] = None,
    version: Optional[Union[str, int]] = None,
    project_id: Optional[str] = None,
    defaults: Optional[Dict[str, Any]] = None,
    no_trace: bool = False,
    app_url: Optional[str] = None,
    api_key: Optional[str] = None,
    org_name: Optional[str] = None,
):
    """
    Loads a prompt from the specified project.

    :param project: The name of the project to load the prompt from. Must specify at least one of `project` or `project_id`.
    :param slug: The slug of the prompt to load.
    :param version: An optional version of the prompt (to read). If not specified, the latest version will be used.
    :param project_id: The id of the project to load the prompt from. This takes precedence over `project` if specified.
    :param defaults: (Optional) A dictionary of default values to use when rendering the prompt. Prompt values will override these defaults.
    :param no_trace: If true, do not include logging metadata for this prompt when build() is called.
    :param app_url: The URL of the Braintrust App. Defaults to https://www.braintrustdata.com.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :param project_id: The id of the project to load the prompt from. This takes precedence over `project` if specified.
    :returns: The prompt object.
    """

    if not project and not project_id:
        raise ValueError("Must specify at least one of project or project_id")
    if not slug:
        raise ValueError("Must specify slug")

    def compute_metadata():
        login(org_name=org_name, api_key=api_key, app_url=app_url)
        args = _populate_args(
            {
                "project_name": project,
                "project_id": project_id,
                "slug": slug,
                "version": version,
            },
        )
        response = _state.log_conn().get_json("/v1/prompt", args)
        if "objects" not in response or len(response["objects"]) == 0:
            raise ValueError(f"Prompt {slug} not found in project {project or project_id}.")
        elif len(response["objects"]) > 1:
            raise ValueError(
                f"Multiple prompts found with slug {slug} in project {project or project_id}. This should never happen."
            )
        resp_prompt = response["objects"][0]
        return PromptSchema.from_dict_deep(resp_prompt)

    return Prompt(
        lazy_metadata=LazyValue(compute_metadata, use_mutex=True), defaults=defaults or {}, no_trace=no_trace
    )


login_lock = threading.RLock()


def login(app_url=None, api_key=None, org_name=None, force_login=False):
    """
    Log into Braintrust. This will prompt you for your API token, which you can find at
    https://www.braintrustdata.com/app/token. This method is called automatically by `init()`.

    :param app_url: The URL of the Braintrust App. Defaults to https://www.braintrustdata.com.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :param force_login: Login again, even if you have already logged in (by default, this function will exit quickly if you have already logged in)
    """

    global _state

    # Only permit one thread to login at a time
    with login_lock:
        if not force_login and _state.logged_in:
            # We have already logged in. If any provided login inputs disagree
            # with our existing settings, raise an Exception warning the user to
            # try again with `force_login=True`.
            def check_updated_param(varname, arg, orig):
                if arg is not None and orig is not None and arg != orig:
                    raise Exception(
                        f"Re-logging in with different {varname} ({arg}) than original ({orig}). To force re-login, pass `force_login=True`"
                    )

            check_updated_param("app_url", app_url, _state.app_url)
            check_updated_param(
                "api_key", HTTPConnection.sanitize_token(api_key) if api_key else None, _state.login_token
            )
            check_updated_param("org_name", org_name, _state.org_name)
            return

        if app_url is None:
            app_url = os.environ.get("BRAINTRUST_APP_URL", "https://www.braintrustdata.com")

        app_public_url = os.environ.get("BRAINTRUST_APP_PUBLIC_URL", app_url)

        if api_key is None:
            api_key = os.environ.get("BRAINTRUST_API_KEY")

        if org_name is None:
            org_name = os.environ.get("BRAINTRUST_ORG_NAME")

        _state.reset_login_info()

        _state.app_url = app_url
        _state.app_public_url = app_public_url

        conn = None
        if api_key is not None:
            app_conn = HTTPConnection(_state.app_url, adapter=_http_adapter)
            app_conn.set_token(api_key)
            resp = app_conn.post("api/apikey/login")
            if not resp.ok:
                api_key_prefix = (
                    (" (" + api_key[:2] + "*" * (len(api_key) - 4) + api_key[-2:] + ")") if len(api_key) > 4 else ""
                )
                raise ValueError(f"Invalid API key{api_key_prefix}: [{resp.status_code}] {resp.text}")
            info = resp.json()

            _check_org_info(info["org_info"], org_name)

            conn = _state.log_conn()
            conn.set_token(api_key)

        if not conn:
            raise ValueError(
                "Could not login to Braintrust. You may need to set BRAINTRUST_API_KEY in your environment."
            )

        # make_long_lived() allows the connection to retry if it breaks, which we're okay with after
        # this point because we know the connection _can_ successfully ping.
        conn.make_long_lived()

        # Set the same token in the API
        _state.app_conn().set_token(conn.token)
        _state.login_token = conn.token
        _state.logged_in = True

        # Replace the global logger's log_conn with this one.
        _state.login_replace_log_conn(conn)


def log(**event):
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


def summarize(summarize_scores=True, comparison_experiment_id=None):
    """
    Summarize the current experiment, including the scores (compared to the closest reference experiment) and metadata.

    :param summarize_scores: Whether to summarize the scores. If False, only the metadata will be returned.
    :param comparison_experiment_id: The experiment to compare against. If None, the most recent experiment on the comparison_commit will be used.
    :returns: `ExperimentSummary`
    """
    eprint(
        "braintrust.summarize is deprecated and will be removed in a future version of braintrust. Use `experiment.summarize` instead."
    )
    e = _state.current_experiment.get()
    if not e:
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

    return _state.current_logger


def current_span() -> Span:
    """Return the currently-active span for logging (set by running a span under a context manager). If there is no active span, returns a no-op span object, which supports the same interface as spans but does no logging.

    See `Span` for full details.
    """

    return _state.current_span.get()


def get_span_parent_object() -> Union["Logger", "Experiment", Span]:
    """Mainly for internal use. Return the parent object for starting a span in a global context."""

    parent_span = current_span()
    if parent_span != NOOP_SPAN:
        return parent_span

    experiment = current_experiment()
    if experiment:
        return experiment

    logger = current_logger()
    if logger:
        return logger

    return NOOP_SPAN


def _try_log_input(span, f_sig, f_args, f_kwargs):
    bound_args = f_sig.bind(*f_args, **f_kwargs).arguments
    input_serializable = bound_args
    try:
        _check_json_serializable(bound_args)
    except Exception as e:
        input_serializable = "<input not json-serializable>: " + str(e)
    span.log(input=input_serializable)


def _try_log_output(span, output):
    output_serializable = output
    try:
        _check_json_serializable(output)
    except Exception as e:
        output_serializable = "<output not json-serializable>: " + str(e)
    span.log(output=output_serializable)


def traced(*span_args, **span_kwargs):
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

    def decorator(span_args, span_kwargs, f):
        # We assume 'name' is the first positional argument in `start_span`.
        if len(span_args) == 0 and span_kwargs.get("name") is None:
            span_args += (f.__name__,)

        f_sig = inspect.signature(f)

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

        if inspect.iscoroutinefunction(f):
            return wrapper_async
        else:
            return wrapper_sync

    # We determine if the decorator is invoked bare or with arguments by
    # checking if the first positional argument to the decorator is a callable.
    if len(span_args) == 1 and len(span_kwargs) == 0 and callable(span_args[0]):
        return decorator(span_args[1:], span_kwargs, span_args[0])
    else:
        return partial(decorator, span_args, span_kwargs)


def start_span(
    name=None,
    type: SpanTypeAttribute = None,
    span_attributes=None,
    start_time=None,
    set_current=None,
    parent=None,
    **event,
) -> Span:
    """Lower-level alternative to `@traced` for starting a span at the toplevel. It creates a span under the first active object (using the same precedence order as `@traced`), or if `parent` is specified, under the specified parent row, or returns a no-op span object.

    We recommend running spans bound to a context manager (`with start_span`) to automatically mark them as current and ensure they are terminated. If you wish to start a span outside a context manager, be sure to terminate it with `span.end()`.

    See `Span.start_span` for full details.
    """

    if parent:
        components = SpanComponents.from_str(parent)
        if components.row_ids:
            parent_span_ids = ParentSpanIds(
                span_id=components.row_ids.span_id, root_span_id=components.row_ids.root_span_id
            )
        else:
            parent_span_ids = None
        return SpanImpl(
            parent_object_type=components.object_type,
            parent_object_id=LazyValue(lambda: components.object_id, use_mutex=False),
            parent_span_ids=parent_span_ids,
            name=name,
            type=type,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            event=event,
        )
    else:
        return get_span_parent_object().start_span(
            name=name,
            type=type,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            parent=parent,
            **event,
        )


def flush():
    """Flush any pending rows to the server."""

    _state.global_bg_logger().flush()


def _check_org_info(org_info, org_name):
    global _state

    if len(org_info) == 0:
        raise ValueError("This user is not part of any organizations.")

    for orgs in org_info:
        if org_name is None or orgs["name"] == org_name:
            _state.org_id = orgs["id"]
            _state.org_name = orgs["name"]
            _state.log_url = os.environ.get("BRAINTRUST_API_URL", orgs["api_url"])
            _state.git_metadata_settings = GitMetadataSettings(**(orgs.get("git_metadata") or {}))
            break

    if _state.org_id is None:
        raise ValueError(
            f"Organization {org_name} not found. Must be one of {', '.join([x['name'] for x in org_info])}"
        )


def _urljoin(*parts):
    return "/".join([x.lstrip("/") for x in parts])


def _populate_args(d, **kwargs):
    for k, v in kwargs.items():
        if v is not None:
            d[k] = v

    return d


def validate_tags(tags):
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


def _validate_and_sanitize_experiment_log_partial_args(event):
    # Make sure only certain keys are specified.
    forbidden_keys = set(event.keys()) - {
        "input",
        "output",
        "expected",
        "tags",
        "scores",
        "metadata",
        "metrics",
        "dataset_record_id",
        "inputs",
    }
    if forbidden_keys:
        raise ValueError(f"The following keys may are not permitted: {forbidden_keys}")

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
def _validate_and_sanitize_experiment_log_full_args(event, has_dataset):
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

    if has_dataset and event.get("dataset_record_id") is None:
        raise ValueError("dataset_record_id must be specified when using a dataset")
    elif not has_dataset and event.get("dataset_record_id") is not None:
        raise ValueError("dataset_record_id cannot be specified when not using a dataset")

    return event


class ObjectIterator:
    def __init__(self, refetch_fn):
        self.refetch_fn = refetch_fn
        self.idx = 0

    def __iter__(self):
        return self

    def __next__(self):
        data = self.refetch_fn()
        if self.idx >= len(data):
            raise StopIteration
        value = data[self.idx]
        self.idx += 1

        return value


class ObjectFetcher:
    def __init__(self, object_type, pinned_version=None, mutate_record=None):
        self.object_type = object_type

        if pinned_version is not None:
            try:
                pv = int(pinned_version)
                assert pv >= 0
            except (ValueError, AssertionError):
                raise ValueError(f"version ({pinned_version}) must be a positive integer")

        self._pinned_version = str(pinned_version) if pinned_version is not None else None
        self._mutate_record = mutate_record

        self._fetched_data = None

    def fetch(self):
        """
        Fetch all records.

        ```python
        for record in object.fetch():
            print(record)

        # You can also iterate over the object directly.
        for record in object:
            print(record)

        :returns: An iterator over the records.
        """
        return ObjectIterator(self._refetch)

    def __iter__(self):
        return self.fetch()

    @property
    def fetched_data(self):
        eprint(
            ".fetched_data is deprecated and will be removed in a future version of braintrust. Use .fetch() or the iterator instead"
        )
        return self._refetch()

    def _refetch(self):
        state = self._get_state()
        if self._fetched_data is None:
            resp = state.log_conn().get(
                f"v1/{self.object_type}/{self.id}/fetch",
                params={
                    "version": self._pinned_version,
                },
                headers={
                    "Accept-Encoding": "gzip",
                },
            )
            response_raise_for_status(resp)
            data = resp.json()["events"]

            if self._mutate_record is not None:
                self._fetched_data = [self._mutate_record(r) for r in data]
            else:
                self._fetched_data = data

        return self._fetched_data

    def _clear_cache(self):
        self._fetched_data = None

    @property
    def version(self):
        if self._pinned_version is not None:
            return self._pinned_version
        else:
            return max([str(record.get(TRANSACTION_ID_FIELD, "0")) for record in self._refetch()] or ["0"])


def _log_feedback_impl(
    parent_object_type: SpanObjectType,
    parent_object_id: LazyValue[str],
    id,
    scores=None,
    expected=None,
    tags=None,
    comment=None,
    metadata=None,
    source=None,
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

    parent_ids = lambda: SpanComponents(
        object_type=parent_object_type,
        object_id=parent_object_id.get(),
    ).object_id_fields()

    if len(update_event) > 0:

        def compute_record():
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

        _state.global_bg_logger().log(LazyValue(compute_record, use_mutex=False))

    if comment is not None:

        def compute_record():
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

        _state.global_bg_logger().log(LazyValue(compute_record, use_mutex=False))


@dataclasses.dataclass
class ParentSpanIds:
    span_id: str
    root_span_id: str


def _start_span_parent_args(
    parent: Optional[str],
    parent_object_type: SpanObjectType,
    parent_object_id: LazyValue[str],
    parent_span_ids: Optional[ParentSpanIds],
):
    if parent:
        assert parent_span_ids is None, "Cannot specify both parent and parent_span_ids"
        parent_components = SpanComponents.from_str(parent)
        assert (
            parent_object_type == parent_components.object_type
        ), f"Mismatch between expected span parent object type {parent_object_type} and provided type {parent_components.object_type}"

        def compute_parent_object_id():
            assert (
                parent_object_id.get() == parent_components.object_id
            ), f"Mismatch between expected span parent object id {parent_object_id.get()} and provided id {parent_components.object_id}"
            return parent_object_id.get()

        arg_parent_object_id = LazyValue(compute_parent_object_id, use_mutex=False)
        if parent_components.row_ids:
            arg_parent_span_ids = ParentSpanIds(
                span_id=parent_components.row_ids.span_id, root_span_id=parent_components.row_ids.root_span_id
            )
        else:
            arg_parent_span_ids = None
    else:
        arg_parent_object_id = parent_object_id
        arg_parent_span_ids = parent_span_ids

    return dict(
        parent_object_type=parent_object_type,
        parent_object_id=arg_parent_object_id,
        parent_span_ids=arg_parent_span_ids,
    )


@dataclasses.dataclass
class ExperimentIdentifier:
    id: str
    name: str


class ExperimentDatasetIterator:
    def __init__(self, iterator):
        self.iterator = iterator

    def __iter__(self):
        return self

    def __next__(self):
        while True:
            value = next(self.iterator)
            if value["root_span_id"] != value["span_id"]:
                continue

            output, expected = value.get("output"), value.get("expected")
            return {
                "input": value.get("input"),
                "expected": expected if expected is not None else output,
                "tags": value.get("tags"),
                # NOTE: We'll eventually want to track origin information here (and generalize
                # the `dataset_record_id` field)
            }


class Experiment(ObjectFetcher):
    """
    An experiment is a collection of logged events, such as model inputs and outputs, which represent
    a snapshot of your application at a particular point in time. An experiment is meant to capture more
    than just the model you use, and includes the data you use to test, pre- and post- processing code,
    comparison metrics (scores), and any other metadata you want to include.

    Experiments are associated with a project, and two experiments are meant to be easily comparable via
    their `inputs`. You can change the attributes of the experiments in a project (e.g. scoring functions)
    over time, simply by changing what you log.

    You should not create `Experiment` objects directly. Instead, use the `braintrust.init()` method.
    """

    def __init__(
        self,
        lazy_metadata: LazyValue[ProjectExperimentMetadata],
        dataset: "Dataset" = None,
    ):
        self._lazy_metadata = lazy_metadata
        self.dataset = dataset
        self.last_start_time = time.time()
        self._lazy_id = LazyValue(lambda: self.id, use_mutex=False)
        self._called_start_span = False

        ObjectFetcher.__init__(self, object_type="experiment", pinned_version=None)

    @property
    def id(self):
        return self._lazy_metadata.get().experiment.id

    @property
    def name(self):
        return self._lazy_metadata.get().experiment.name

    @property
    def data(self):
        return self._lazy_metadata.get().experiment.full_info

    @property
    def project(self):
        return self._lazy_metadata.get().project

    @staticmethod
    def _parent_object_type():
        return SpanObjectType.EXPERIMENT

    # Capture all metadata attributes which aren't covered by existing methods.
    def __getattr__(self, name: str) -> Any:
        return self._lazy_metadata.get().experiment.full_info[name]

    def _get_state(self) -> BraintrustState:
        # Ensure the login state is populated by fetching the lazy_metadata.
        self._lazy_metadata.get()
        return _state

    def log(
        self,
        input=None,
        output=None,
        expected=None,
        tags=None,
        scores=None,
        metadata=None,
        metrics=None,
        id=None,
        dataset_record_id=None,
        inputs=None,
        allow_concurrent_with_spans=False,
    ):
        """
        Log a single event to the experiment. The event will be batched and uploaded behind the scenes.

        :param input: The arguments that uniquely define a test case (an arbitrary, JSON serializable object). Later on, Braintrust will use the `input` to know whether two test cases are the same between experiments, so they should not contain experiment-specific state. A simple rule of thumb is that if you run the same experiment twice, the `input` should be identical.
        :param output: The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
        :param expected: (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate your experiments while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
        :param scores: A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare experiments.
        :param metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
        :param tags: (Optional) a list of strings that you can use to filter and group records later.
        :param metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically: "start", "end".
        :param id: (Optional) a unique identifier for the event. If you don't provide one, BrainTrust will generate one for you.
        :param dataset_record_id: (Optional) the id of the dataset record that this event is associated with. This field is required if and only if the experiment is associated with a dataset.
        :param inputs: (Deprecated) the same as `input` (will be removed in a future version).
        :param allow_concurrent_with_spans: (Optional) in rare cases where you need to log at the top level separately from using spans on the experiment elsewhere, set this to True.
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
                tags=tags,
                scores=scores,
                metadata=metadata,
                metrics=metrics,
                id=id,
                dataset_record_id=dataset_record_id,
                inputs=inputs,
            ),
            self.dataset is not None,
        )
        span = self._start_span_impl(start_time=self.last_start_time, **event)
        self.last_start_time = span.end()
        return span.id

    def log_feedback(
        self,
        id,
        scores=None,
        expected=None,
        tags=None,
        comment=None,
        metadata=None,
        source=None,
    ):
        """
        Log feedback to an event in the experiment. Feedback is used to save feedback scores, set an expected value, or add a comment.

        :param id: The id of the event to log feedback for. This is the `id` returned by `log` or accessible as the `id` field of a span.
        :param scores: (Optional) a dictionary of numeric values (between 0 and 1) to log. These scores will be merged into the existing scores for the event.
        :param expected: (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not.
        :param tags: (Optional) a list of strings that you can use to filter and group records later.
        :param comment: (Optional) an optional comment string to log about the event.
        :param metadata: (Optional) a dictionary with additional data about the feedback. If you have a `user_id`, you can log it here and access it in the Braintrust UI.
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
        name=None,
        type=None,
        span_attributes=None,
        start_time=None,
        set_current=None,
        parent=None,
        **event,
    ):
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
            **event,
        )

    def fetch_base_experiment(self):
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

    def summarize(self, summarize_scores=True, comparison_experiment_id=None):
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

            if comparison_experiment_id is not None:
                summary_items = state.log_conn().get_json(
                    "experiment-comparison2",
                    args={
                        "experiment_id": self.id,
                        "base_experiment_id": comparison_experiment_id,
                    },
                    retries=3,
                )
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
            experiment_name=self.name,
            project_url=project_url,
            experiment_url=experiment_url,
            comparison_experiment_name=comparison_experiment_name,
            scores=score_summary,
            metrics=metric_summary,
        )

    def export(self) -> str:
        """Return a serialized representation of the experiment that can be used to start subspans in other places. See `Span.start_span` for more details."""
        return SpanComponents(object_type=self._parent_object_type(), object_id=self.id).to_str()

    def close(self):
        """This function is deprecated. You can simply remove it from your code."""

        eprint(
            "close is deprecated and will be removed in a future version of braintrust. It is now a no-op and can be removed"
        )
        return self.id

    def flush(self):
        """Flush any pending rows to the server."""

        _state.global_bg_logger().flush()

    def _start_span_impl(
        self,
        name=None,
        type=None,
        span_attributes=None,
        start_time=None,
        set_current=None,
        parent=None,
        **event,
    ):
        return SpanImpl(
            **_start_span_parent_args(
                parent=parent,
                parent_object_type=self._parent_object_type(),
                parent_object_id=self._lazy_id,
                parent_span_ids=None,
            ),
            name=name,
            type=type,
            default_root_type=SpanTypeAttribute.EVAL,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            event=event,
        )

    def __enter__(self):
        return self

    def __exit__(self, type, value, callback):
        del type, value, callback


class ReadonlyExperiment(ObjectFetcher):
    """
    A read-only view of an experiment, initialized by passing `open=True` to `init()`.
    """

    def __init__(
        self,
        lazy_metadata: LazyValue[ProjectExperimentMetadata],
    ):
        self._lazy_metadata = lazy_metadata

        ObjectFetcher.__init__(self, object_type="experiment", pinned_version=None)

    @property
    def id(self):
        return self._lazy_metadata.get().experiment.id

    def _get_state(self):
        # Ensure the login state is populated by fetching the lazy_metadata.
        self._lazy_metadata.get()
        return _state

    def as_dataset(self):
        return ExperimentDatasetIterator(self.fetch())


_EXEC_COUNTER_LOCK = threading.Lock()
_EXEC_COUNTER = 0


class SpanImpl(Span):
    """Primary implementation of the `Span` interface. See the `Span` interface for full details on each method.

    We suggest using one of the various `start_span` methods, instead of creating Spans directly. See `Span.start_span` for full details.
    """

    def __init__(
        self,
        parent_object_type: SpanObjectType,
        parent_object_id: LazyValue[str],
        parent_span_ids: Optional[ParentSpanIds],
        name=None,
        type=None,
        default_root_type=None,
        span_attributes=None,
        start_time=None,
        set_current=None,
        event=None,
    ):
        if span_attributes is None:
            span_attributes = {}
        if event is None:
            event = {}
        if type is None and not parent_span_ids:
            type = default_root_type

        self.set_current = coalesce(set_current, True)
        self._logged_end_time = None

        self.parent_object_type = parent_object_type
        self.parent_object_id = parent_object_id

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

        self.internal_data = dict(
            metrics=dict(
                start=start_time or time.time(),
            ),
            # Set type first, in case they override it in `span_attributes`.
            span_attributes=dict(**{"type": type, "name": name, **span_attributes}, exec_counter=exec_counter),
            created=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )
        if caller_location:
            self.internal_data["context"] = caller_location

        self._id = event.get("id")
        if self._id is None:
            self._id = str(uuid.uuid4())
        self.span_id = str(uuid.uuid4())
        if parent_span_ids:
            self.root_span_id = parent_span_ids.root_span_id
            self.span_parents = [parent_span_ids.span_id]
        else:
            self.root_span_id = self.span_id
            self.span_parents = None

        # The first log is a replacement, but subsequent logs to the same span
        # object will be merges.
        self._is_merge = False
        self.log(**{k: v for k, v in event.items() if k != "id"})
        self._is_merge = True

    @property
    def id(self):
        return self._id

    def log(self, **event):
        # There should be no overlap between the dictionaries being merged,
        # except for `sanitized` and `internal_data`, where the former overrides
        # the latter.
        sanitized = _validate_and_sanitize_experiment_log_partial_args(event)
        sanitized_and_internal_data = _strip_nones(self.internal_data, deep=True)
        merge_dicts(sanitized_and_internal_data, _strip_nones(sanitized, deep=False))
        self.internal_data = {}

        # We both check for serializability and round-trip `partial_record`
        # through JSON in order to create a "deep copy". This has the benefit of
        # cutting out any reference to user objects when the object is logged
        # asynchronously, so that in case the objects are modified, the logging
        # is unaffected.
        partial_record = dict(
            id=self.id,
            span_id=self.span_id,
            root_span_id=self.root_span_id,
            span_parents=self.span_parents,
            **sanitized_and_internal_data,
            **{IS_MERGE_FIELD: self._is_merge},
        )
        serialized_partial_record = _check_json_serializable(partial_record)
        partial_record = json.loads(serialized_partial_record)
        if "metrics" in partial_record and "end" in partial_record["metrics"]:
            self._logged_end_time = partial_record["metrics"]["end"]

        if len(partial_record.get("tags", [])) > 0 and self.span_parents:
            raise Exception("Tags can only be logged to the root span")

        def compute_record():
            return dict(
                **partial_record,
                **SpanComponents(
                    object_type=self.parent_object_type,
                    object_id=self.parent_object_id.get(),
                ).object_id_fields(),
            )

        _state.global_bg_logger().log(LazyValue(compute_record, use_mutex=False))

    def log_feedback(self, **event):
        return _log_feedback_impl(
            parent_object_type=self.parent_object_type,
            parent_object_id=self.parent_object_id,
            id=self.id,
            **event,
        )

    def start_span(
        self,
        name=None,
        type=None,
        span_attributes=None,
        start_time=None,
        set_current=None,
        parent=None,
        **event,
    ):
        if parent:
            parent_span_ids = None
        else:
            parent_span_ids = ParentSpanIds(span_id=self.span_id, root_span_id=self.root_span_id)
        return SpanImpl(
            **_start_span_parent_args(
                parent=parent,
                parent_object_type=self.parent_object_type,
                parent_object_id=self.parent_object_id,
                parent_span_ids=parent_span_ids,
            ),
            name=name,
            type=type,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            event=event,
        )

    def end(self, end_time=None):
        if not self._logged_end_time:
            end_time = end_time or time.time()
            self.internal_data = dict(metrics=dict(end=end_time))
        else:
            end_time = self._logged_end_time
        self.log()
        return end_time

    def export(self) -> str:
        return SpanComponents(
            object_type=self.parent_object_type,
            object_id=self.parent_object_id.get(),
            row_ids=SpanRowIds(row_id=self.id, span_id=self.span_id, root_span_id=self.root_span_id),
        ).to_str()

    def close(self, end_time=None):
        return self.end(end_time)

    def flush(self):
        """Flush any pending rows to the server."""

        _state.global_bg_logger().flush()

    def __enter__(self):
        if self.set_current:
            self._context_token = _state.current_span.set(self)
        return self

    def __exit__(self, type, value, callback):
        del type, value, callback

        if self.set_current:
            _state.current_span.reset(self._context_token)

        self.end()


def _strip_nones(d, deep: bool):
    if not isinstance(d, dict):
        return d
    return {k: (_strip_nones(v, deep) if deep else v) for (k, v) in d.items() if v is not None}


class Dataset(ObjectFetcher):
    """
    A dataset is a collection of records, such as model inputs and outputs, which represent
    data you can use to evaluate and fine-tune models. You can log production data to datasets,
    curate them with interesting examples, edit/delete records, and run evaluations against them.

    You should not create `Dataset` objects directly. Instead, use the `braintrust.init_dataset()` method.
    """

    def __init__(
        self,
        lazy_metadata: LazyValue[ProjectDatasetMetadata],
        version: Union[None, int, str] = None,
        legacy: bool = DEFAULT_IS_LEGACY_DATASET,
    ):
        if legacy:
            eprint(
                f"""Records will be fetched from this dataset in the legacy format, with the "expected" field renamed to "output". Please update your code to use "expected", and use `braintrust.init_dataset()` with `use_output=False`, which will become the default in a future version of Braintrust."""
            )
        mutate_record = lambda r: ensure_dataset_record(r, legacy)

        self._lazy_metadata = lazy_metadata
        self.new_records = 0

        ObjectFetcher.__init__(self, object_type="dataset", pinned_version=version, mutate_record=mutate_record)

    @property
    def id(self):
        return self._lazy_metadata.get().dataset.id

    @property
    def name(self):
        return self._lazy_metadata.get().dataset.name

    @property
    def data(self):
        return self._lazy_metadata.get().experiment.full_info

    @property
    def project(self):
        return self._lazy_metadata.get().project

    # Capture all metadata attributes which aren't covered by existing methods.
    def __getattr__(self, name: str) -> Any:
        return self._lazy_metadata.get().dataset.full_info[name]

    def _get_state(self) -> BraintrustState:
        # Ensure the login state is populated by fetching the lazy_metadata.
        self._lazy_metadata.get()
        return _state

    def insert(self, input, expected=None, tags=None, metadata=None, id=None, output=None):
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
        if metadata:
            if not isinstance(metadata, dict):
                raise ValueError("metadata must be a dictionary")
            for key in metadata.keys():
                if not isinstance(key, str):
                    raise ValueError("metadata keys must be strings")

        if expected is not None and output is not None:
            raise ValueError("Only one of expected or output (deprecated) can be specified. Prefer expected.")

        row_id = id or str(uuid.uuid4())
        # Validate the non-lazily-computed part of the record-to-log.
        partial_args = _populate_args(
            {
                "id": row_id,
                "inputs": input,
                "expected": expected if expected is not None else output,
                "tags": tags,
                "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
            metadata=metadata,
        )
        _check_json_serializable(partial_args)

        def compute_args():
            return dict(
                **partial_args,
                dataset_id=self.id,
            )

        self._clear_cache()  # We may be able to optimize this
        self.new_records += 1
        _state.global_bg_logger().log(LazyValue(compute_args, use_mutex=False))
        return row_id

    def delete(self, id):
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
        _check_json_serializable(partial_args)

        def compute_args():
            return dict(
                **partial_args,
                dataset_id=self.id,
            )

        _state.global_bg_logger().log(LazyValue(compute_args, use_mutex=False))
        return id

    def summarize(self, summarize_data=True):
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
            data_summary_d = state.log_conn().get_json(
                "dataset-summary",
                args={
                    "dataset_id": self.id,
                },
                retries=3,
            )
            data_summary = DataSummary(new_records=self.new_records, **data_summary_d)

        return DatasetSummary(
            project_name=self.project.name,
            dataset_name=self.name,
            project_url=project_url,
            dataset_url=dataset_url,
            data_summary=data_summary,
        )

    def close(self):
        """This function is deprecated. You can simply remove it from your code."""

        eprint(
            "close is deprecated and will be removed in a future version of braintrust. It is now a no-op and can be removed"
        )
        return self.id

    def flush(self):
        """Flush any pending rows to the server."""

        _state.global_bg_logger().flush()

    def __enter__(self):
        return self

    def __exit__(self, type, value, callback):
        del type, value, callback


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
        defaults: Dict[str, Any],
        no_trace: bool,
    ):
        self._lazy_metadata = lazy_metadata
        self.defaults = defaults
        self.no_trace = no_trace

    @property
    def id(self):
        return self._lazy_metadata.get().id

    @property
    def name(self):
        return self._lazy_metadata.get().name

    @property
    def slug(self):
        return self._lazy_metadata.get().slug

    @property
    def prompt(self):
        return self._lazy_metadata.get().prompt_data.prompt

    @property
    def version(self):
        return self._lazy_metadata.get()._xact_id

    @property
    def options(self):
        return self._lazy_metadata.get().prompt_data.options or {}

    # Capture all metadata attributes which aren't covered by existing methods.
    def __getattr__(self, name: str) -> Any:
        return getattr(self._lazy_metadata.get(), name)

    def build(self, **build_args):
        """
        Build the prompt with the given formatting options. The args you pass in will
        be forwarded to the mustache template that defines the prompt and rendered with
        the `chevron` library.

        :returns: A dictionary that includes the rendered prompt and arguments, that can be passed as kwargs to the OpenAI client.
        """

        ret = {
            **self.defaults,
            **{k: v for (k, v) in self.options.get("params", {}).items() if k not in BRAINTRUST_PARAMS},
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
        elif self.prompt.type == "completion":
            ret["prompt"] = chevron.render(self.prompt.content, data=build_args)
        elif self.prompt.type == "chat":
            ret["messages"] = [
                {
                    **{k: v for (k, v) in m.as_dict().items() if v is not None},
                    "content": chevron.render(m.content, data=build_args)
                    if isinstance(m.content, str)
                    else json.loads(chevron.render(json.dumps(m.content), data=build_args)),
                }
                for m in self.prompt.messages
            ]
            ret["tools"] = (
                json.loads(chevron.render(self.prompt.tools, data=build_args))
                if self.prompt.tools is not None
                else None
            )

        return ret

    def __iter__(self):
        meta_keys = list(self.options.keys())
        if self.prompt.type == "completion":
            meta_keys.append("prompt")
        else:
            meta_keys.append("chat", "tools")

        return meta_keys

    def __len__(self):
        return len(self.__iter__())

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
    def __init__(self, name=None, id=None):
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
    def id(self):
        self.lazy_init()
        return self._id

    @property
    def name(self):
        self.lazy_init()
        return self._name


class Logger:
    def __init__(self, lazy_metadata: LazyValue[OrgProjectMetadata], async_flush: bool = True):
        self._lazy_metadata = lazy_metadata
        self.async_flush = async_flush
        self.last_start_time = time.time()
        self._lazy_id = LazyValue(lambda: self.id, use_mutex=False)
        self._called_start_span = False

    @property
    def org_id(self):
        return self._lazy_metadata.get().org_id

    @property
    def project(self):
        return self._lazy_metadata.get().project

    @property
    def id(self):
        return self.project.id

    @staticmethod
    def _parent_object_type():
        return SpanObjectType.PROJECT_LOGS

    def _get_state(self) -> BraintrustState:
        # Ensure the login state is populated by fetching the lazy_metadata.
        self._lazy_metadata.get()
        return _state

    def log(
        self,
        input=None,
        output=None,
        expected=None,
        tags=None,
        scores=None,
        metadata=None,
        metrics=None,
        id=None,
        allow_concurrent_with_spans=False,
    ):
        """
        Log a single event. The event will be batched and uploaded behind the scenes.

        :param input: (Optional) the arguments that uniquely define a user input(an arbitrary, JSON serializable object).
        :param output: (Optional) the output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
        :param expected: (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
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
            input=input,
            output=output,
            expected=expected,
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
        id,
        scores=None,
        expected=None,
        tags=None,
        comment=None,
        metadata=None,
        source=None,
    ):
        """
        Log feedback to an event. Feedback is used to save feedback scores, set an expected value, or add a comment.

        :param id: The id of the event to log feedback for. This is the `id` returned by `log` or accessible as the `id` field of a span.
        :param scores: (Optional) a dictionary of numeric values (between 0 and 1) to log. These scores will be merged into the existing scores for the event.
        :param expected: (Optional) the ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not.
        :param tags: (Optional) a list of strings that you can use to filter and group records later.
        :param comment: (Optional) an optional comment string to log about the event.
        :param metadata: (Optional) a dictionary with additional data about the feedback. If you have a `user_id`, you can log it here and access it in the Braintrust UI.
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
        name=None,
        type=None,
        span_attributes=None,
        start_time=None,
        set_current=None,
        parent=None,
        **event,
    ):
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
            **event,
        )

    def _start_span_impl(
        self,
        name=None,
        type=None,
        span_attributes=None,
        start_time=None,
        set_current=None,
        parent=None,
        **event,
    ):
        return SpanImpl(
            **_start_span_parent_args(
                parent=parent,
                parent_object_type=self._parent_object_type(),
                parent_object_id=self._lazy_id,
                parent_span_ids=None,
            ),
            name=name,
            type=type,
            default_root_type=SpanTypeAttribute.TASK,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            event=event,
        )

    def export(self) -> str:
        """Return a serialized representation of the logger that can be used to start subspans in other places. See `Span.start_span` for more details."""
        return SpanComponents(object_type=self._parent_object_type(), object_id=self.id).to_str()

    def __enter__(self):
        return self

    def __exit__(self, type, value, callback):
        del type, value, callback

    def flush(self):
        """
        Flush any pending logs to the server.
        """
        _state.global_bg_logger().flush()


@dataclasses.dataclass
class ScoreSummary(SerializableDataClass):
    """Summary of a score's performance."""

    name: str
    """Name of the score."""
    score: float
    """Average score across all examples."""
    diff: Optional[float]
    """Difference in score between the current and reference experiment."""
    improvements: Optional[int]
    """Number of improvements in the score."""
    regressions: Optional[int]
    """Number of regressions in the score."""

    # Used to help with formatting
    _longest_score_name: int

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
    metric: float
    """Average metric across all examples."""
    unit: str
    """Unit label for the metric."""
    diff: float
    """Difference in metric between the current and reference experiment."""
    improvements: int
    """Number of improvements in the metric."""
    regressions: int
    """Number of regressions in the metric."""

    # Used to help with formatting
    _longest_metric_name: int

    def __str__(self):
        # format with 2 decimal points
        metric = f"{self.metric:.2f}"
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
    experiment_name: str
    """Name of the experiment."""
    project_url: Optional[str]
    """URL to the project's page in the Braintrust app."""
    experiment_url: Optional[str]
    """URL to the experiment's page in the Braintrust app."""
    comparison_experiment_name: Optional[str]
    """The experiment scores are baselined against."""
    scores: Dict[str, ScoreSummary]
    """Summary of the experiment's scores."""
    metrics: Dict[str, MetricSummary]
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
    data_summary: int
    """Summary of the dataset's data."""

    def __str__(self):
        return textwrap.dedent(
            f"""\

             =========================SUMMARY=========================
             {str(self.data_summary)}
             See results for all datasets in {self.project_name} at {self.project_url}
             See results for {self.dataset_name} at {self.dataset_url}"""
        )
