import atexit
import contextvars
import dataclasses
import datetime
import json
import logging
import os
import queue
import textwrap
import threading
import time
import traceback
import uuid
from functools import cache as _cache
from functools import wraps
from getpass import getpass
from typing import Any, Dict, NewType, Optional, Union

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .cache import CACHE_PATH, EXPERIMENTS_PATH, LOGIN_INFO_PATH
from .gitutil import get_past_n_ancestors, get_repo_status
from .util import SerializableDataClass, encode_uri_component, get_caller_location, response_raise_for_status


class BraintrustState:
    def __init__(self):
        self.current_experiment = None
        self.current_span = contextvars.ContextVar("braintrust_current_span", default=None)


_state = BraintrustState()
_logger = logging.getLogger("braintrust")

API_URL = None
LOGIN_TOKEN = None
ORG_ID = None
ORG_NAME = None
LOG_URL = None
LOGGED_IN = False

TRANSACTION_ID_FIELD = "_xact_id"


class HTTPConnection:
    def __init__(self, base_url):
        self.base_url = base_url
        self.token = None

        self._reset(total=0)

    def ping(self):
        try:
            resp = self.get("ping")
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


@_cache
def api_conn():
    return HTTPConnection(API_URL)


@_cache
def log_conn():
    return HTTPConnection(LOG_URL)


@_cache
def user_info():
    return log_conn().get_json("ping")


def _clear_cached_globals():
    api_conn.cache_clear()
    log_conn.cache_clear()
    user_info.cache_clear()


class ModelWrapper:
    def __init__(self, data):
        self.data = data

    def __getattr__(self, name: str) -> Any:
        return self.data[name]


# 10 MB (https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html)
MAX_REQUEST_SIZE = 10 * 1024 * 1024


def construct_json_array(items):
    return "[" + ",".join(items) + "]"


class _LogThread:
    def __init__(self, name=None):
        self.thread = threading.Thread(target=self._publisher, daemon=True)
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
            try:
                item = self.queue.get()
            except queue.Empty:
                continue

            try:
                self.flush(initial_items=[item], **kwargs)
            except Exception:
                traceback.print_exc()

    def flush(self, initial_items=None, batch_size=100):
        conn = log_conn()
        initial_items = list(reversed(initial_items)) if initial_items else []
        while True:
            items = []
            items_len = 0
            while len(items) < batch_size and items_len < MAX_REQUEST_SIZE / 2:
                if len(initial_items) > 0:
                    item = initial_items.pop()
                else:
                    try:
                        item = self.queue.get_nowait()
                    except queue.Empty:
                        break

                item_s = json.dumps(item)
                items.append(item_s)
                items_len += len(item_s)

            if len(items) > 0:
                response_raise_for_status(conn.post("/logs", data=construct_json_array(items)))
            else:
                break


def _ensure_object(object_type, object_id, force=False):
    experiment_path = EXPERIMENTS_PATH / f"{object_id}.parquet"

    if force or not experiment_path.exists():
        os.makedirs(EXPERIMENTS_PATH, exist_ok=True)
        conn = log_conn()
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
):
    """
    Log in, and then initialize a new experiment in a specified project. If the project does not exist, it will be created.

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
    :returns: The experiment object.
    """
    login(org_name=org_name, disable_cache=disable_cache, api_key=api_key, api_url=api_url)
    ret = Experiment(
        project_name=project,
        experiment_name=experiment,
        description=description,
        dataset=dataset,
        update=update,
        base_experiment=base_experiment,
        is_public=is_public,
    )
    _state.current_experiment = ret
    return ret


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


def log(**event):
    """
    Log a single event to the current experiment. The event will be batched and uploaded behind the scenes.

    :param **event: Data to be logged. See `Experiment.log` for full details.
    :returns: The `id` of the logged event.
    """

    if not _state.current_experiment:
        raise Exception("Not initialized. Please call init() or login() first")

    return _state.current_experiment.log(**event)


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

    global API_URL, LOGIN_TOKEN, ORG_ID, ORG_NAME, LOG_URL, LOGGED_IN

    # Only permit one thread to login at a time
    with login_lock:
        if api_url is None:
            api_url = os.environ.get("BRAINTRUST_API_URL", "https://www.braintrustdata.com")

        if api_key is None:
            api_key = os.environ.get("BRAINTRUST_API_KEY")

        # If any provided login inputs disagree with our existing settings,
        # force login.
        if (
            api_url != API_URL
            or (api_key is not None and HTTPConnection.sanitize_token(api_key) != LOGIN_TOKEN)
            or (org_name is not None and org_name != ORG_NAME)
        ):
            force_login = True

        if not force_login and LOGGED_IN:
            # We have already logged in
            return
        _clear_cached_globals()

        API_URL = api_url

        login_key_info = None
        ping_ok = False

        os.makedirs(CACHE_PATH, exist_ok=True)

        if api_key is not None:
            resp = requests.post(_urljoin(API_URL, "/api/apikey/login"), json={"token": api_key})
            if not resp.ok:
                api_key_prefix = (
                    (" (" + api_key[:2] + "*" * (len(api_key) - 4) + api_key[-2:] + ")") if len(api_key) > 4 else ""
                )
                raise ValueError(f"Invalid API key{api_key_prefix}: [{resp.status_code}] {resp.text}")
            info = resp.json()

            _check_org_info(info["org_info"], org_name)

            conn = log_conn()
            conn.set_token(api_key)

            ping_ok = conn.ping()

        if not ping_ok and os.path.exists(LOGIN_INFO_PATH) and not disable_cache:
            with open(LOGIN_INFO_PATH) as f:
                login_key_info = json.load(f)

            LOG_URL = login_key_info.get("log_url")
            ORG_ID = login_key_info.get("org_id")
            ORG_NAME = login_key_info.get("org_name")
            conn = log_conn()

            token = login_key_info.get("token")
            if token is not None:
                conn.set_token(token)

            ping_ok = conn.ping()

        if not ping_ok or ORG_ID is None or ORG_NAME is None or LOG_URL is None:
            print(
                textwrap.dedent(
                    f"""\
                The recommended way to login is to generate an API token at {API_URL}/app/settings.
                However, Braintrust also supports generating a temporary token for the SDK. This token
                will expire after about an hour, so it is not recommended for long-term use.

                Please copy your temporary token from {API_URL}/app/token."""
                )
            )
            temp_token = getpass("Token: ")

            resp = requests.post(_urljoin(API_URL, "/api/id-token"), json={"token": temp_token})
            response_raise_for_status(resp)
            info = resp.json()
            token = info["token"]

            _check_org_info(info["org_info"], org_name)

            if not disable_cache:
                _save_api_info(
                    {
                        "token": token,
                        "org_id": ORG_ID,
                        "log_url": LOG_URL,
                        "org_name": ORG_NAME,
                    }
                )

            conn = log_conn()
            conn.set_token(token)

            ping_ok = conn.ping()

        assert conn, "Conn should be set at this point (a bug)"

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
        api_conn().set_token(conn.token)
        LOGIN_TOKEN = conn.token
        LOGGED_IN = True


def summarize(summarize_scores=True, comparison_experiment_id=None):
    """
    Summarize the current experiment, including the scores (compared to the closest reference experiment) and metadata.

    :param summarize_scores: Whether to summarize the scores. If False, only the metadata will be returned.
    :param comparison_experiment_id: The experiment to compare against. If None, the most recent experiment on the comparison_commit will be used.
    :returns: `ExperimentSummary`
    """
    if not _state.current_experiment:
        raise Exception("Not initialized. Please call init() first")

    return _state.current_experiment.summarize(
        summarize_scores=summarize_scores,
        comparison_experiment_id=comparison_experiment_id,
    )


def current_experiment():
    """Returns the global current experiment (set by `braintrust.init`). Returns
    None if no experiment has been initialized.
    """

    return _state.current_experiment


def current_span():
    """Return the currently-active span for logging. See `Experiment.start_span`
    for full details on spans. Returns None if there is no currently-active
    span.
    """

    return _state.current_span.get()


def start_span(f=None, **span_kwargs):
    """Decorator to trace the wrapped function as a span. Can either be applied
    bare (`@start_span`) or by providing arguments
    (`@start_span(**span_kwargs)`), which will be forwarded to the created span.
    See `Experiment.start_span` for full details on `**span_kwargs`.

    At the time the decorated function is invoked, if there is a
    currently-active span, the new span is created as a subspan. Otherwise, if
    there is a global current experiment, the new span is created as a toplevel
    span. The new span is then set as the currently-active span. Otherwise, it
    is a no-op.

    Unless a name is explicitly provided in `span_kwargs`, the name of the span
    will be the name of the decorated function.
    """

    def decorator(f):
        if span_kwargs.get("name") is None:
            span_kwargs.update(name=f.__name__)

        @wraps(f)
        def wrapper(*f_args, **f_kwargs):
            # Obtain the span.
            if parent_span := current_span():
                span = parent_span.start_span(**span_kwargs)
            elif experiment := current_experiment():
                span = experiment.start_span(**span_kwargs)
            else:
                return f(*f_args, **f_kwargs)
            with span:
                return f(*f_args, **f_kwargs)

        return wrapper

    if f is not None:
        assert not span_kwargs, "Cannot provide function argument `f` explicitly"
        return decorator(f)
    else:
        return decorator


def _check_org_info(org_info, org_name):
    global ORG_ID, ORG_NAME, LOG_URL

    if len(org_info) == 0:
        raise ValueError("This user is not part of any organizations.")

    for orgs in org_info:
        if org_name is None or orgs["name"] == org_name:
            ORG_ID = orgs["id"]
            ORG_NAME = orgs["name"]
            LOG_URL = orgs["api_url"]
            break

    if ORG_ID is None:
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
            if score is not None:
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
        for forbidden_key in ["start", "end", "caller_filename", "caller_lineno"]:
            if forbidden_key in metrics:
                raise ValueError(f"Key {forbidden_key} may not be specified in metrics")

    input = event.get("input")
    inputs = event.get("inputs")
    if input is not None and inputs is not None:
        raise ValueError("Only one of input or inputs (deprecated) can be specified. Prefer input.")
    out = event.copy()
    out["input"] = input if input is not None else inputs
    if inputs is not None:
        del out["inputs"]
    return out


def _validate_and_sanitize_experiment_log_full_args(event, has_dataset):
    event = _validate_and_sanitize_experiment_log_partial_args(event)

    if event.get("input") is None:
        raise ValueError("input must be specified")

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
    ):
        args = {"project_name": project_name, "org_id": ORG_ID}

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

        response = api_conn().post_json("api/experiment/register", args)
        self.project = ModelWrapper(response["project"])
        super().__init__(response["experiment"])
        self.dataset = dataset
        self.logger = _LogThread(name=experiment_name)
        self.last_start_time = time.time()

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
        :param metrics: (Optional) a dictionary of metrics to log. The following keys are populated automatically and should not be specified: "start", "end", "caller_filename", "caller_lineno".
        :param id: (Optional) a unique identifier for the event. If you don't provide one, BrainTrust will generate one for you.
        :param dataset_record_id: (Optional) the id of the dataset record that this event is associated with. This field is required if and only if the experiment is associated with a dataset.
        :param inputs: (Deprecated) the same as `input` (will be removed in a future version)
        :returns: The `id` of the logged event.
        """

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
        span = self.start_span(start=self.last_start_time, **event)
        self.last_start_time = span.end()
        return span.id

    def start_span(self, name="root", span_attrs={}, start_time=None, **event):
        """
        Create a new toplevel span. This is useful if you want to log more
        detailed trace information beyond the scope of a single log event. Data
        logged over several calls to `ExperimentSpan.log` will be merged into
        one logical row.

        We recommend using spans within the python ContextManager framework
        (`with experiment.start_span() as span`), or as a function decorator
        (`@start_span`) to ensure they are terminated upon completion.

        `start_span` will also set the currently-active span, which can be
        obtained through `braintrust.current_span`.

        :param name: The name of the span.
        :param span_attrs: Optional additional attributes to attach to the span, such as a type name.
        :param start_time: Optional start time of the span, as a timestamp in seconds.
        :param **event: Data to be logged. See `Experiment.log` for full details.
        :returns: `ExperimentSpan`
        """

        return ExperimentSpan(
            experiment_logger=self.logger,
            name=name,
            span_attrs=span_attrs,
            start_time=start_time,
            root_experiment=self,
            event=event,
        )

    def summarize(self, summarize_scores=True, comparison_experiment_id=None):
        """
        Summarize the experiment, including the scores (compared to the closest reference experiment) and metadata.

        :param summarize_scores: Whether to summarize the scores. If False, only the metadata will be returned.
        :param comparison_experiment_id: The experiment to compare against. If None, the most recent experiment on the origin's main branch will be used.
        :returns: `ExperimentSummary`
        """

        # Flush our events to the API, and to the data warehouse, to ensure that the link we print
        # includes the new experiment.
        self.logger.flush()

        project_url = f"{API_URL}/app/{encode_uri_component(ORG_NAME)}/p/{encode_uri_component(self.project.name)}"
        experiment_url = f"{project_url}/{encode_uri_component(self.name)}"

        score_summary = {}
        comparison_experiment_name = None
        if summarize_scores:
            # Get the comparison experiment
            if comparison_experiment_id is None:
                conn = log_conn()
                resp = conn.get("/crud/base_experiments", params={"id": self.id})
                response_raise_for_status(resp)
                base_experiments = resp.json()
                if base_experiments:
                    comparison_experiment_id = base_experiments[0]["base_exp_id"]
                    comparison_experiment_name = base_experiments[0]["base_exp_name"]

            if comparison_experiment_id is not None:
                summary_items = log_conn().get_json(
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


class ExperimentSpan:
    """
    An ExperimentSpan encapsulates logged data and metrics for a unit of work.

    We suggest using one of the various `start_span` methods, instead of
    creating ExperimentSpans directly. See `Experiment.start_span` for full
    details.
    """

    # root_experiment should only be specified for a root span. parent_span
    # should only be specified for non-root spans.
    def __init__(
        self,
        experiment_logger,
        name,
        span_attrs={},
        start_time=None,
        root_experiment=None,
        parent_span=None,
        event={},
    ):
        self._check_not_finished()
        self.finished = False

        self.experiment_logger = experiment_logger

        if (root_experiment is None) == (parent_span is None):
            raise ValueError("Must specify exactly one of `root_experiment` and `parent_span`")

        # `internal_data` contains fields that are not part of the
        # "user-sanitized" set of fields which we want to log in just one of the
        # span rows.
        self.internal_data = dict(
            metrics=dict(
                start=start_time or time.time(),
                **get_caller_location(),
            ),
            span_attrs=dict(**span_attrs, name=name),
        )

        # Fields that are logged to every span row.
        try:
            self.id = event.pop("id")
        except KeyError:
            self.id = str(uuid.uuid4())
        self.span_id = str(uuid.uuid4())
        if root_experiment is not None:
            self.root_span_id = self.span_id
            self.project_id = root_experiment.project.id
            self.experiment_id = root_experiment.id
            self.internal_data.update(
                user_id=root_experiment.user_id,  # TODO: Hopefully we can remove this
                created=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            )
        else:
            assert parent_span is not None
            self.root_span_id = parent_span.root_span_id
            self.project_id = parent_span.project_id
            self.experiment_id = parent_span.experiment_id
            self.internal_data.update(span_parents=[parent_span.id])

        # Set this span as the currently-active span.
        global _state
        self._context_token = _state.current_span.set(self)

        self.log(**event)

    def log(self, **event):
        """
        Incrementally update the current span with new data. The event will be
        batched and uploaded behind the scenes.

        :param **event: Data to be logged. See `Experiment.log` for full details.
        """
        self._check_not_finished()

        sanitized = {
            k: v for k, v in _validate_and_sanitize_experiment_log_partial_args(event).items() if v is not None
        }
        # There should be no overlap between the dictionaries being merged.
        record = dict(
            **sanitized,
            **self.internal_data,
            id=self.id,
            span_id=self.span_id,
            root_span_id=self.root_span_id,
            project_id=self.project_id,
            experiment_id=self.experiment_id,
        )
        self.internal_data = {}
        self.experiment_logger.log(record)

    def start_span(self, name, span_attrs={}, start_time=None, **event):
        """Create a subspan of the calling span. See `Experiment.start_span` for
        full details.
        """
        self._check_not_finished()

        return ExperimentSpan(
            experiment_logger=self.experiment_logger,
            name=name,
            span_attrs=span_attrs,
            start_time=start_time,
            parent_span=self,
            event=event,
        )

    def end(self, end_time=None):
        """
        Terminate the span. Returns the end time logged to the row's metrics.
        After calling end, one may not invoke any further methods on the span
        object.

        Will be invoked automatically if the span is bound as a context manager.

        :param end_time: Optional end time of the span, as a timestamp in seconds.
        :returns: The end time logged to the span metrics.
        """
        self._check_not_finished()

        end_time = end_time or time.time()
        self.internal_data = dict(metrics=dict(end=end_time))
        self.log()

        # Unset this span as the currently-active span.
        global _state
        _state.current_span.reset(self._context_token)

        self.finished = True
        return end_time

    def __enter__(self):
        return self

    def __exit__(self, type, value, callback):
        del type, value, callback
        self.end()

    def _check_not_finished(self):
        if getattr(self, "finished", False):
            raise RuntimeError("Cannot invoke method on finished span")


class Dataset(ModelWrapper):
    """
    A dataset is a collection of records, such as model inputs and outputs, which represent
    data you can use to evaluate and fine-tune models. You can log production data to datasets,
    curate them with interesting examples, edit/delete records, and run evaluations against them.

    You should not create `Dataset` objects directly. Instead, use the `braintrust.init_dataset()` method.
    """

    def __init__(self, project_name: str, name: str = None, description: str = None, version: "str | int" = None):
        args = _populate_args(
            {"project_name": project_name, "org_id": ORG_ID},
            dataset_name=name,
            description=description,
        )
        response = api_conn().post_json("api/dataset/register", args)
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

        user_id = user_info()["id"]

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

        user_id = user_info()["id"]
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

        # Flush our events to the API, and to the data warehouse, to ensure that the link we print
        # includes the new experiment.
        self.logger.flush()

        project_url = f"{API_URL}/app/{encode_uri_component(ORG_NAME)}/p/{encode_uri_component(self.project.name)}"
        dataset_url = f"{project_url}/d/{encode_uri_component(self.name)}"

        data_summary = None
        if summarize_data:
            data_summary_d = log_conn().get_json(
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

        for record in self.fetched_data:
            yield {
                "id": record.get("id"),
                "input": json.loads(record.get("input") or "null"),
                "output": json.loads(record.get("output") or "null"),
                "metadata": json.loads(record.get("metadata") or "null"),
            }

        self._clear_cache()

    def __iter__(self):
        return self.fetch()

    @property
    def fetched_data(self):
        if not self._fetched_data:
            resp = log_conn().get(
                "object/dataset", params={"id": self.id, "fmt": "json", "version": self._pinned_version}
            )
            response_raise_for_status(resp)

            self._fetched_data = [json.loads(line) for line in resp.content.split(b"\n") if line.strip()]
        return self._fetched_data

    def _clear_cache(self):
        self._fetched_data = None

    @property
    def version(self):
        if self._pinned_version is not None:
            return self._pinned_version
        else:
            return max([int(record.get(TRANSACTION_ID_FIELD, 0)) for record in self.fetched_data] or [0])


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
