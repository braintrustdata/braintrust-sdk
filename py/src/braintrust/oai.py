import abc
import base64
import re
import time
from collections.abc import Callable
from typing import Any

from wrapt import wrap_function_wrapper

from .logger import Attachment, Span, start_span
from .span_types import SpanTypeAttribute
from .util import merge_dicts

X_LEGACY_CACHED_HEADER = "x-cached"
X_CACHED_HEADER = "x-bt-cached"


class NamedWrapper:
    def __init__(self, wrapped: Any):
        self.__wrapped = wrapped

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__wrapped, name)


class AsyncResponseWrapper:
    """Wrapper that properly preserves async context manager behavior for OpenAI responses."""

    def __init__(self, response: Any):
        self._response = response

    async def __aenter__(self):
        if hasattr(self._response, "__aenter__"):
            return await self._response.__aenter__()
        return self._response

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if hasattr(self._response, "__aexit__"):
            return await self._response.__aexit__(exc_type, exc_val, exc_tb)

    def __aiter__(self):
        if hasattr(self._response, "__aiter__"):
            return self._response.__aiter__()
        raise TypeError("Response object is not an async iterator")

    async def __anext__(self):
        if hasattr(self._response, "__anext__"):
            return await self._response.__anext__()
        raise StopAsyncIteration

    def __getattr__(self, name: str) -> Any:
        return getattr(self._response, name)

    @property
    def __class__(self):  # type: ignore
        return self._response.__class__

    def __str__(self) -> str:
        return str(self._response)

    def __repr__(self) -> str:
        return repr(self._response)


def log_headers(response: Any, span: Span):
    cached_value = response.headers.get(X_CACHED_HEADER) or response.headers.get(X_LEGACY_CACHED_HEADER)

    if cached_value:
        span.log(
            metrics={
                "cached": 1 if cached_value.lower() in ["true", "hit"] else 0,
            }
        )


def _convert_data_url_to_attachment(data_url: str, filename: str | None = None) -> Attachment | str:
    """Helper function to convert data URL to an Attachment."""
    data_url_match = re.match(r"^data:([^;]+);base64,(.+)$", data_url)
    if not data_url_match:
        return data_url

    mime_type, base64_data = data_url_match.groups()

    try:
        binary_data = base64.b64decode(base64_data)

        if filename is None:
            extension = mime_type.split("/")[1] if "/" in mime_type else "bin"
            prefix = "image" if mime_type.startswith("image/") else "document"
            filename = f"{prefix}.{extension}"

        attachment = Attachment(data=binary_data, filename=filename, content_type=mime_type)

        return attachment
    except Exception:
        return data_url


def _process_attachments_in_input(input_data: Any) -> Any:
    """Process input to convert data URL images and base64 documents to Attachment objects."""
    if isinstance(input_data, list):
        return [_process_attachments_in_input(item) for item in input_data]

    if isinstance(input_data, dict):
        # Check for OpenAI's image_url format with data URLs
        if (
            input_data.get("type") == "image_url"
            and isinstance(input_data.get("image_url"), dict)
            and isinstance(input_data["image_url"].get("url"), str)
        ):
            processed_url = _convert_data_url_to_attachment(input_data["image_url"]["url"])
            return {
                **input_data,
                "image_url": {
                    **input_data["image_url"],
                    "url": processed_url,
                },
            }

        # Check for OpenAI's file format with data URL (e.g., PDFs)
        if (
            input_data.get("type") == "file"
            and isinstance(input_data.get("file"), dict)
            and isinstance(input_data["file"].get("file_data"), str)
        ):
            file_filename = input_data["file"].get("filename")
            processed_file_data = _convert_data_url_to_attachment(
                input_data["file"]["file_data"],
                filename=file_filename if isinstance(file_filename, str) else None,
            )
            return {
                **input_data,
                "file": {
                    **input_data["file"],
                    "file_data": processed_file_data,
                },
            }

        # Recursively process nested objects
        return {key: _process_attachments_in_input(value) for key, value in input_data.items()}

    return input_data


class ChatCompletionWrapper:
    def __init__(self, create_fn: Callable[..., Any] | None, acreate_fn: Callable[..., Any] | None):
        self.create_fn = create_fn
        self.acreate_fn = acreate_fn

    def create(self, *args: Any, **kwargs: Any) -> Any:
        params = self._parse_params(kwargs)
        stream = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(dict(name="Chat Completion", span_attributes={"type": SpanTypeAttribute.LLM}), params)
        )
        should_end = True

        try:
            start = time.time()
            create_response = self.create_fn(*args, **kwargs)
            if hasattr(create_response, "parse"):
                raw_response = create_response.parse()
                log_headers(create_response, span)
            else:
                raw_response = create_response
            if stream:

                def gen():
                    try:
                        first = True
                        all_results = []
                        for item in raw_response:
                            if first:
                                span.log(
                                    metrics={
                                        "time_to_first_token": time.time() - start,
                                    }
                                )
                                first = False
                            all_results.append(_try_to_dict(item))
                            yield item

                        span.log(**self._postprocess_streaming_results(all_results))
                    finally:
                        span.end()

                should_end = False
                return gen()
            else:
                log_response = _try_to_dict(raw_response)
                metrics = _parse_metrics_from_usage(log_response.get("usage", {}))
                metrics["time_to_first_token"] = time.time() - start
                span.log(
                    metrics=metrics,
                    output=log_response["choices"],
                )
                return raw_response
        finally:
            if should_end:
                span.end()

    async def acreate(self, *args: Any, **kwargs: Any) -> Any:
        params = self._parse_params(kwargs)
        stream = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(dict(name="Chat Completion", span_attributes={"type": SpanTypeAttribute.LLM}), params)
        )
        should_end = True

        try:
            start = time.time()
            create_response = await self.acreate_fn(*args, **kwargs)

            if hasattr(create_response, "parse"):
                raw_response = create_response.parse()
                log_headers(create_response, span)
            else:
                raw_response = create_response

            if stream:

                async def gen():
                    try:
                        first = True
                        all_results = []
                        async for item in raw_response:
                            if first:
                                span.log(
                                    metrics={
                                        "time_to_first_token": time.time() - start,
                                    }
                                )
                                first = False
                            all_results.append(_try_to_dict(item))
                            yield item

                        span.log(**self._postprocess_streaming_results(all_results))
                    finally:
                        span.end()

                should_end = False
                streamer = gen()
                return AsyncResponseWrapper(streamer)
            else:
                log_response = _try_to_dict(raw_response)
                metrics = _parse_metrics_from_usage(log_response.get("usage"))
                metrics["time_to_first_token"] = time.time() - start
                span.log(
                    metrics=metrics,
                    output=log_response["choices"],
                )
                return raw_response
        finally:
            if should_end:
                span.end()

    @classmethod
    def _parse_params(cls, params: dict[str, Any]) -> dict[str, Any]:
        # First, destructively remove span_info
        ret = params.pop("span_info", {})

        # Then, copy the rest of the params
        params = prettify_params(params)
        messages = params.pop("messages", None)

        # Process attachments in input (convert data URLs to Attachment objects)
        processed_input = _process_attachments_in_input(messages)

        return merge_dicts(
            ret,
            {
                "input": processed_input,
                "metadata": {**params, "provider": "openai"},
            },
        )

    @classmethod
    def _postprocess_streaming_results(cls, all_results: list[dict[str, Any]]) -> dict[str, Any]:
        role = None
        content = None
        tool_calls: list[Any] | None = None
        finish_reason = None
        metrics: dict[str, float] = {}
        for result in all_results:
            usage = result.get("usage")
            if usage:
                metrics.update(_parse_metrics_from_usage(usage))

            choices = result["choices"]
            if not choices:
                continue
            delta = choices[0]["delta"]
            if not delta:
                continue

            if role is None and delta.get("role") is not None:
                role = delta.get("role")

            if delta.get("finish_reason") is not None:
                finish_reason = delta.get("finish_reason")

            if delta.get("content") is not None:
                content = (content or "") + delta.get("content")

            if delta.get("tool_calls") is not None:
                delta_tool_calls = delta.get("tool_calls")
                if not delta_tool_calls:
                    continue
                tool_delta = delta_tool_calls[0]

                # pylint: disable=unsubscriptable-object
                if not tool_calls or (tool_delta.get("id") and tool_calls[-1]["id"] != tool_delta.get("id")):
                    tool_calls = (tool_calls or []) + [
                        {
                            "id": delta["tool_calls"][0]["id"],
                            "type": delta["tool_calls"][0]["type"],
                            "function": delta["tool_calls"][0]["function"],
                        }
                    ]
                else:
                    # pylint: disable=unsubscriptable-object
                    tool_calls[-1]["function"]["arguments"] += delta["tool_calls"][0]["function"]["arguments"]

        return {
            "metrics": metrics,
            "output": [
                {
                    "index": 0,
                    "message": {
                        "role": role,
                        "content": content,
                        "tool_calls": tool_calls,
                    },
                    "logprobs": None,
                    "finish_reason": finish_reason,
                }
            ],
        }


class ResponseWrapper:
    def __init__(self, create_fn: Callable[..., Any] | None, acreate_fn: Callable[..., Any] | None, name: str = "openai.responses.create"):
        self.create_fn = create_fn
        self.acreate_fn = acreate_fn
        self.name = name

    def create(self, *args: Any, **kwargs: Any) -> Any:
        params = self._parse_params(kwargs)
        stream = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(dict(name=self.name, span_attributes={"type": SpanTypeAttribute.LLM}), params)
        )
        should_end = True

        try:
            start = time.time()
            create_response = self.create_fn(*args, **kwargs)
            if hasattr(create_response, "parse"):
                raw_response = create_response.parse()
                log_headers(create_response, span)
            else:
                raw_response = create_response
            if stream:
                def gen():
                    try:
                        first = True
                        all_results = []
                        for item in raw_response:
                            if first:
                                span.log(
                                    metrics={
                                        "time_to_first_token": time.time() - start,
                                    }
                                )
                                first = False
                            all_results.append(item)
                            yield item

                        span.log(**self._postprocess_streaming_results(all_results))
                    finally:
                        span.end()

                should_end = False
                return gen()
            else:
                log_response = _try_to_dict(raw_response)
                event_data = self._parse_event_from_result(log_response)
                if "metrics" not in event_data:
                    event_data["metrics"] = {}
                event_data["metrics"]["time_to_first_token"] = time.time() - start
                span.log(**event_data)
                return raw_response
        finally:
            if should_end:
                span.end()

    async def acreate(self, *args: Any, **kwargs: Any) -> Any:
        params = self._parse_params(kwargs)
        stream = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(dict(name=self.name, span_attributes={"type": SpanTypeAttribute.LLM}), params)
        )
        should_end = True

        try:
            start = time.time()
            create_response = await self.acreate_fn(*args, **kwargs)
            if hasattr(create_response, "parse"):
                raw_response = create_response.parse()
                log_headers(create_response, span)
            else:
                raw_response = create_response
            if stream:
                async def gen():
                    try:
                        first = True
                        all_results = []
                        async for item in raw_response:
                            if first:
                                span.log(
                                    metrics={
                                        "time_to_first_token": time.time() - start,
                                    }
                                )
                                first = False
                            all_results.append(item)
                            yield item

                        span.log(**self._postprocess_streaming_results(all_results))
                    finally:
                        span.end()

                should_end = False
                streamer = gen()
                return AsyncResponseWrapper(streamer)
            else:
                log_response = _try_to_dict(raw_response)
                event_data = self._parse_event_from_result(log_response)
                if "metrics" not in event_data:
                    event_data["metrics"] = {}
                event_data["metrics"]["time_to_first_token"] = time.time() - start
                span.log(**event_data)
                return raw_response
        finally:
            if should_end:
                span.end()

    @classmethod
    def _parse_params(cls, params: dict[str, Any]) -> dict[str, Any]:
        # First, destructively remove span_info
        ret = params.pop("span_info", {})

        # Then, copy the rest of the params
        params = prettify_params(params)
        input_data = params.pop("input", None)

        # Process attachments in input (convert data URLs to Attachment objects)
        processed_input = _process_attachments_in_input(input_data)

        return merge_dicts(
            ret,
            {
                "input": processed_input,
                "metadata": {**params, "provider": "openai"},
            },
        )

    @classmethod
    def _parse_event_from_result(cls, result: dict[str, Any]) -> dict[str, Any]:
        """Parse event from response result"""
        data = {"metrics": {}}

        if not result:
            return data

        if "output" in result:
            data["output"] = result["output"]

        metadata = {k: v for k, v in result.items() if k not in ["output", "usage"]}
        if metadata:
            data["metadata"] = metadata

        if "usage" in result:
            data["metrics"] = _parse_metrics_from_usage(result["usage"])

        return data

    @classmethod
    def _postprocess_streaming_results(cls, all_results: list[Any]) -> dict[str, Any]:
        """Process streaming results - minimal version focused on metrics extraction."""
        metrics = {}
        output = []

        for result in all_results:
            usage = getattr(result, "usage", None)
            if not usage and hasattr(result, "type") and result.type == "response.completed" and hasattr(result, "response"):
                # Handle summaries from completed response if present
                if hasattr(result.response, "output") and result.response.output:
                    for output_item in result.response.output:
                        if hasattr(output_item, "summary") and output_item.summary:
                            for item in output:
                                if item.get("id") == output_item.id:
                                    item["summary"] = output_item.summary
                usage = getattr(result.response, "usage", None)

            if usage:
                parsed_metrics = _parse_metrics_from_usage(usage)
                metrics.update(parsed_metrics)

            # Skip processing if result doesn't have a type attribute
            if not hasattr(result, "type"):
                continue

            if result.type == "response.output_item.added":
                item_data = {"id": result.item.id, "type": result.item.type}
                if hasattr(result.item, "role"):
                    item_data["role"] = result.item.role
                output.append(item_data)
                continue

            if result.type == "response.completed":
                if hasattr(result, "response") and hasattr(result.response, "output"):
                    return {
                        "metrics": metrics,
                        "output": result.response.output,
                    }
                continue

            # Handle output_index based updates
            if hasattr(result, "output_index"):
                output_index = result.output_index
                if output_index < len(output):
                    current_output = output[output_index]

                    if result.type == "response.output_item.done":
                        current_output["status"] = result.item.status
                        continue

                    if result.type == "response.output_item.delta":
                        current_output["delta"] = result.delta
                        continue

                    # Handle content_index based updates
                    if hasattr(result, "content_index"):
                        if "content" not in current_output:
                            current_output["content"] = []
                        content_index = result.content_index
                        # Fill any gaps in the content array
                        while len(current_output["content"]) <= content_index:
                            current_output["content"].append({})
                        current_content = current_output["content"][content_index]
                        current_content["type"] = "output_text"
                        if hasattr(result, "delta") and result.delta:
                            current_content["text"] = (current_content.get("text") or "") + result.delta

                        if result.type == "response.output_text.annotation.added":
                            annotation_index = result.annotation_index
                            if "annotations" not in current_content:
                                current_content["annotations"] = []
                            # Fill any gaps in the annotations array
                            while len(current_content["annotations"]) <= annotation_index:
                                current_content["annotations"].append({})
                            current_content["annotations"][annotation_index] = _try_to_dict(result.annotation)

        return {
            "metrics": metrics,
            "output": output,
        }


class BaseWrapper(abc.ABC):
    def __init__(self, create_fn: Callable[..., Any] | None, acreate_fn: Callable[..., Any] | None, name: str):
        self._create_fn = create_fn
        self._acreate_fn = acreate_fn
        self._name = name

    @abc.abstractmethod
    def process_output(self, response: dict[str, Any], span: Span):
        """Process the API response and log relevant information to the span."""
        pass

    def create(self, *args: Any, **kwargs: Any) -> Any:
        params = self._parse_params(kwargs)

        with start_span(
            **merge_dicts(dict(name=self._name, span_attributes={"type": SpanTypeAttribute.LLM}), params)
        ) as span:
            create_response = self._create_fn(*args, **kwargs)
            if hasattr(create_response, "parse"):
                raw_response = create_response.parse()
                log_headers(create_response, span)
            else:
                raw_response = create_response

            log_response = _try_to_dict(raw_response)
            self.process_output(log_response, span)
            return raw_response

    async def acreate(self, *args: Any, **kwargs: Any) -> Any:
        params = self._parse_params(kwargs)

        with start_span(
            **merge_dicts(dict(name=self._name, span_attributes={"type": SpanTypeAttribute.LLM}), params)
        ) as span:
            create_response = await self._acreate_fn(*args, **kwargs)
            if hasattr(create_response, "parse"):
                raw_response = create_response.parse()
                log_headers(create_response, span)
            else:
                raw_response = create_response
            log_response = _try_to_dict(raw_response)
            self.process_output(log_response, span)
            return raw_response

    @classmethod
    def _parse_params(cls, params: dict[str, Any]) -> dict[str, Any]:
        # First, destructively remove span_info
        ret = params.pop("span_info", {})

        params = prettify_params(params)
        input_data = params.pop("input", None)

        # Process attachments in input (convert data URLs to Attachment objects)
        processed_input = _process_attachments_in_input(input_data)

        return merge_dicts(
            ret,
            {
                "input": processed_input,
                "metadata": {**params, "provider": "openai"},
            },
        )


class EmbeddingWrapper(BaseWrapper):
    def __init__(self, create_fn: Callable[..., Any] | None, acreate_fn: Callable[..., Any] | None):
        super().__init__(create_fn, acreate_fn, "Embedding")

    def process_output(self, response: dict[str, Any], span: Span):
        usage = response.get("usage")
        metrics = _parse_metrics_from_usage(usage)
        span.log(
            metrics=metrics,
            # TODO: Add a flag to control whether to log the full embedding vector,
            # possibly w/ JSON compression.
            output={"embedding_length": len(response["data"][0]["embedding"])},
        )


class ModerationWrapper(BaseWrapper):
    def __init__(self, create_fn: Callable[..., Any] | None, acreate_fn: Callable[..., Any] | None):
        super().__init__(create_fn, acreate_fn, "Moderation")

    def process_output(self, response: Any, span: Span):
        span.log(
            output=response["results"],
        )


class ChatCompletionV0Wrapper(NamedWrapper):
    def __init__(self, chat: Any):
        self.__chat = chat
        super().__init__(chat)

    def create(self, *args: Any, **kwargs: Any) -> Any:
        return ChatCompletionWrapper(self.__chat.create, self.__chat.acreate).create(*args, **kwargs)

    async def acreate(self, *args: Any, **kwargs: Any) -> Any:
        return await ChatCompletionWrapper(self.__chat.create, self.__chat.acreate).acreate(*args, **kwargs)


class EmbeddingV0Wrapper(NamedWrapper):
    def __init__(self, embedding: Any):
        self.__embedding = embedding
        super().__init__(embedding)

    def create(self, *args: Any, **kwargs: Any) -> Any:
        return EmbeddingWrapper(self.__embedding.create, self.__embedding.acreate).create(*args, **kwargs)

    async def acreate(self, *args: Any, **kwargs: Any) -> Any:
        return await ChatCompletionWrapper(self.__embedding.create, self.__embedding.acreate).acreate(*args, **kwargs)


class ModerationV0Wrapper(NamedWrapper):
    def __init__(self, moderation: Any):
        self.__moderation = moderation
        super().__init__(moderation)

    def create(self, *args: Any, **kwargs: Any) -> Any:
        return ModerationWrapper(self.__moderation.create, self.__moderation.acreate).create(*args, **kwargs)

    async def acreate(self, *args: Any, **kwargs: Any) -> Any:
        return await ModerationWrapper(self.__moderation.create, self.__moderation.acreate).acreate(*args, **kwargs)


# This wraps 0.*.* versions of the openai module, eg https://github.com/openai/openai-python/tree/v0.28.1
class OpenAIV0Wrapper(NamedWrapper):
    def __init__(self, openai: Any):
        super().__init__(openai)
        self.ChatCompletion = ChatCompletionV0Wrapper(openai.ChatCompletion)
        self.Embedding = EmbeddingV0Wrapper(openai.Embedding)
        self.Moderation = ModerationV0Wrapper(openai.Moderation)


class CompletionsV1Wrapper(NamedWrapper):
    def __init__(self, completions: Any):
        self.__completions = completions
        super().__init__(completions)

    def create(self, *args: Any, **kwargs: Any) -> Any:
        return ChatCompletionWrapper(self.__completions.with_raw_response.create, None).create(*args, **kwargs)


class EmbeddingV1Wrapper(NamedWrapper):
    def __init__(self, embedding: Any):
        self.__embedding = embedding
        super().__init__(embedding)

    def create(self, *args: Any, **kwargs: Any) -> Any:
        return EmbeddingWrapper(self.__embedding.with_raw_response.create, None).create(*args, **kwargs)


class ModerationV1Wrapper(NamedWrapper):
    def __init__(self, moderation: Any):
        self.__moderation = moderation
        super().__init__(moderation)

    def create(self, *args: Any, **kwargs: Any) -> Any:
        return ModerationWrapper(self.__moderation.with_raw_response.create, None).create(*args, **kwargs)


class AsyncCompletionsV1Wrapper(NamedWrapper):
    def __init__(self, completions: Any):
        self.__completions = completions
        super().__init__(completions)

    async def create(self, *args: Any, **kwargs: Any) -> Any:
        response = await ChatCompletionWrapper(None, self.__completions.with_raw_response.create).acreate(
            *args, **kwargs
        )
        return AsyncResponseWrapper(response)


class AsyncEmbeddingV1Wrapper(NamedWrapper):
    def __init__(self, embedding: Any):
        self.__embedding = embedding
        super().__init__(embedding)

    async def create(self, *args: Any, **kwargs: Any) -> Any:
        response = await EmbeddingWrapper(None, self.__embedding.with_raw_response.create).acreate(*args, **kwargs)
        return AsyncResponseWrapper(response)


class AsyncModerationV1Wrapper(NamedWrapper):
    def __init__(self, moderation: Any):
        self.__moderation = moderation
        super().__init__(moderation)

    async def create(self, *args: Any, **kwargs: Any) -> Any:
        response = await ModerationWrapper(None, self.__moderation.with_raw_response.create).acreate(*args, **kwargs)
        return AsyncResponseWrapper(response)


class ChatV1Wrapper(NamedWrapper):
    def __init__(self, chat: Any):
        super().__init__(chat)

        import openai

        if type(chat.completions) == openai.resources.chat.completions.AsyncCompletions:
            self.completions = AsyncCompletionsV1Wrapper(chat.completions)
        else:
            self.completions = CompletionsV1Wrapper(chat.completions)


class ResponsesV1Wrapper(NamedWrapper):
    def __init__(self, responses: Any):
        self.__responses = responses
        super().__init__(responses)

    def create(self, *args: Any, **kwargs: Any) -> Any:
        return ResponseWrapper(self.__responses.with_raw_response.create, None).create(*args, **kwargs)

    def parse(self, *args: Any, **kwargs: Any) -> Any:
        return ResponseWrapper(self.__responses.parse, None, "openai.responses.parse").create(*args, **kwargs)


class AsyncResponsesV1Wrapper(NamedWrapper):
    def __init__(self, responses: Any):
        self.__responses = responses
        super().__init__(responses)

    async def create(self, *args: Any, **kwargs: Any) -> Any:
        response = await ResponseWrapper(None, self.__responses.with_raw_response.create).acreate(*args, **kwargs)
        return AsyncResponseWrapper(response)

    async def parse(self, *args: Any, **kwargs: Any) -> Any:
        response = await ResponseWrapper(None, self.__responses.parse, "openai.responses.parse").acreate(*args, **kwargs)
        return AsyncResponseWrapper(response)


class BetaCompletionsV1Wrapper(NamedWrapper):
    def __init__(self, completions: Any):
        self.__completions = completions
        super().__init__(completions)

    def parse(self, *args: Any, **kwargs: Any) -> Any:
        return ChatCompletionWrapper(self.__completions.parse, None).create(*args, **kwargs)


class AsyncBetaCompletionsV1Wrapper(NamedWrapper):
    def __init__(self, completions: Any):
        self.__completions = completions
        super().__init__(completions)

    async def parse(self, *args: Any, **kwargs: Any) -> Any:
        response = await ChatCompletionWrapper(None, self.__completions.parse).acreate(*args, **kwargs)
        return AsyncResponseWrapper(response)


class BetaChatV1Wrapper(NamedWrapper):
    def __init__(self, chat: Any):
        super().__init__(chat)

        if "AsyncCompletions" in type(chat.completions).__name__:
            self.completions = AsyncBetaCompletionsV1Wrapper(chat.completions)
        else:
            self.completions = BetaCompletionsV1Wrapper(chat.completions)


class BetaV1Wrapper(NamedWrapper):
    def __init__(self, beta: Any):
        super().__init__(beta)
        if hasattr(beta, "chat"):
            self.chat = BetaChatV1Wrapper(beta.chat)


# This wraps 1.*.* versions of the openai module, eg https://github.com/openai/openai-python/tree/v1.1.0
class OpenAIV1Wrapper(NamedWrapper):
    def __init__(self, openai: Any):
        super().__init__(openai)
        import openai as oai

        self.chat = ChatV1Wrapper(openai.chat)

        if hasattr(openai, "beta"):
            self.beta = BetaV1Wrapper(openai.beta)

        if hasattr(openai, "responses"):
            if type(openai.responses) == oai.resources.responses.responses.AsyncResponses:
                self.responses = AsyncResponsesV1Wrapper(openai.responses)
            else:
                self.responses = ResponsesV1Wrapper(openai.responses)

        if type(openai.embeddings) == oai.resources.embeddings.AsyncEmbeddings:
            self.embeddings = AsyncEmbeddingV1Wrapper(openai.embeddings)
        else:
            self.embeddings = EmbeddingV1Wrapper(openai.embeddings)

        if type(openai.moderations) == oai.resources.moderations.AsyncModerations:
            self.moderations = AsyncModerationV1Wrapper(openai.moderations)
        else:
            self.moderations = ModerationV1Wrapper(openai.moderations)


def wrap_openai(openai: Any):
    """
    Wrap the openai module (pre v1) or OpenAI instance (post v1) to add tracing.
    If Braintrust is not configured, nothing will be traced. If this is not an
    `OpenAI` object, this function is a no-op.

    :param openai: The openai module or OpenAI object
    """
    if hasattr(openai, "chat") and hasattr(openai.chat, "completions"):
        return OpenAIV1Wrapper(openai)
    else:
        return OpenAIV0Wrapper(openai)


# OpenAI's representation to Braintrust's representation
TOKEN_NAME_MAP = {
    # chat API
    "total_tokens": "tokens",
    "prompt_tokens": "prompt_tokens",
    "completion_tokens": "completion_tokens",
    # responses API
    "tokens": "tokens",
    "input_tokens": "prompt_tokens",
    "output_tokens": "completion_tokens",
}

TOKEN_PREFIX_MAP = {
    "input": "prompt",
    "output": "completion",
}


def _parse_metrics_from_usage(usage: Any) -> dict[str, Any]:
    # For simplicity, this function handles all the different APIs
    metrics = {}

    if not usage:
        return metrics

    # This might be a dict or a Usage object that can be cast to a dict
    # to a dict
    usage = _try_to_dict(usage)
    if not isinstance(usage, dict):
        return metrics  # unexpected

    for oai_name, value in usage.items():
        if oai_name.endswith("_tokens_details"):
            # handle `_tokens_detail` dicts
            if not isinstance(value, dict):
                continue  # unexpected
            raw_prefix = oai_name[: -len("_tokens_details")]
            prefix = TOKEN_PREFIX_MAP.get(raw_prefix, raw_prefix)
            for k, v in value.items():
                if _is_numeric(v):
                    metrics[f"{prefix}_{k}"] = v
        elif _is_numeric(value):
            name = TOKEN_NAME_MAP.get(oai_name, oai_name)
            metrics[name] = value

    return metrics


def _is_numeric(v):
    return isinstance(v, (int, float, complex)) and not isinstance(v, bool)


def prettify_params(params: dict[str, Any]) -> dict[str, Any]:
    # Filter out NOT_GIVEN parameters
    # https://linear.app/braintrustdata/issue/BRA-2467
    ret = {k: v for k, v in params.items() if not _is_not_given(v)}

    if "response_format" in ret:
        ret["response_format"] = serialize_response_format(ret["response_format"])
    return ret


def _try_to_dict(obj: Any) -> dict[str, Any]:
    if isinstance(obj, dict):
        return obj
    # convert a pydantic object to a dict
    if hasattr(obj, "model_dump") and callable(obj.model_dump):
        try:
            return obj.model_dump()
        except Exception:
            pass
    # deprecated pydantic method, try model_dump first.
    if hasattr(obj, "dict") and callable(obj.dict):
        try:
            return obj.dict()
        except Exception:
            pass
    return obj


def serialize_response_format(response_format: Any) -> Any:
    try:
        from pydantic import BaseModel
    except ImportError:
        return response_format

    if isinstance(response_format, type) and issubclass(response_format, BaseModel):
        return dict(
            type="json_schema",
            json_schema=dict(
                name=response_format.__name__,
                schema=response_format.model_json_schema(),
            ),
        )
    else:
        return response_format


def _is_not_given(value: Any) -> bool:
    if value is None:
        return False
    try:
        # Check by type name and repr to avoid import dependency
        type_name = type(value).__name__
        return type_name == "NotGiven"
    except Exception:
        return False


def _openai_init_wrapper(wrapped, instance, args, kwargs):
    """Wrapper for OpenAI.__init__ that applies tracing after initialization."""
    wrapped(*args, **kwargs)
    _apply_openai_wrapper(instance)


def patch_openai() -> bool:
    """
    Patch OpenAI to add Braintrust tracing globally.

    After calling this, all new OpenAI() and AsyncOpenAI() clients
    will automatically have tracing enabled.

    Returns:
        True if OpenAI was patched (or already patched), False if OpenAI is not installed.

    Example:
        ```python
        import braintrust
        braintrust.patch_openai()

        import openai
        client = openai.OpenAI()
        # All calls are now traced!
        ```
    """
    try:
        import openai

        if getattr(openai, "__braintrust_wrapped__", False):
            return True  # Already patched

        wrap_function_wrapper("openai", "OpenAI.__init__", _openai_init_wrapper)
        wrap_function_wrapper("openai", "AsyncOpenAI.__init__", _openai_init_wrapper)
        openai.__braintrust_wrapped__ = True
        return True

    except ImportError:
        return False


def _apply_openai_wrapper(client):
    """Apply tracing wrapper to an OpenAI client instance in-place."""
    wrapped = wrap_openai(client)
    for attr in ("chat", "responses", "embeddings", "moderations", "beta"):
        if hasattr(wrapped, attr):
            setattr(client, attr, getattr(wrapped, attr))
