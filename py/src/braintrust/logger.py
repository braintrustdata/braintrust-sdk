import atexit
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
from getpass import getpass
from typing import Any, Dict, Optional, Union

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .cache import CACHE_PATH, EXPERIMENTS_PATH, LOGIN_INFO_PATH
from .gitutil import get_past_n_ancestors, get_repo_status
from .resource_manager import ResourceManager
from .util import SerializableDataClass, encode_uri_component, get_caller_location, response_raise_for_status


class Span(ABC):
    """
    A Span encapsulates logged data and metrics for a unit of work. This interface is shared by all span implementations.

    We suggest using one of the various `startSpan` methods, instead of creating Spans directly. See `Span.startSpan` for full details.
    """

    @property
    @abstractmethod
    def id(self) -> str:
        """Row ID of the span."""

    @property
    @abstractmethod
    def span_id(self) -> str:
        """Span ID of the span. This is used to link spans together."""

    @property
    @abstractmethod
    def root_span_id(self) -> str:
        """Span ID of the root span in the full trace."""

    @abstractmethod
    def log(self, **event):
        """Incrementally update the current span with new data. The event will be batched and uploaded behind the scenes.

        :param **event: Data to be logged. See `Experiment.log` for full details.
        """

    @abstractmethod
    def start_span(self, name, span_attributes={}, start_time=None, set_current=None, **event):
        """Create a new span. This is useful if you want to log more detailed trace information beyond the scope of a single log event. Data logged over several calls to `Span.log` will be merged into one logical row.

        We recommend running spans within context managers (`with start_span(...) as span`) to automatically mark them as current and ensure they are terminated. If you wish to start a span outside a callback, be sure to terminate it with `span.end()`.

        :param name: The name of the span.
        :param span_attributes: Optional additional attributes to attach to the span, such as a type name.
        :param start_time: Optional start time of the span, as a timestamp in seconds.
        :param set_current: If true (the default), the span will be marked as the currently-active span for the duration of the context manager. Unless the span is bound to a context manager, it will not be marked as current. Equivalent to calling `with braintrust.with_current(span)`.
        :param **event: Data to be logged. See `Experiment.log` for full details.
        :returns: The newly-created `Span`
        """

    @abstractmethod
    def end(self, end_time=None) -> float:
        """Terminate the span. Returns the end time logged to the row's metrics. After calling end, you may not invoke any further methods on the span object, except for the property accessors.

        Will be invoked automatically if the span is bound to a context manager.

        :param end_time: Optional end time of the span, as a timestamp in seconds.
        :returns: The end time logged to the span metrics.
        """

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

    @property
    def span_id(self):
        return ""

    @property
    def root_span_id(self):
        return ""

    def log(self, **event):
        pass

    def start_span(self, name, span_attributes={}, start_time=None, set_current=None, **event):
        return self

    def end(self, end_time=None):
        return end_time or time.time()

    def close(self, end_time=None):
        return end(end_time)

    def __enter__(self):
        return self

    def __exit__(self, type, value, callback):
        del type, value, callback


NOOP_SPAN = _NoopSpan()


class BraintrustState:
    def __init__(self):
        self.id = str(uuid.uuid4())
        self.current_experiment = contextvars.ContextVar("braintrust_current_experiment", default=None)
        self.current_span = contextvars.ContextVar("braintrust_current_span", default=NOOP_SPAN)

        self.api_url = None
        self.login_token = None
        self.org_id = None
        self.org_name = None
        self.log_url = None
        self.logged_in = False

        self._api_conn = None
        self._log_conn = None
        self._user_info = None

    def api_conn(self):
        if not self._api_conn:
            if not self.api_url:
                raise RuntimeError("Must initialize api_url before requesting api_conn")
            self._api_conn = HTTPConnection(self.api_url)
        return self._api_conn

    def log_conn(self):
        if not self._log_conn:
            if not self.log_url:
                raise RuntimeError("Must initialize log_url before requesting log_conn")
            self._log_conn = HTTPConnection(self.log_url)
        return self._log_conn

    def user_info(self):
        if not self._user_info:
            self._user_info = self.log_conn().get_json("ping")
        return self._user_info

    def set_user_info_if_null(self, info):
        if not self._user_info:
            self._user_info = info


_state = BraintrustState()
_logger = logging.getLogger("braintrust")


class _UnterminatedObjectsHandler:
    """A utility to keep track of objects that should be cleaned up before program exit. At the end of the program, the _UnterminatedObjectsHandler will print out all un-terminated objects as a warning."""

    def __init__(self):
        self._unterminated_objects = ResourceManager({})
        atexit.register(self._warn_unterminated)

    def add_unterminated(self, obj, created_location=None):
        with self._unterminated_objects.get() as unterminated_objects:
            unterminated_objects[obj] = created_location

    def remove_unterminated(self, obj):
        with self._unterminated_objects.get() as unterminated_objects:
            del unterminated_objects[obj]

    def _warn_unterminated(self):
        with self._unterminated_objects.get() as unterminated_objects:
            if not unterminated_objects:
                return
            warning_message = "WARNING: Did not close the following braintrust objects. We recommend running `.close` on the listed objects, or binding them to a context manager so they are closed automatically:"
            for obj, created_location in unterminated_objects.items():
                msg = f"\n\tObject of type {type(obj)}"
                if created_location:
                    msg += f" created at {created_location}"
                warning_message += msg
            print(warning_message, file=sys.stderr)


_unterminated_objects = _UnterminatedObjectsHandler()

TRANSACTION_ID_FIELD = "_xact_id"


class HTTPConnection:
    def __init__(self, base_url):
        self.base_url = base_url
        self.token = None

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

    def _reset(self, **retry_kwargs):
        self.session = requests.Session()

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


def log_conn():
    return _state.log_conn()


def api_conn():
    return _state.api_conn()


def user_info():
    return _state.user_info()


def org_id():
    return _state.org_id


class ModelWrapper:
    def __init__(self, data):
        self.data = data

    def __getattr__(self, name: str) -> Any:
        return self.data[name]


# 6 MB (from our own testing).
MAX_REQUEST_SIZE = 6 * 1024 * 1024


def construct_json_array(items):
    return "[" + ",".join(items) + "]"


DEFAULT_BATCH_SIZE = 100
NUM_RETRIES = 3


class _LogThread:
    def __init__(self, name=None):
        self.flush_lock = threading.RLock()
        self.thread = threading.Thread(target=self._publisher, daemon=True)
        self.queue_filled_event = threading.Event()
        self.started = False

        log_namespace = "braintrust"
        if name:
            log_namespace += f" [{name}]"

        self.logger = logging.getLogger(log_namespace)

        try:
            queue_size = int(os.environ.get("BRAINTRUST_QUEUE_SIZE"))
        except Exception:
            queue_size = 1000
        self.queue = queue.Queue(maxsize=queue_size)

        atexit.register(self._finalize)

    def log(self, *args):
        self._start()
        for event in args:
            self.queue.put(event)
        self.queue_filled_event.set()

    def _start(self):
        if not self.started:
            self.thread.start()
            self.started = True

    def _finalize(self):
        self.logger.info("Flushing final log events...")
        self.flush()

    def _publisher(self, batch_size=None):
        kwargs = {}
        if batch_size is not None:
            kwargs["batch_size"] = batch_size

        while True:
            self.queue_filled_event.wait()
            try:
                self.flush(**kwargs)
            except Exception:
                traceback.print_exc()

    def flush(self, batch_size=100):
        # We cannot have multiple threads flushing in parallel, because the
        # order of published elements would be undefined.
        with self.flush_lock:
            conn = _state.log_conn()
            while True:
                items = []
                items_len = 0
                while len(items) < batch_size and items_len < MAX_REQUEST_SIZE / 2:
                    try:
                        item = self.queue.get_nowait()
                    except queue.Empty:
                        break

                    item_s = json.dumps(item)
                    items.append(item_s)
                    items_len += len(item_s)

                if len(items) == 0:
                    break
                items_s = construct_json_array(items)
                for i in range(NUM_RETRIES):
                    start_time = time.time()
                    resp = conn.post("/logs", data=items_s)
                    if resp.ok:
                        break
                    retrying_text = "" if i + 1 == NUM_RETRIES else " Retrying"
                    _logger.warning(
                        f"log request failed. Elapsed time: {time.time() - start_time} seconds. Payload size: {len(item_s)}. Error: {resp.status_code}: {resp.text}.{retrying_text}"
                    )
                if not resp.ok:
                    _logger.warning(f"log request failed after {NUM_RETRIES} retries. Dropping batch")
            self.queue_filled_event.clear()


def _ensure_object(object_type, object_id, force=False):
    experiment_path = EXPERIMENTS_PATH / f"{object_id}.parquet"

    if force or not experiment_path.exists():
        os.makedirs(EXPERIMENTS_PATH, exist_ok=True)
        conn = _state.log_conn()
        resp = conn.get(
            f"object/{object_type}",
            params={"id": object_id},
            headers={
                "Accept": "application/octet-stream",
            },
        )

        with open(experiment_path, "wb") as f:
            f.write(resp.content)

    return experiment_path


def init(
    project: str,
    experiment: str = None,
    description: str = None,
    dataset: "Dataset" = None,
    update: bool = False,
    base_experiment: str = None,
    is_public: bool = False,
    api_url: str = None,
    api_key: str = None,
    org_name: str = None,
    disable_cache: bool = False,
    set_current: bool = None,
):
    """
    Log in, and then initialize a new experiment in a specified project. If the project does not exist, it will be created.

    Remember to close your experiment when it is finished by calling `Experiment.close`. We recommend binding the experiment to a context manager (`with braintrust.init(...) as experiment`) to automatically mark it as current and ensure it is terminated.

    :param project: The name of the project to create the experiment in.
    :param experiment: The name of the experiment to create. If not specified, a name will be generated automatically.
    :param description: (Optional) An optional description of the experiment.
    :param dataset: (Optional) A dataset to associate with the experiment. The dataset must be initialized with `braintrust.init_dataset` before passing
    it into the experiment.
    :param update: If the experiment already exists, continue logging to it.
    :param base_experiment: An optional experiment name to use as a base. If specified, the new experiment will be summarized and compared to this
    experiment. Otherwise, it will pick an experiment by finding the closest ancestor on the default (e.g. main) branch.
    :param is_public: An optional parameter to control whether the experiment is publicly visible to anybody with the link or privately visible to only members of the organization. Defaults to private.
    :param api_url: The URL of the Braintrust API. Defaults to https://www.braintrustdata.com.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :param disable_cache: Do not use cached login information.
    :param set_current: If true (default), set the currently-active experiment to the newly-created one. Unless the experiment is bound to a context manager, it will not be marked as current. Equivalent to calling `with braintrust.with_current(experiment)`.
    :returns: The experiment object.
    """
    login(org_name=org_name, disable_cache=disable_cache, api_key=api_key, api_url=api_url)
    return Experiment(
        project_name=project,
        experiment_name=experiment,
        description=description,
        dataset=dataset,
        update=update,
        base_experiment=base_experiment,
        is_public=is_public,
        set_current=set_current,
    )


def init_dataset(
    project: str,
    name: str = None,
    description: str = None,
    version: "str | int" = None,
    api_url: str = None,
    api_key: str = None,
    org_name: str = None,
    disable_cache: bool = False,
):
    """
    Create a new dataset in a specified project. If the project does not exist, it will be created.

    Remember to close your dataset when it is finished by calling `Dataset.close`. We recommend wrapping the dataset within a context manager (`with braintrust.init_dataset(...) as dataset`) to ensure it is terminated.

    :param project: The name of the project to create the dataset in.
    :param name: The name of the dataset to create. If not specified, a name will be generated automatically.
    :param description: An optional description of the dataset.
    :param version: An optional version of the dataset (to read). If not specified, the latest version will be used.
    :param api_url: The URL of the Braintrust API. Defaults to https://www.braintrustdata.com.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :param disable_cache: Do not use cached login information.
    :returns: The dataset object.
    """
    login(org_name=org_name, disable_cache=disable_cache, api_key=api_key, api_url=api_url)

    return Dataset(
        project_name=project,
        name=name,
        description=description,
        version=version,
    )


login_lock = threading.RLock()


def login(api_url=None, api_key=None, org_name=None, disable_cache=False, force_login=False):
    """
    Log into Braintrust. This will prompt you for your API token, which you can find at
    https://www.braintrustdata.com/app/token. This method is called automatically by `init()`.

    :param api_url: The URL of the Braintrust API. Defaults to https://www.braintrustdata.com.
    :param api_key: The API key to use. If the parameter is not specified, will try to use the `BRAINTRUST_API_KEY` environment variable. If no API
    key is specified, will prompt the user to login.
    :param org_name: (Optional) The name of a specific organization to connect to. This is useful if you belong to multiple.
    :param disable_cache: Do not use cached login information.
    :param force_login: Login again, even if you have already logged in (by default, this function will exit quickly if you have already logged in)
    """

    global _state

    # Only permit one thread to login at a time
    with login_lock:
        if api_url is None:
            api_url = os.environ.get("BRAINTRUST_API_URL", "https://www.braintrustdata.com")

        if api_key is None:
            api_key = os.environ.get("BRAINTRUST_API_KEY")

        # If any provided login inputs disagree with our existing settings,
        # force login.
        if (
            api_url != _state.api_url
            or (api_key is not None and HTTPConnection.sanitize_token(api_key) != _state.login_token)
            or (org_name is not None and org_name != _state.org_name)
        ):
            force_login = True

        if not force_login and _state.logged_in:
            # We have already logged in
            return

        _state = BraintrustState()

        _state.api_url = api_url

        login_key_info = None
        ping_ok = False

        os.makedirs(CACHE_PATH, exist_ok=True)

        if api_key is not None:
            resp = requests.post(_urljoin(_state.api_url, "/api/apikey/login"), json={"token": api_key})
            if not resp.ok:
                api_key_prefix = (
                    (" (" + api_key[:2] + "*" * (len(api_key) - 4) + api_key[-2:] + ")") if len(api_key) > 4 else ""
                )
                raise ValueError(f"Invalid API key{api_key_prefix}: [{resp.status_code}] {resp.text}")
            info = resp.json()

            _check_org_info(info["org_info"], org_name)

            conn = _state.log_conn()
            conn.set_token(api_key)

            ping_ok = conn.ping()

        if not ping_ok and os.path.exists(LOGIN_INFO_PATH) and not disable_cache:
            with open(LOGIN_INFO_PATH) as f:
                login_key_info = json.load(f)

            _state.log_url = login_key_info.get("log_url")
            _state.org_id = login_key_info.get("org_id")
            _state.org_name = login_key_info.get("org_name")
            conn = _state.log_conn()

            token = login_key_info.get("token")
            if token is not None:
                conn.set_token(token)

            ping_ok = conn.ping()

        if (
            not ping_ok or _state.org_id is None or _state.org_name is None or _state.log_url is None
        ) and sys.stdout.isatty():
            print(
                textwrap.dedent(
                    f"""\
                The recommended way to login is to generate an API token at {_state.api_url}/app/settings.
                However, Braintrust also supports generating a temporary token for the SDK. This token
                will expire after about an hour, so it is not recommended for long-term use.

                Please copy your temporary token from {_state.api_url}/app/token."""
                )
            )
            temp_token = getpass("Token: ")

            resp = requests.post(_urljoin(_state.api_url, "/api/id-token"), json={"token": temp_token})
            response_raise_for_status(resp)
            info = resp.json()
            token = info["token"]

            _check_org_info(info["org_info"], org_name)

            if not disable_cache:
                _save_api_info(
                    {
                        "token": token,
                        "org_id": _state.org_id,
                        "log_url": _state.log_url,
                        "org_name": _state.org_name,
                    }
                )

            conn = _state.log_conn()
            conn.set_token(token)

            ping_ok = conn.ping()

        if not conn:
            raise ValueError(
                "Could not login to Braintrust. You may need to set BRAINTRUST_API_KEY in your environment."
            )

        # Do not use the "ping" method here, because we'd like to `raise_for_status()` in case
        # of any remaining errors.
        if not ping_ok:
            # Try to produce a more informative error message. If we do somehow succeed here, then
            # we can safely assume that the connection is working.
            resp = conn.get("ping")
            response_raise_for_status(resp)

        # make_long_lived() allows the connection to retry if it breaks, which we're okay with after
        # this point because we know the connection _can_ successfully ping.
        conn.make_long_lived()

        # Set the same token in the API
        _state.api_conn().set_token(conn.token)
        _state.login_token = conn.token
        _state.logged_in = True


def log(**event):
    """
    Log a single event to the current experiment. The event will be batched and uploaded behind the scenes.

    :param **event: Data to be logged. See `Experiment.log` for full details.
    :returns: The `id` of the logged event.
    """

    current_experiment = _state.current_experiment.get()

    if not current_experiment:
        raise Exception("Not initialized. Please call init() first")

    return current_experiment.log(**event)


def summarize(summarize_scores=True, comparison_experiment_id=None):
    """
    Summarize the current experiment, including the scores (compared to the closest reference experiment) and metadata.

    :param summarize_scores: Whether to summarize the scores. If False, only the metadata will be returned.
    :param comparison_experiment_id: The experiment to compare against. If None, the most recent experiment on the comparison_commit will be used.
    :returns: `ExperimentSummary`
    """
    current_experiment = _state.current_experiment.get()

    if not current_experiment:
        raise Exception("Not initialized. Please call init() first")

    return current_experiment.summarize(
        summarize_scores=summarize_scores,
        comparison_experiment_id=comparison_experiment_id,
    )


def current_experiment() -> Optional["Experiment"]:
    """Returns the currently-active experiment (set by `with braintrust.init(...)` or `with braintrust.with_current(experiment)`). Returns undefined if no current experiment has been set."""

    return _state.current_experiment.get()


def current_span() -> Span:
    """Return the currently-active span for logging (set by `with *.start_span` or `braintrust.with_current`). If there is no active span, returns a no-op span object, which supports the same interface as spans but does no logging.

    See `Span` for full details.
    """

    return _state.current_span.get()


def start_span(name, span_attributes={}, start_time=None, set_current=None, **event) -> Span:
    """Toplevel function for starting a span. If there is a currently-active span, the new span is created as a subspan. Otherwise, if there is a currently-active experiment, the new span is created as a toplevel span. Otherwise, it returns a no-op span object.

    Unless a name is explicitly provided, the name of the span will be the name of the calling function, or "root" if no meaningful name can be determined.

    We recommend running spans bound to a context manager (`with start_span`) to automatically mark them as current and ensure they are terminated. If you wish to start a span outside a callback, be sure to terminate it with `span.end()`.

    See `Span.startSpan` for full details.
    """

    name = name or get_caller_location().caller_functionname or "root"
    kwargs = dict(name=name, span_attributes=span_attributes, start_time=start_time, set_current=set_current, **event)
    parent_span = current_span()
    if parent_span != NOOP_SPAN:
        return parent_span.start_span(**kwargs)

    experiment = current_experiment()
    if experiment:
        return experiment.start_span(**kwargs)

    return NOOP_SPAN


class _CurrentObjectWrapper:
    """Context manager wrapper for marking an experiment as current."""

    def __init__(self, object_cvar, object):
        self.object_cvar = object_cvar
        self.object = object

    def __enter__(self):
        self.context_token = self.object_cvar.set(self.object)

    def __exit__(self, type, value, callback):
        del type, value, callback

        self.object_cvar.reset(self.context_token)


def with_current(object: Union["Experiment", "SpanImpl", _NoopSpan]):
    """Set the given experiment or span as current within the bound context manager (`with braintrust.with_current(object)`) and any asynchronous operations created within the block. The current experiment can be accessed with `braintrust.current_experiment`, and the current span with `braintrust.current_span`.

    :param object: The experiment or span to be marked as current.
    """
    if type(object) == Experiment:
        return _CurrentObjectWrapper(_state.current_experiment, object)
    elif type(object) == SpanImpl or type(object) == NoopSpan:
        return _CurrentObjectWrapper(_state.current_span, object)
    else:
        raise RuntimeError(f"Invalid object of type {type(object)}")


def traced(*span_args, **span_kwargs):
    """Decorator to trace the wrapped function as a span. Can either be applied bare (`@traced`) or by providing arguments (`@traced(*span_args, **span_kwargs)`), which will be forwarded to the created span. See `braintrust.start_span` for details on how the span is created, and `Span.start_span` for full details on the span arguments.

    Unless a name is explicitly provided in `span_args` or `span_kwargs`, the name of the span will be the name of the decorated function.
    """

    def decorator(span_args, span_kwargs, f):
        # We assume 'name' is the first positional argument in `start_span`.
        if len(span_args) == 0 and span_kwargs.get("name") is None:
            span_args += (f.__name__,)

        @wraps(f)
        def wrapper_sync(*f_args, **f_kwargs):
            with start_span(*span_args, **span_kwargs):
                return f(*f_args, **f_kwargs)

        @wraps(f)
        async def wrapper_async(*f_args, **f_kwargs):
            with start_span(*span_args, **span_kwargs):
                return await f(*f_args, **f_kwargs)

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


def _check_org_info(org_info, org_name):
    global _state

    if len(org_info) == 0:
        raise ValueError("This user is not part of any organizations.")

    for orgs in org_info:
        if org_name is None or orgs["name"] == org_name:
            _state.org_id = orgs["id"]
            _state.org_name = orgs["name"]
            _state.log_url = orgs["api_url"]
            break

    if _state.org_id is None:
        raise ValueError(
            f"Organization {org_name} not found. Must be one of {', '.join([x['name'] for x in org_info])}"
        )


def _save_api_info(api_info):
    os.makedirs(CACHE_PATH, exist_ok=True)
    with open(LOGIN_INFO_PATH, "w") as f:
        json.dump(api_info, f)


def _urljoin(*parts):
    return "/".join([x.lstrip("/") for x in parts])


def _populate_args(d, **kwargs):
    for k, v in kwargs.items():
        if v is not None:
            d[k] = v

    return d


def _validate_and_sanitize_experiment_log_partial_args(event):
    # Make sure only certain keys are specified.
    forbidden_keys = set(event.keys()) - {
        "input",
        "output",
        "expected",
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
        for forbidden_key in ["start", "end", "caller_functionname", "caller_filename", "caller_lineno"]:
            if forbidden_key in metrics:
                raise ValueError(f"Key {forbidden_key} may not be specified in metrics")

    input = event.get("input")
    inputs = event.get("inputs")
    if input is not None and inputs is not None:
        raise ValueError("Only one of input or inputs (deprecated) can be specified. Prefer input.")
    if inputs is not None:
        return dict(**{k: v for k, v in event.items() if k != "inputs"}, input=inputs)
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

    if event.get("scores") is None:
        raise ValueError("scores must be specified")
    elif not isinstance(event["scores"], dict):
        raise ValueError("scores must be a dictionary of names with scores")

    if has_dataset and event.get("dataset_record_id") is None:
        raise ValueError("dataset_record_id must be specified when using a dataset")
    elif not has_dataset and event.get("dataset_record_id") is not None:
        raise ValueError("dataset_record_id cannot be specified when not using a dataset")

    return event


class Experiment(ModelWrapper):
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
        project_name: str,
        experiment_name: str = None,
        description: str = None,
        dataset: "Dataset" = None,
        update: bool = False,
        base_experiment: str = None,
        is_public: bool = False,
        set_current: bool = None,
    ):
        self.finished = False
        self.set_current = True if set_current is None else set_current

        args = {"project_name": project_name, "org_id": _state.org_id}

        if experiment_name is not None:
            args["experiment_name"] = experiment_name

        if description is not None:
            args["description"] = description

        if update:
            args["update"] = update

        repo_status = get_repo_status()
        if repo_status:
            args["repo_info"] = repo_status.as_dict()

        if base_experiment is not None:
            args["base_experiment"] = base_experiment
        else:
            args["ancestor_commits"] = list(get_past_n_ancestors())

        if dataset is not None:
            args["dataset_id"] = dataset.id
            args["dataset_version"] = dataset.version

        if is_public is not None:
            args["public"] = is_public

        response = _state.api_conn().post_json("api/experiment/register", args)
        self.project = ModelWrapper(response["project"])
        super().__init__(response["experiment"])
        self.dataset = dataset
        self.logger = _LogThread(name=experiment_name)
        self.last_start_time = time.time()

        _unterminated_objects.add_unterminated(self, get_caller_location())

    def log(
        self,
        input=None,
        output=None,
        expected=None,
        scores=None,
        metadata=None,
        metrics=None,
        id=None,
        dataset_record_id=None,
        inputs=None,
    ):
        """
        Log a single event to the experiment. The event will be batched and uploaded behind the scenes.

        :param input: The arguments that uniquely define a test case (an arbitrary, JSON serializable object). Later on, Braintrust will use the `input` to know whether two test cases are the same between experiments, so they should not contain experiment-specific state. A simple rule of thumb is that if you run the same experiment twice, the `input` should be identical.
        :param output: The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
        :param expected: The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate your experiments while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
        :param scores: A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare experiments.
        :param metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
        :param metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically and should not be specified: "start", "end", "caller_functionname", "caller_filename", "caller_lineno".
        :param id: (Optional) a unique identifier for the event. If you don't provide one, BrainTrust will generate one for you.
        :param dataset_record_id: (Optional) the id of the dataset record that this event is associated with. This field is required if and only if the experiment is associated with a dataset.
        :param inputs: (Deprecated) the same as `input` (will be removed in a future version).
        :returns: The `id` of the logged event.
        """
        self._check_not_finished()

        event = _validate_and_sanitize_experiment_log_full_args(
            dict(
                input=input,
                output=output,
                expected=expected,
                scores=scores,
                metadata=metadata,
                metrics=metrics,
                id=id,
                dataset_record_id=dataset_record_id,
                inputs=inputs,
            ),
            self.dataset is not None,
        )
        span = self.start_span(start_time=self.last_start_time, **event)
        self.last_start_time = span.end()
        return span.id

    def start_span(self, name="root", span_attributes={}, start_time=None, set_current=None, **event):
        """Create a new toplevel span. The name parameter is optional and defaults to "root".

        See `Span.start_span` for full details
        """
        self._check_not_finished()

        return SpanImpl(
            experiment_logger=self.logger,
            name=name,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            event=event,
            root_experiment=self,
        )

    def summarize(self, summarize_scores=True, comparison_experiment_id=None):
        """
        Summarize the experiment, including the scores (compared to the closest reference experiment) and metadata.

        :param summarize_scores: Whether to summarize the scores. If False, only the metadata will be returned.
        :param comparison_experiment_id: The experiment to compare against. If None, the most recent experiment on the origin's main branch will be used.
        :returns: `ExperimentSummary`
        """
        self._check_not_finished()

        # Flush our events to the API, and to the data warehouse, to ensure that the link we print
        # includes the new experiment.
        self.logger.flush()

        project_url = (
            f"{_state.api_url}/app/{encode_uri_component(_state.org_name)}/p/{encode_uri_component(self.project.name)}"
        )
        experiment_url = f"{project_url}/{encode_uri_component(self.name)}"

        score_summary = {}
        comparison_experiment_name = None
        if summarize_scores:
            # Get the comparison experiment
            if comparison_experiment_id is None:
                conn = _state.log_conn()
                resp = conn.get("/crud/base_experiments", params={"id": self.id})
                response_raise_for_status(resp)
                base_experiments = resp.json()
                if base_experiments:
                    comparison_experiment_id = base_experiments[0]["base_exp_id"]
                    comparison_experiment_name = base_experiments[0]["base_exp_name"]

            if comparison_experiment_id is not None:
                summary_items = _state.log_conn().get_json(
                    "experiment-comparison",
                    args={
                        "experiment_id": self.id,
                        "base_experiment_id": comparison_experiment_id,
                    },
                    retries=3,
                )
                longest_score_name = max(len(k) for k in summary_items.keys()) if summary_items else 0
                score_summary = {
                    k: ScoreSummary(_longest_score_name=longest_score_name, **v) for (k, v) in summary_items.items()
                }

        return ExperimentSummary(
            project_name=self.project.name,
            experiment_name=self.name,
            project_url=project_url,
            experiment_url=experiment_url,
            comparison_experiment_name=comparison_experiment_name,
            scores=score_summary,
        )

    def close(self):
        """Finish the experiment and return its id. After calling close, you may not invoke any further methods on the experiment object.

        Will be invoked automatically if the experiment is bound to a context manager.

        :returns: The experiment id.
        """
        self._check_not_finished()

        self.logger.flush()

        self.finished = True
        _unterminated_objects.remove_unterminated(self)
        return self.id

    def _check_not_finished(self):
        if self.finished:
            raise RuntimeError("Cannot invoke method on finished experiment")

    def __enter__(self):
        if self.set_current:
            self._context_token = _state.current_experiment.set(self)
        return self

    def __exit__(self, type, value, callback):
        del type, value, callback

        if self.set_current:
            _state.current_experiment.reset(self._context_token)

        self.close()


class SpanImpl(Span):
    """Primary implementation of the `Span` interface. See the `Span` interface for full details on each method.

    We suggest using one of the various `start_span` methods, instead of creating Spans directly. See `Span.start_span` for full details.
    """

    # root_experiment should only be specified for a root span. parent_span
    # should only be specified for non-root spans.
    def __init__(
        self,
        experiment_logger,
        name,
        span_attributes={},
        start_time=None,
        set_current=None,
        event={},
        root_experiment=None,
        parent_span=None,
    ):
        if (root_experiment is None) == (parent_span is None):
            raise ValueError("Must specify exactly one of `root_experiment` and `parent_span`")

        self.finished = False
        self.set_current = True if set_current is None else set_current

        self.experiment_logger = experiment_logger

        # `internal_data` contains fields that are not part of the
        # "user-sanitized" set of fields which we want to log in just one of the
        # span rows.
        caller_location = get_caller_location()
        self.internal_data = dict(
            metrics=dict(
                start=start_time or time.time(),
                **(caller_location or {}),
            ),
            span_attributes=dict(**span_attributes, name=name),
        )

        # Fields that are logged to every span row.
        self._id = event.get("id", None)
        if self._id is None:
            self._id = str(uuid.uuid4())
        self._span_id = str(uuid.uuid4())
        if root_experiment is not None:
            self._root_span_id = self._span_id
            self._project_id = root_experiment.project.id
            self._experiment_id = root_experiment.id
            self.internal_data.update(
                # TODO: Hopefully we can remove this.
                user_id=root_experiment.user_id,
                created=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            )
        elif parent_span is not None:
            self._root_span_id = parent_span._root_span_id
            self._project_id = parent_span._project_id
            self._experiment_id = parent_span._experiment_id
            self.internal_data.update(span_parents=[parent_span._span_id])
        else:
            raise RuntimeError("Must provide either 'root_experiment' or 'parent_span'")

        # The first log is a replacement, but subsequent logs to the same span
        # object will be merges.
        self._is_merge = False
        self.log(**{k: v for k, v in event.items() if k != "id"})
        self._is_merge = True

        _unterminated_objects.add_unterminated(self, caller_location)

    @property
    def id(self):
        return self._id

    @property
    def span_id(self):
        return self._span_id

    @property
    def root_span_id(self):
        return self._root_span_id

    def log(self, **event):
        self._check_not_finished()

        sanitized = {
            k: v for k, v in _validate_and_sanitize_experiment_log_partial_args(event).items() if v is not None
        }
        # There should be no overlap between the dictionaries being merged.
        record = dict(
            **sanitized,
            **self.internal_data,
            id=self._id,
            span_id=self._span_id,
            root_span_id=self._root_span_id,
            project_id=self._project_id,
            experiment_id=self._experiment_id,
            _is_merge=self._is_merge,
        )
        self.internal_data = {}
        self.experiment_logger.log(record)

    def start_span(self, name, span_attributes={}, start_time=None, set_current=None, **event):
        self._check_not_finished()

        return SpanImpl(
            experiment_logger=self.experiment_logger,
            name=name,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            event=event,
            parent_span=self,
        )

    def end(self, end_time=None):
        self._check_not_finished()

        end_time = end_time or time.time()
        self.internal_data = dict(metrics=dict(end=end_time))
        self.log()

        self.finished = True
        _unterminated_objects.remove_unterminated(self)
        return end_time

    def close(self, end_time=None):
        return self.end(end_time)

    def _check_not_finished(self):
        if self.finished:
            raise RuntimeError("Cannot invoke method on finished span")

    def __enter__(self):
        if self.set_current:
            self._context_token = _state.current_span.set(self)
        return self

    def __exit__(self, type, value, callback):
        del type, value, callback

        if self.set_current:
            _state.current_span.reset(self._context_token)

        self.end()


class Dataset(ModelWrapper):
    """
    A dataset is a collection of records, such as model inputs and outputs, which represent
    data you can use to evaluate and fine-tune models. You can log production data to datasets,
    curate them with interesting examples, edit/delete records, and run evaluations against them.

    You should not create `Dataset` objects directly. Instead, use the `braintrust.init_dataset()` method.
    """

    def __init__(self, project_name: str, name: str = None, description: str = None, version: "str | int" = None):
        self.finished = False

        args = _populate_args(
            {"project_name": project_name, "org_id": _state.org_id},
            dataset_name=name,
            description=description,
        )
        response = _state.api_conn().post_json("api/dataset/register", args)
        self.project = ModelWrapper(response["project"])

        self.new_records = 0

        self._fetched_data = None

        self._pinned_version = None
        if version is not None:
            try:
                self._pinned_version = int(version)
                assert self._pinned_version >= 0
            except (ValueError, AssertionError):
                raise ValueError(f"version ({version}) must be a positive integer")

        super().__init__(response["dataset"])
        self.logger = _LogThread(name=self.name)

        _unterminated_objects.add_unterminated(self, get_caller_location())

    def insert(self, input, output, metadata=None, id=None):
        """
        Insert a single record to the dataset. The record will be batched and uploaded behind the scenes. If you pass in an `id`,
        and a record with that `id` already exists, it will be overwritten (upsert).

        :param input: The argument that uniquely define an input case (an arbitrary, JSON serializable object).
        :param output: The output of your application, including post-processing (an arbitrary, JSON serializable object).
        :param metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just
        about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the
        `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any
        JSON-serializable type, but its keys must be strings.
        :param id: (Optional) a unique identifier for the event. If you don't provide one, Braintrust will generate one for you.
        :returns: The `id` of the logged record.
        """
        self._check_not_finished()

        user_id = _state.user_info()["id"]

        if metadata:
            if not isinstance(metadata, dict):
                raise ValueError("metadata must be a dictionary")
            for key in metadata.keys():
                if not isinstance(key, str):
                    raise ValueError("metadata keys must be strings")

        args = _populate_args(
            {
                "id": id or str(uuid.uuid4()),
                "inputs": input,
                "output": output,
                "project_id": self.project.id,
                "dataset_id": self.id,
                "user_id": user_id,
                "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
            metadata=metadata,
        )

        self._clear_cache()  # We may be able to optimize this
        self.new_records += 1
        self.logger.log(args)
        return args["id"]

    def delete(self, id):
        """
        Delete a record from the dataset.

        :param id: The `id` of the record to delete.
        """
        self._check_not_finished()

        user_id = _state.user_info()["id"]
        args = _populate_args(
            {
                "id": id,
                "project_id": self.project.id,
                "dataset_id": self.id,
                "user_id": user_id,
                "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "_object_delete": True,  # XXX potentially place this in the logging endpoint
            },
        )

        self.logger.log(args)
        return args["id"]

    def summarize(self, summarize_data=True):
        """
        Summarize the dataset, including high level metrics about its size and other metadata.

        :param summarize_data: Whether to summarize the data. If False, only the metadata will be returned.
        :returns: `DatasetSummary`
        """
        self._check_not_finished()

        # Flush our events to the API, and to the data warehouse, to ensure that the link we print
        # includes the new experiment.
        self.logger.flush()

        project_url = (
            f"{_state.api_url}/app/{encode_uri_component(_state.org_name)}/p/{encode_uri_component(self.project.name)}"
        )
        dataset_url = f"{project_url}/d/{encode_uri_component(self.name)}"

        data_summary = None
        if summarize_data:
            data_summary_d = _state.log_conn().get_json(
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

    def fetch(self):
        """
        Fetch all records in the dataset.

        ```python
        for record in dataset.fetch():
            print(record)

        # You can also iterate over the dataset directly.
        for record in dataset:
            print(record)
        ```

        :returns: An iterator over the records in the dataset.
        """
        self._check_not_finished()

        for record in self.fetched_data:
            yield {
                "id": record.get("id"),
                "input": json.loads(record.get("input") or "null"),
                "output": json.loads(record.get("output") or "null"),
                "metadata": json.loads(record.get("metadata") or "null"),
            }

        self._clear_cache()

    def __iter__(self):
        self._check_not_finished()
        return self.fetch()

    @property
    def fetched_data(self):
        self._check_not_finished()
        if not self._fetched_data:
            resp = _state.log_conn().get(
                "object/dataset", params={"id": self.id, "fmt": "json", "version": self._pinned_version}
            )
            response_raise_for_status(resp)

            self._fetched_data = [json.loads(line) for line in resp.content.split(b"\n") if line.strip()]
        return self._fetched_data

    def _clear_cache(self):
        self._check_not_finished()
        self._fetched_data = None

    @property
    def version(self):
        self._check_not_finished()
        if self._pinned_version is not None:
            return self._pinned_version
        else:
            return max([int(record.get(TRANSACTION_ID_FIELD, 0)) for record in self.fetched_data] or [0])

    def close(self):
        """Terminate connection to the dataset and return its id. After calling close, you may not invoke any further methods on the dataset object.

        Will be invoked automatically if the dataset is bound as a context manager.

        :returns: The dataset id.
        """
        self._check_not_finished()

        self.logger.flush()

        self.finished = True
        _unterminated_objects.remove_unterminated(self)
        return self.id

    def _check_not_finished(self):
        if self.finished:
            raise RuntimeError("Cannot invoke method on finished dataset")

    def __enter__(self):
        return self

    def __exit__(self, type, value, callback):
        del type, value, callback
        self.close()


@dataclasses.dataclass
class ScoreSummary(SerializableDataClass):
    """Summary of a score's performance."""

    """Name of the score."""
    name: str
    """Average score across all examples."""
    score: float
    """Difference in score between the current and reference experiment."""
    diff: float
    """Number of improvements in the score."""
    improvements: int
    """Number of regressions in the score."""
    regressions: int

    # Used to help with formatting
    _longest_score_name: int

    def __str__(self):
        # format with 2 decimal points and pad so that it's exactly 2 characters then 2 decimals
        score_pct = f"{self.score * 100:05.2f}%"
        diff_pct = f"{abs(self.diff) * 100:05.2f}%"
        diff_score = f"+{diff_pct}" if self.diff > 0 else f"-{diff_pct}" if self.diff < 0 else "-"

        # pad the name with spaces so that its length is self._longest_score_name + 2
        score_name = f"'{self.name}'".ljust(self._longest_score_name + 2)

        return textwrap.dedent(
            f"""{score_pct} ({diff_score}) {score_name} score\t({self.improvements} improvements, {self.regressions} regressions)"""
        )


@dataclasses.dataclass
class ExperimentSummary(SerializableDataClass):
    """Summary of an experiment's scores and metadata."""

    """Name of the project that the experiment belongs to."""
    project_name: str
    """Name of the experiment."""
    experiment_name: str
    """URL to the project's page in the Braintrust app."""
    project_url: str
    """URL to the experiment's page in the Braintrust app."""
    experiment_url: str
    """The experiment scores are baselined against."""
    comparison_experiment_name: Optional[str]
    """Summary of the experiment's scores."""
    scores: Dict[str, ScoreSummary]

    def __str__(self):
        comparison_line = ""
        if self.comparison_experiment_name:
            comparison_line = f"""{self.experiment_name} compared to {self.comparison_experiment_name}:\n"""
        return (
            f"""\n=========================SUMMARY=========================\n{comparison_line}"""
            + "\n".join([str(score) for score in self.scores.values()])
            + ("\n\n" if self.scores else "")
            + textwrap.dedent(
                f"""\
        See results for {self.experiment_name} at {self.experiment_url}"""
            )
        )


@dataclasses.dataclass
class DataSummary(SerializableDataClass):
    """Summary of a dataset's data."""

    """New or updated records added in this session."""
    new_records: int
    """Total records in the dataset."""
    total_records: int

    def __str__(self):
        return textwrap.dedent(f"""Total records: {self.total_records} ({self.new_records} new or updated records)""")


@dataclasses.dataclass
class DatasetSummary(SerializableDataClass):
    """Summary of a dataset's scores and metadata."""

    """Name of the project that the dataset belongs to."""
    project_name: str
    """Name of the dataset."""
    dataset_name: str
    """URL to the project's page in the Braintrust app."""
    project_url: str
    """URL to the experiment's page in the Braintrust app."""
    dataset_url: str
    """Summary of the dataset's data."""
    data_summary: int

    def __str__(self):
        return textwrap.dedent(
            f"""\

             =========================SUMMARY=========================
             {str(self.data_summary)}
             See results for all datasets in {self.project_name} at {self.project_url}
             See results for {self.dataset_name} at {self.dataset_url}"""
        )
