import dataclasses
import json
from itertools import tee
from typing import Any, Callable, Generator, List, Literal, Union

from sseclient import SSEClient

# export type BraintrustStreamChunk =
#   | {
#       type: "text_delta";
#       data: string;
#     }
#   | {
#       type: "json_delta";
#       data: string;
#     };


@dataclasses.dataclass
class BraintrustTextChunk:
    data: str
    type: Literal["text_delta"] = "text_delta"


@dataclasses.dataclass
class BraintrustJsonChunk:
    data: str
    type: Literal["json_delta"] = "json_delta"


BraintrustStreamChunk = Union[BraintrustTextChunk, BraintrustJsonChunk]


class BraintrustStream:
    def __init__(self, base_stream: Union[SSEClient, List[BraintrustStreamChunk]]):
        if isinstance(base_stream, SSEClient):
            self.stream = self._parse_sse_stream(base_stream)
        else:
            self.stream = base_stream
        self.cached_items = []

    def _parse_sse_stream(self, sse_client: SSEClient) -> Generator[BraintrustStreamChunk, None, None]:
        for event in sse_client.events():
            if event.event == "text_delta":
                yield BraintrustTextChunk(data=json.loads(event.data))
            elif event.event == "json_delta":
                yield BraintrustJsonChunk(data=event.data)

    def copy(self):
        def tee_generator():
            for item in self.stream:
                self.cached_items.append(item)
                yield item

        self.stream, new_stream = tee(tee_generator())
        return BraintrustStream(new_stream)

    def final_value(self):
        return parse_stream(self)

    def __iter__(self):
        if self.cached_items:
            yield from self.cached_items
        yield from self.stream


def parse_stream(stream: BraintrustStream):
    text_chunks = []
    json_chunks = []

    for chunk in stream:
        if isinstance(chunk, BraintrustTextChunk):
            text_chunks.append(chunk.data)
        elif isinstance(chunk, BraintrustJsonChunk):
            json_chunks.append(chunk.data)

    if json_chunks:
        return json.loads("".join(json_chunks))
    elif text_chunks:
        return "".join(text_chunks)
    else:
        return None
