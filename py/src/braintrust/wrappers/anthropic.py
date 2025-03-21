import logging
from typing import Any

import anthropic

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

    def create(self, *args, **kwargs):
        log.debug("doing it")
        span = start_span(name="anthropic.messages.create")
        try:
            return self.__messages.create(*args, **kwargs)
        finally:
            span.end()


def wrap_anthropic_client(client: anthropic.Anthropic) -> TracedAnthropic:
    return TracedAnthropic(client)
