import logging
from typing import Any

import anthropic

from braintrust import span_types
from braintrust.logger import start_span

log = logging.getLogger(__name__)


class NamedWrapper:
    def __init__(self, wrapped: Any):
        self.__wrapped = wrapped

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__wrapped, name)


class TracedAnthropic(NamedWrapper):
    def __init__(self, client: anthropic.Anthropic):
        super().__init__(client)
        self.__client = client

    @property
    def messages(self):
        return TracedMessages(self.__client.messages)


class TracedMessages(NamedWrapper):
    def __init__(self, messages):
        super().__init__(messages)
        self.__messages = messages

    def stream(self, *args, **kwargs):
        span = start_span(name="anthropic.messages.stream", type="llm")
        s = self.__messages.stream(*args, **kwargs)
        return TracedMessageStreamManager(s, span)

    def create(self, *args, **kwargs):
        span = start_span(name="anthropic.messages.create", type="llm")
        try:
            msg = self.__messages.create(*args, **kwargs)

            metadata = {
                "provider": "anthropic",  # FIXME[matt] is there a field for this?
                "model": getattr(msg, "model", ""),
            }

            metrics = {}
            usage = getattr(msg, "usage", None)
            if usage:
                in_t = getattr(usage, "input_tokens", 0)
                out_t = getattr(usage, "output_tokens", 0)
                metrics = {
                    "tokens": in_t + out_t,
                    "prompt_tokens": in_t,
                    "completion_tokens": out_t,
                }

            span.log(tags={}, metadata=metadata, metrics=metrics)

            return msg
        except Exception as e:
            try:
                span.log(error=e)
            except Exception:
                pass
            raise e
        finally:
            span.end()


class TracedMessageStreamManager(NamedWrapper):
    def __init__(self, msg_stream_mgr, span):
        super().__init__(msg_stream_mgr)
        self.__msg_stream_mgr = msg_stream_mgr
        self.__span = span

    def __enter__(self):
        ms = self.__msg_stream_mgr.__enter__()
        return TracedMessageStream(ms, self.__span)

    def __exit__(self, exc_type, exc_value, traceback):
        # FIXME[matt] do we need to implement __exit__?
        return self.__msg_stream_mgr.__exit__(exc_type, exc_value, traceback)


class TracedMessageStream(NamedWrapper):
    def __init__(self, msg_stream, span):
        super().__init__(msg_stream)
        self.__msg_stream = msg_stream
        self.__span = span

    def __iter__(self):
        print("iter")
        return self

    def __next__(self):
        print("next")
        try:
            return next(self.__msg_stream)
        except StopIteration:
            self.__span.end()
            raise


def wrap_anthropic_client(client: anthropic.Anthropic) -> TracedAnthropic:
    return TracedAnthropic(client)
