import logging
import time
import warnings
from contextlib import contextmanager

from braintrust.logger import NOOP_SPAN, log_exc_info_to_span, start_span
from braintrust.wrappers._anthropic_utils import Wrapper, extract_anthropic_usage, finalize_anthropic_tokens
from wrapt import wrap_function_wrapper

log = logging.getLogger(__name__)


# This tracer depends on an internal anthropic method used to merge
# streamed messages together. It's a bit tricky so I'm opting to use it
# here. If it goes away, this polyfill will make it a no-op and the only
# result will be missing `output` and metrics in our spans. Our tests always
# run against the latest version of anthropic's SDK, so we'll know.
# anthropic-sdk-python/blob/main/src/anthropic/lib/streaming/_messages.py#L392
try:
    from anthropic.lib.streaming._messages import accumulate_event
except ImportError:

    def accumulate_event(event=None, current_snapshot=None, **kwargs):
        warnings.warn("braintrust: missing method: anthropic.lib.streaming._messages.accumulate_event")
        return current_snapshot


# Anthropic model parameters that we want to track as span metadata.
METADATA_PARAMS = (
    "model",
    "max_tokens",
    "temperature",
    "top_k",
    "top_p",
    "stop_sequences",
    "tool_choice",
    "tools",
    "stream",
)


class TracedAsyncAnthropic(Wrapper):
    def __init__(self, client):
        super().__init__(client)
        self.__client = client

    @property
    def messages(self):
        return AsyncMessages(self.__client.messages)

    @property
    def beta(self):
        return AsyncBeta(self.__client.beta)


class AsyncMessages(Wrapper):
    def __init__(self, messages):
        super().__init__(messages)
        self.__messages = messages

    async def create(self, *args, **kwargs):
        if kwargs.get("stream", False):
            return await self.__create_with_stream_true(*args, **kwargs)
        else:
            return await self.__create_with_stream_false(*args, **kwargs)

    async def __create_with_stream_false(self, *args, **kwargs):
        span = _start_span("anthropic.messages.create", kwargs)
        request_start_time = time.time()
        try:
            result = await self.__messages.create(*args, **kwargs)
            ttft = time.time() - request_start_time
            with _catch_exceptions():
                _log_message_to_span(result, span, time_to_first_token=ttft)
            return result
        except Exception as e:
            with _catch_exceptions():
                span.log(error=e)
            raise
        finally:
            span.end()

    async def __create_with_stream_true(self, *args, **kwargs):
        span = _start_span("anthropic.messages.stream", kwargs)
        request_start_time = time.time()
        try:
            stream = await self.__messages.create(*args, **kwargs)
        except Exception as e:
            with _catch_exceptions():
                span.log(error=e)
                span.end()
            raise

        traced_stream = TracedMessageStream(stream, span, request_start_time)

        async def async_stream():
            try:
                async for msg in traced_stream:
                    yield msg
            except Exception as e:
                with _catch_exceptions():
                    span.log(error=e)
                raise
            finally:
                with _catch_exceptions():
                    msg = traced_stream._get_final_traced_message()
                    if msg:
                        ttft = traced_stream._get_time_to_first_token()
                        _log_message_to_span(msg, span, time_to_first_token=ttft)
                    span.end()

        return async_stream()

    def stream(self, *args, **kwargs):
        span = _start_span("anthropic.messages.stream", kwargs)
        request_start_time = time.time()
        stream = self.__messages.stream(*args, **kwargs)
        return TracedMessageStreamManager(stream, span, request_start_time)


class AsyncBeta(Wrapper):
    def __init__(self, beta):
        super().__init__(beta)
        self.__beta = beta

    @property
    def messages(self):
        return AsyncMessages(self.__beta.messages)


class TracedAnthropic(Wrapper):
    def __init__(self, client):
        super().__init__(client)
        self.__client = client

    @property
    def messages(self):
        return Messages(self.__client.messages)

    @property
    def beta(self):
        return Beta(self.__client.beta)


class Messages(Wrapper):
    def __init__(self, messages):
        super().__init__(messages)
        self.__messages = messages

    def stream(self, *args, **kwargs):
        return self.__trace_stream(self.__messages.stream, *args, **kwargs)

    def create(self, *args, **kwargs):
        # If stream is True, we need to trace the stream function
        if kwargs.get("stream"):
            return self.__trace_stream(self.__messages.create, *args, **kwargs)

        span = _start_span("anthropic.messages.create", kwargs)
        request_start_time = time.time()
        try:
            msg = self.__messages.create(*args, **kwargs)
            ttft = time.time() - request_start_time
            _log_message_to_span(msg, span, time_to_first_token=ttft)
            return msg
        except Exception as e:
            span.log(error=e)
            raise
        finally:
            span.end()

    def __trace_stream(self, stream_func, *args, **kwargs):
        span = _start_span("anthropic.messages.stream", kwargs)
        request_start_time = time.time()
        s = stream_func(*args, **kwargs)
        return TracedMessageStreamManager(s, span, request_start_time)


class Beta(Wrapper):
    def __init__(self, beta):
        super().__init__(beta)
        self.__beta = beta

    @property
    def messages(self):
        return Messages(self.__beta.messages)


class TracedMessageStreamManager(Wrapper):
    def __init__(self, msg_stream_mgr, span, request_start_time: float):
        super().__init__(msg_stream_mgr)
        self.__msg_stream_mgr = msg_stream_mgr
        self.__traced_message_stream = None
        self.__span = span
        self.__request_start_time = request_start_time

    async def __aenter__(self):
        ms = await self.__msg_stream_mgr.__aenter__()
        self.__traced_message_stream = TracedMessageStream(ms, self.__span, self.__request_start_time)
        return self.__traced_message_stream

    def __enter__(self):
        ms = self.__msg_stream_mgr.__enter__()
        self.__traced_message_stream = TracedMessageStream(ms, self.__span, self.__request_start_time)
        return self.__traced_message_stream

    def __aexit__(self, exc_type, exc_value, traceback):
        try:
            return self.__msg_stream_mgr.__aexit__(exc_type, exc_value, traceback)
        finally:
            with _catch_exceptions():
                self.__close(exc_type, exc_value, traceback)

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return self.__msg_stream_mgr.__exit__(exc_type, exc_value, traceback)
        finally:
            with _catch_exceptions():
                self.__close(exc_type, exc_value, traceback)

    def __close(self, exc_type, exc_value, traceback):
        with _catch_exceptions():
            tms = self.__traced_message_stream
            msg = tms._get_final_traced_message()
            if msg:
                ttft = tms._get_time_to_first_token()
                _log_message_to_span(msg, self.__span, time_to_first_token=ttft)
            if exc_type:
                log_exc_info_to_span(self.__span, exc_type, exc_value, traceback)
            self.__span.end()


class TracedMessageStream(Wrapper):
    """TracedMessageStream wraps both sync and async message streams. Obviously only one
    makes sense at a time
    """

    def __init__(self, msg_stream, span, request_start_time: float):
        super().__init__(msg_stream)
        self.__msg_stream = msg_stream
        self.__span = span
        self.__metrics = {}
        self.__snapshot = None
        self.__request_start_time = request_start_time
        self.__time_to_first_token: float | None = None

    def _get_final_traced_message(self):
        return self.__snapshot

    def _get_time_to_first_token(self):
        return self.__time_to_first_token

    def __await__(self):
        return self.__msg_stream.__await__()

    def __aiter__(self):
        return self

    def __iter__(self):
        return self

    async def __anext__(self):
        m = await self.__msg_stream.__anext__()
        with _catch_exceptions():
            self.__process_message(m)
        return m

    def __next__(self):
        m = next(self.__msg_stream)
        with _catch_exceptions():
            self.__process_message(m)
        return m

    def __process_message(self, m):
        # Track time to first token on the first message
        if self.__time_to_first_token is None:
            self.__time_to_first_token = time.time() - self.__request_start_time

        with _catch_exceptions():
            self.__snapshot = accumulate_event(event=m, current_snapshot=self.__snapshot)


def _get_input_from_kwargs(kwargs):
    msgs = list(kwargs.get("messages", []))
    # save a copy of the messages because it might be a generator
    # and we may mutate it.
    kwargs["messages"] = msgs.copy()

    system = kwargs.get("system", None)
    if system:
        msgs.append({"role": "system", "content": system})
    return msgs


def _get_metadata_from_kwargs(kwargs):
    metadata = {"provider": "anthropic"}
    for k in METADATA_PARAMS:
        v = kwargs.get(k, None)
        if v is not None:
            metadata[k] = v
    return metadata


def _start_span(name, kwargs):
    """Start a span with the given name, tagged with all of the relevant data from kwargs. kwargs is the dictionary of options
    passed into anthropic.messages.create or anthropic.messages.stream.
    """
    with _catch_exceptions():
        _input = _get_input_from_kwargs(kwargs)
        metadata = _get_metadata_from_kwargs(kwargs)
        return start_span(name=name, type="llm", metadata=metadata, input=_input)

    # if this failed, maintain the API.
    return NOOP_SPAN


def _log_message_to_span(message, span, time_to_first_token: float | None = None):
    """Log telemetry from the given anthropic.Message to the given span."""
    with _catch_exceptions():
        usage = getattr(message, "usage", {})
        metrics = finalize_anthropic_tokens(extract_anthropic_usage(usage))

        # Add time_to_first_token if provided
        if time_to_first_token is not None:
            metrics["time_to_first_token"] = time_to_first_token

        # Create output dict with only truthy values for role and content
        output = {
            k: v
            for k, v in {"role": getattr(message, "role", None), "content": getattr(message, "content", None)}.items()
            if v
        } or None

        span.log(output=output, metrics=metrics)


@contextmanager
def _catch_exceptions():
    try:
        yield
    except Exception as e:
        log.warning("swallowing exception in tracing code", exc_info=e)


def wrap_anthropic(client):
    """Wrap an `Anthropic` object (or AsyncAnthropic) to add tracing. If Braintrust
    is not configured, this is a no-op. If this is not an `Anthropic` object, this
    function is a no-op.
    """
    type_name = getattr(type(client), "__name__")
    # We use 'in' because it could be AsyncAnthropicBedrock
    if "AsyncAnthropic" in type_name:
        return TracedAsyncAnthropic(client)
    elif "Anthropic" in type_name:
        return TracedAnthropic(client)
    else:
        # Unexpected.
        return client


def wrap_anthropic_client(client):
    return wrap_anthropic(client)


def _apply_anthropic_wrapper(client):
    """Apply tracing wrapper to an Anthropic client instance in-place."""
    wrapped = wrap_anthropic(client)
    client.messages = wrapped.messages
    if hasattr(wrapped, "beta"):
        client.beta = wrapped.beta


def _apply_async_anthropic_wrapper(client):
    """Apply tracing wrapper to an AsyncAnthropic client instance in-place."""
    wrapped = wrap_anthropic(client)
    client.messages = wrapped.messages
    if hasattr(wrapped, "beta"):
        client.beta = wrapped.beta


def _anthropic_init_wrapper(wrapped, instance, args, kwargs):
    """Wrapper for Anthropic.__init__ that applies tracing after initialization."""
    wrapped(*args, **kwargs)
    _apply_anthropic_wrapper(instance)


def _async_anthropic_init_wrapper(wrapped, instance, args, kwargs):
    """Wrapper for AsyncAnthropic.__init__ that applies tracing after initialization."""
    wrapped(*args, **kwargs)
    _apply_async_anthropic_wrapper(instance)


def patch_anthropic() -> bool:
    """
    Patch Anthropic to add Braintrust tracing globally.

    After calling this, all new Anthropic() and AsyncAnthropic() clients
    will automatically have tracing enabled.

    Returns:
        True if Anthropic was patched (or already patched), False if Anthropic is not installed.

    Example:
        ```python
        import braintrust
        braintrust.patch_anthropic()

        import anthropic
        client = anthropic.Anthropic()
        # All calls are now traced!
        ```
    """
    try:
        import anthropic

        if getattr(anthropic, "__braintrust_wrapped__", False):
            return True  # Already patched

        wrap_function_wrapper("anthropic", "Anthropic.__init__", _anthropic_init_wrapper)
        wrap_function_wrapper("anthropic", "AsyncAnthropic.__init__", _async_anthropic_init_wrapper)
        anthropic.__braintrust_wrapped__ = True
        return True

    except ImportError:
        return False
