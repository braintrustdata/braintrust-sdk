import logging
from typing import Any

import anthropic

from braintrust import span_types
from braintrust.logger import start_span

log = logging.getLogger(__name__)


class Wrapper:
    def __init__(self, wrapped: Any):
        self.__wrapped = wrapped

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__wrapped, name)


class TracedAnthropic(Wrapper):
    def __init__(self, client: anthropic.Anthropic):
        super().__init__(client)
        self.__client = client

    @property
    def messages(self):
        return TracedMessages(self.__client.messages)


class TracedMessages(Wrapper):
    def __init__(self, messages):
        super().__init__(messages)
        self.__messages = messages

    def stream(self, *args, **kwargs):
        # note: messages is *always* a kwarg in this library
        msgs_in = list(kwargs.get("messages", []))
        kwargs["messages"] = msgs_in  # just in case it's a generator

        span = start_span(name="anthropic.messages.stream", input=msgs_in, type="llm")
        s = self.__messages.stream(*args, **kwargs)
        return TracedMessageStreamManager(s, span)

    def create(self, *args, **kwargs):
        msgs_in = list(kwargs.get("messages", []))
        kwargs["messages"] = msgs_in  # just in case it's a generator

        span = start_span(name="anthropic.messages.create", type="llm")
        try:
            msg = self.__messages.create(*args, **kwargs)
            metadata = _extract_metadata(msg)
            metrics = _extract_metrics(getattr(msg, "usage", {}))
            span.log(input=msgs_in, output=msg.content, metadata=metadata, metrics=metrics)
            return msg
        except Exception as e:
            try:
                span.log(error=e)
            except Exception:
                pass
            raise e
        finally:
            span.end()


class TracedMessageStreamManager(Wrapper):
    def __init__(self, msg_stream_mgr, span):
        super().__init__(msg_stream_mgr)
        self.__msg_stream_mgr = msg_stream_mgr
        self.__span = span

    async def __aenter__(self):
        ms = await self.__msg_stream_mgr.__aenter__()
        return TracedMessageStream(ms, self.__span)

    def __aexit__(self, exc_type, exc_value, traceback):
        return self.__msg_stream_mgr.__aexit__(exc_type, exc_value, traceback)

    def __enter__(self):
        ms = self.__msg_stream_mgr.__enter__()
        return TracedMessageStream(ms, self.__span)

    def __exit__(self, exc_type, exc_value, traceback):
        # do we need to implement __exit__? the span is ended when the iterator is exhausted
        self.__msg_stream_mgr.__exit__(exc_type, exc_value, traceback)


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
        try:
            m = await self.__msg_stream.__anext__()
            self.__process_message(m)
            return m
        except StopAsyncIteration:
            self.__span.end()
            raise

    def __next__(self):
        try:
            m = next(self.__msg_stream)
            self.__process_message(m)
            return m
        except StopIteration:
            self.__span.end()
            raise

    def __process_message(self, m):
        if m.type in ("message_start", "message_delta", "message_stop"):
            metadata = None
            metrics = None
            usage = None

            # Some messages have usage & metadata and others only have usage.
            if hasattr(m, "message"):
                # start & end has usage & metadata
                msg = m.message
                metadata = _extract_metadata(msg)
                usage = getattr(msg, "usage", None)
            elif hasattr(m, "usage"):
                # messages deltas only have usage
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

            self.__span.log(metadata=metadata, metrics=self.__metrics)
        elif m.type == "text":
            # snapshot accumulates the whole message as it streams in. We can send the whole thing
            # and updates will be dedup'ed downstream
            self.__span.log(output=str(m.snapshot))


def _extract_metadata(msg):
    return {
        "provider": "anthropic",  # FIXME[matt] is there a field for this?
        "model": getattr(msg, "model", ""),
    }


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


def wrap_anthropic_client(client: anthropic.Anthropic) -> TracedAnthropic:
    return TracedAnthropic(client)
