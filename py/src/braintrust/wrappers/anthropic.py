import asyncio
import logging
from contextlib import contextmanager
from typing import Any

from braintrust import span_types
from braintrust.logger import NOOP_SPAN, log_exc_info_to_span, start_span

log = logging.getLogger(__name__)


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
)


class Wrapper:
    def __init__(self, wrapped: Any):
        self.__wrapped = wrapped

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__wrapped, name)


class TracedAsyncAnthropic(Wrapper):
    def __init__(self, client):
        super().__init__(client)
        self.__client = client

    @property
    def messages(self):
        return AsyncMessages(self.__client.messages)


class AsyncMessages(Wrapper):
    def __init__(self, messages):
        super().__init__(messages)
        self.__messages = messages

    async def create(self, *args, **kwargs):
        span = _start_span("anthropic.messages.create", kwargs)
        try:
            result = await self.__messages.create(*args, **kwargs)
            with _catch_exceptions():
                _log_message_to_span(result, span)
            return result
        except Exception as e:
            with _catch_exceptions():
                span.log(error=e)
            raise e
        finally:
            span.end()

    def stream(self, *args, **kwargs):
        span = _start_span("anthropic.messages.stream", kwargs)
        stream = self.__messages.stream(*args, **kwargs)
        return TracedMessageStreamManager(stream, span)


class TracedAnthropic(Wrapper):
    def __init__(self, client):
        super().__init__(client)
        self.__client = client

    @property
    def messages(self):
        return Messages(self.__client.messages)


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
        try:
            msg = self.__messages.create(*args, **kwargs)
            _log_message_to_span(msg, span)
            return msg
        except Exception as e:
            span.log(error=e)
            raise
        finally:
            span.end()

    def __trace_stream(self, stream_func, *args, **kwargs):
        span = _start_span("anthropic.messages.stream", kwargs)
        s = stream_func(*args, **kwargs)
        return TracedMessageStreamManager(s, span)


class TracedMessageStreamManager(Wrapper):
    def __init__(self, msg_stream_mgr, span):
        super().__init__(msg_stream_mgr)
        self.__msg_stream_mgr = msg_stream_mgr
        self.__span = span

    async def __aenter__(self):
        ms = await self.__msg_stream_mgr.__aenter__()
        return TracedMessageStream(ms, self.__span)

    def __enter__(self):
        ms = self.__msg_stream_mgr.__enter__()
        return TracedMessageStream(ms, self.__span)

    def __aexit__(self, exc_type, exc_value, traceback):
        try:
            return self.__msg_stream_mgr.__aexit__(exc_type, exc_value, traceback)
        finally:
            with _catch_exceptions():
                # I think you can make a case that this should be done when the iterator
                # is exhausted, but this is safe.
                if exc_type:
                    log_exc_info_to_span(self.__span, exc_type, exc_value, traceback)
                self.__span.end()

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return self.__msg_stream_mgr.__exit__(exc_type, exc_value, traceback)
        finally:
            with _catch_exceptions():
                if exc_type:
                    log_exc_info_to_span(self.__span, exc_type, exc_value, traceback)
                self.__span.end()


class TracedMessageStream(Wrapper):
    """TracedMessageStream wraps both sync and async message streams. Obviously only one
    makes sense at a time
    """

    def __init__(self, msg_stream, span):
        super().__init__(msg_stream)
        self.__msg_stream = msg_stream
        self.__span = span
        self.__metrics = {}

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
        if m.type == "text":
            # snapshot accumulates the whole message as it streams in. We can send the whole thing
            # and updates will be dedup'ed downstream
            self.__span.log(output=str(m.snapshot))
        elif m.type in ("message_start", "message_delta", "message_stop"):
            # Parse the metrics from usage.
            # Note: For some messages it's on m.usage and others m.message.usage.
            usage = None
            if hasattr(m, "message"):
                usage = getattr(m.message, "usage", None)
            elif hasattr(m, "usage"):
                usage = m.usage

            # Not every message has every stat, but the total depends on sum of prompt & completion tokens,
            # so we need to track the current max for each value.
            if usage:
                cur_metrics = _extract_metrics(usage)
                for k, v in cur_metrics.items():
                    if v > self.__metrics.get(k, -1):
                        self.__metrics[k] = v
                self.__metrics["tokens"] = self.__metrics.get("prompt_tokens", 0) + self.__metrics.get(
                    "completion_tokens", 0
                )

            self.__span.log(metrics=self.__metrics)


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


def _log_message_to_span(message, span):
    """Log telemetry from the given anthropic.Message to the given span."""
    with _catch_exceptions():
        metrics = _extract_metrics(getattr(message, "usage", {}))
        content = getattr(message, "content")
        span.log(output=content, metrics=metrics)


def _extract_metrics(usage):
    metrics = {}
    if not usage:
        return {}

    def _save_if_exists_to(source, target=None):
        n = getattr(usage, source, None)
        if n is not None:
            metrics[target or source] = n

    _save_if_exists_to("input_tokens", "prompt_tokens")
    _save_if_exists_to("output_tokens", "completion_tokens")
    _save_if_exists_to("cache_read_input_tokens")
    _save_if_exists_to("cache_creation_input_tokens")
    metrics["tokens"] = metrics.get("prompt_tokens", 0) + metrics.get("completion_tokens", 0)

    return metrics


@contextmanager
def _catch_exceptions():
    try:
        yield
    except Exception as e:
        log.warning("swallowing exception in tracing code", exc_info=e)


def wrap_anthropic(client):
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
