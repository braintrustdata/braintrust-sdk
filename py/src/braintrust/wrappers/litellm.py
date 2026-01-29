from __future__ import annotations

import time
from collections.abc import AsyncGenerator, Callable, Generator
from types import TracebackType
from typing import Any

from braintrust.logger import Span, start_span
from braintrust.span_types import SpanTypeAttribute
from braintrust.util import merge_dicts

X_LEGACY_CACHED_HEADER = "x-cached"
X_CACHED_HEADER = "x-bt-cached"


# LiteLLM's representation to Braintrust's representation
TOKEN_NAME_MAP: dict[str, str] = {
    # chat API
    "total_tokens": "tokens",
    "prompt_tokens": "prompt_tokens",
    "completion_tokens": "completion_tokens",
    # responses API
    "tokens": "tokens",
    "input_tokens": "prompt_tokens",
    "output_tokens": "completion_tokens",
}

TOKEN_PREFIX_MAP: dict[str, str] = {
    "input": "prompt",
    "output": "completion",
}


class NamedWrapper:
    """Wrapper that preserves access to the original wrapped object's attributes."""

    def __init__(self, wrapped: Any) -> None:
        self.__wrapped = wrapped

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__wrapped, name)


class AsyncResponseWrapper:
    """Wrapper that properly preserves async context manager behavior for LiteLLM responses."""

    def __init__(self, response: Any) -> None:
        self._response = response

    async def __aenter__(self) -> Any:
        if hasattr(self._response, "__aenter__"):
            return await self._response.__aenter__()
        return self._response

    async def __aexit__(
        self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: TracebackType | None
    ) -> bool | None:
        if hasattr(self._response, "__aexit__"):
            return await self._response.__aexit__(exc_type, exc_val, exc_tb)
        return None

    def __aiter__(self) -> AsyncGenerator[Any, None]:
        if hasattr(self._response, "__aiter__"):
            return self._response.__aiter__()
        raise TypeError("Response object is not an async iterator")

    async def __anext__(self) -> Any:
        if hasattr(self._response, "__anext__"):
            return await self._response.__anext__()
        raise StopAsyncIteration

    def __getattr__(self, name: str) -> Any:
        return getattr(self._response, name)


class CompletionWrapper:
    """Wrapper for LiteLLM completion functions with tracing support."""

    def __init__(self, completion_fn: Callable[..., Any] | None, acompletion_fn: Callable[..., Any] | None) -> None:
        self.completion_fn = completion_fn
        self.acompletion_fn = acompletion_fn

    def _handle_streaming_response(
        self, raw_response: Any, span: Span, start_time: float, is_async: bool = False
    ) -> AsyncResponseWrapper | Generator[Any, None, None]:
        """Handle streaming response for both sync and async cases."""
        if is_async:

            async def async_gen() -> AsyncGenerator[Any, None]:
                try:
                    first = True
                    all_results: list[dict[str, Any]] = []
                    async for item in raw_response:
                        if first:
                            span.log(metrics={"time_to_first_token": time.time() - start_time})
                            first = False
                        all_results.append(_try_to_dict(item))
                        yield item

                    span.log(**self._postprocess_streaming_results(all_results))
                finally:
                    span.end()

            streamer = async_gen()
            return AsyncResponseWrapper(streamer)
        else:

            def sync_gen() -> Generator[Any, None, None]:
                try:
                    first = True
                    all_results: list[dict[str, Any]] = []
                    for item in raw_response:
                        if first:
                            span.log(metrics={"time_to_first_token": time.time() - start_time})
                            first = False
                        all_results.append(_try_to_dict(item))
                        yield item

                    span.log(**self._postprocess_streaming_results(all_results))
                finally:
                    span.end()

            return sync_gen()

    def _handle_non_streaming_response(self, raw_response: Any, span: Span, start_time: float) -> Any:
        """Handle non-streaming response."""
        log_response = _try_to_dict(raw_response)
        metrics = _parse_metrics_from_usage(log_response.get("usage", {}))
        metrics["time_to_first_token"] = time.time() - start_time
        span.log(metrics=metrics, output=log_response["choices"])
        return raw_response

    def completion(self, *args: Any, **kwargs: Any) -> Any:
        """Sync completion with tracing."""
        updated_span_payload = _update_span_payload_from_params(kwargs, input_key="messages")
        is_streaming = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(
                dict(name="Completion", span_attributes={"type": SpanTypeAttribute.LLM}), updated_span_payload
            )
        )
        should_end = True

        try:
            start = time.time()
            completion_response = self.completion_fn(*args, **kwargs)
            # if hasattr(completion_response, "parse"):
            #     raw_response = completion_response.parse()
            #     log_headers(completion_response, span)
            # else:
            #     raw_response = completion_response

            if is_streaming:
                should_end = False
                return self._handle_streaming_response(completion_response, span, start, is_async=False)
            else:
                return self._handle_non_streaming_response(completion_response, span, start)
        finally:
            if should_end:
                span.end()

    async def acompletion(self, *args: Any, **kwargs: Any) -> Any:
        """Async completion with tracing."""
        updated_span_payload = _update_span_payload_from_params(kwargs, input_key="messages")
        is_streaming = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(
                dict(name="Completion", span_attributes={"type": SpanTypeAttribute.LLM}), updated_span_payload
            )
        )
        should_end = True

        try:
            start = time.time()
            completion_response = await self.acompletion_fn(*args, **kwargs)

            # if hasattr(completion_response, "parse"):
            #     raw_response = completion_response.parse()
            #     log_headers(completion_response, span)
            # else:
            #     raw_response = completion_response

            if is_streaming:
                should_end = False
                return self._handle_streaming_response(completion_response, span, start, is_async=True)
            else:
                return self._handle_non_streaming_response(completion_response, span, start)
        finally:
            if should_end:
                span.end()

    @classmethod
    def _postprocess_streaming_results(cls, all_results: list[dict[str, Any]]) -> dict[str, Any]:
        """Process streaming results to extract final response."""
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
                            "id": tool_delta.get("id"),
                            "type": tool_delta.get("type"),
                            "function": tool_delta.get("function"),
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
                    "message": {"role": role, "content": content, "tool_calls": tool_calls},
                    "logprobs": None,
                    "finish_reason": finish_reason,
                }
            ],
        }


class ResponsesWrapper:
    """Wrapper for LiteLLM responses functions with tracing support."""

    def __init__(self, responses_fn: Callable[..., Any] | None, aresponses_fn: Callable[..., Any] | None) -> None:
        self.responses_fn = responses_fn
        self.aresponses_fn = aresponses_fn

    def _handle_streaming_response(
        self, raw_response: Any, span: Span, start_time: float, is_async: bool = False
    ) -> AsyncResponseWrapper | Generator[Any, None, None]:
        """Handle streaming response for both sync and async cases."""
        if is_async:

            async def async_gen() -> AsyncGenerator[Any, None]:
                try:
                    first = True
                    all_results: list[dict[str, Any]] = []
                    async for item in raw_response:
                        if first:
                            span.log(metrics={"time_to_first_token": time.time() - start_time})
                            first = False
                        all_results.append(item)
                        yield item

                    span.log(**self._postprocess_streaming_results(all_results))
                finally:
                    span.end()

            streamer = async_gen()
            return AsyncResponseWrapper(streamer)
        else:

            def sync_gen() -> Generator[Any, None, None]:
                try:
                    first = True
                    all_results: list[dict[str, Any]] = []
                    for item in raw_response:
                        if first:
                            span.log(metrics={"time_to_first_token": time.time() - start_time})
                            first = False
                        all_results.append(item)
                        yield item

                    span.log(**self._postprocess_streaming_results(all_results))
                finally:
                    span.end()

            return sync_gen()

    def _handle_non_streaming_response(self, raw_response: Any, span: Span, start_time: float) -> Any:
        """Handle non-streaming response."""
        log_response = _try_to_dict(raw_response)
        metrics = _parse_metrics_from_usage(log_response.get("usage", {}))
        metrics["time_to_first_token"] = time.time() - start_time
        span.log(metrics=metrics, output=log_response["output"])
        return raw_response

    def responses(self, *args: Any, **kwargs: Any) -> Any:
        """Sync responses with tracing."""
        updated_span_payload = _update_span_payload_from_params(kwargs, input_key="input")
        is_streaming = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(dict(name="Response", span_attributes={"type": SpanTypeAttribute.LLM}), updated_span_payload)
        )
        should_end = True

        try:
            start = time.time()
            response = self.responses_fn(*args, **kwargs)

            if is_streaming:
                should_end = False
                return self._handle_streaming_response(response, span, start, is_async=False)
            else:
                return self._handle_non_streaming_response(response, span, start)
        finally:
            if should_end:
                span.end()

    async def aresponses(self, *args: Any, **kwargs: Any) -> Any:
        """Async completion with tracing."""
        updated_span_payload = _update_span_payload_from_params(kwargs, input_key="input")
        is_streaming = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(dict(name="Response", span_attributes={"type": SpanTypeAttribute.LLM}), updated_span_payload)
        )
        should_end = True

        try:
            start = time.time()
            response = await self.aresponses_fn(*args, **kwargs)

            if is_streaming:
                should_end = False
                return self._handle_streaming_response(response, span, start, is_async=True)
            else:
                return self._handle_non_streaming_response(response, span, start)
        finally:
            if should_end:
                span.end()

    @classmethod
    def _postprocess_streaming_results(cls, all_results: list[Any]) -> dict[str, Any]:
        role = None
        content = None
        tool_calls = None
        finish_reason = None
        metrics = {}
        output = []
        for result in all_results:
            usage = None
            if hasattr(result, "usage"):
                usage = getattr(result, "usage")
            elif result.type == "response.completed" and hasattr(result, "response"):
                usage = getattr(result.response, "usage")

            if usage:
                parsed_metrics = _parse_metrics_from_usage(usage)
                metrics.update(parsed_metrics)

            if result.type == "response.output_item.added":
                output.append({"id": result.item.get("id"), "type": result.item.get("type")})
                continue

            if not hasattr(result, "output_index"):
                continue

            output_index = result.output_index
            current_output = output[output_index]
            if result.type == "response.output_item.done":
                current_output["status"] = result.item.get("status")
                continue

            if result.type == "response.output_item.delta":
                current_output["delta"] = result.delta
                continue

            if hasattr(result, "content_index"):
                if "content" not in current_output:
                    current_output["content"] = []
                content_index = result.content_index
                if content_index == len(current_output["content"]):
                    current_output["content"].append({})
                current_content = current_output["content"][content_index]
                if hasattr(result, "delta") and result.delta:
                    current_content["text"] = (current_content.get("text") or "") + result.delta

                if result.type == "response.output_text.annotation.added":
                    annotation_index = result.annotation_index
                    if "annotations" not in current_content:
                        current_content["annotations"] = []
                    if annotation_index == len(current_content["annotations"]):
                        current_content["annotations"].append({})
                    current_content["annotations"][annotation_index] = _try_to_dict(result.annotation)

        return {
            "metrics": metrics,
            "output": output,
        }


class EmbeddingWrapper:
    """Wrapper for LiteLLM embedding functions."""

    def __init__(self, embedding_fn: Callable[..., Any] | None) -> None:
        self.embedding_fn = embedding_fn

    def embedding(self, *args: Any, **kwargs: Any) -> Any:
        """Sync embedding with tracing."""
        updated_span_payload = _update_span_payload_from_params(kwargs, input_key="input")

        with start_span(
            **merge_dicts(
                dict(name="Embedding", span_attributes={"type": SpanTypeAttribute.LLM}), updated_span_payload
            )
        ) as span:
            embedding_response = self.embedding_fn(*args, **kwargs)
            log_response = _try_to_dict(embedding_response)
            self._process_output(log_response, span)
            return embedding_response

    def _process_output(self, response: dict[str, Any], span: Span) -> None:
        """Process embedding response and log metrics."""
        usage = response.get("usage")
        metrics = _parse_metrics_from_usage(usage)
        span.log(
            metrics=metrics,
            # TODO: Add a flag to control whether to log the full embedding vector,
            # possibly w/ JSON compression.
            output={"embedding_length": len(response["data"][0]["embedding"])},
        )


class ModerationWrapper:
    """Wrapper for LiteLLM moderation functions."""

    def __init__(self, moderation_fn: Callable[..., Any] | None) -> None:
        self.moderation_fn = moderation_fn

    def moderation(self, *args: Any, **kwargs: Any) -> Any:
        """Sync moderation with tracing."""
        updated_span_payload = _update_span_payload_from_params(kwargs, input_key="input")

        with start_span(
            **merge_dicts(
                dict(name="Moderation", span_attributes={"type": SpanTypeAttribute.LLM}), updated_span_payload
            )
        ) as span:
            moderation_response = self.moderation_fn(*args, **kwargs)
            log_response = _try_to_dict(moderation_response)
            self._process_output(log_response, span)
            return moderation_response

    def _process_output(self, response: dict[str, Any], span: Span) -> None:
        """Process moderation response and log metrics."""
        usage = response.get("usage")
        metrics = _parse_metrics_from_usage(usage)
        span.log(
            metrics=metrics,
            # TODO: Add a flag to control whether to log the full embedding vector,
            # possibly w/ JSON compression.
            output=response["results"],
        )


class LiteLLMWrapper(NamedWrapper):
    """Main wrapper for the LiteLLM module."""

    def __init__(self, litellm_module: Any) -> None:
        super().__init__(litellm_module)
        self._completion_wrapper = CompletionWrapper(litellm_module.completion, None)
        self._acompletion_wrapper = CompletionWrapper(None, litellm_module.acompletion)
        self._responses_wrapper = ResponsesWrapper(litellm_module.responses, None)
        self._aresponses_wrapper = ResponsesWrapper(None, litellm_module.aresponses)
        self._embedding_wrapper = EmbeddingWrapper(litellm_module.embedding)
        self._moderation_wrapper = ModerationWrapper(litellm_module.moderation)

    def completion(self, *args: Any, **kwargs: Any) -> Any:
        """Sync completion with tracing."""
        return self._completion_wrapper.completion(*args, **kwargs)

    async def acompletion(self, *args: Any, **kwargs: Any) -> Any:
        """Async completion with tracing."""
        return await self._acompletion_wrapper.acompletion(*args, **kwargs)

    def responses(self, *args: Any, **kwargs: Any) -> Any:
        """Sync responses with tracing."""
        return self._responses_wrapper.responses(*args, **kwargs)

    async def aresponses(self, *args: Any, **kwargs: Any) -> Any:
        """Async responses with tracing."""
        return await self._aresponses_wrapper.aresponses(*args, **kwargs)

    def embedding(self, *args: Any, **kwargs: Any) -> Any:
        """Sync embedding with tracing."""
        return self._embedding_wrapper.embedding(*args, **kwargs)

    def moderation(self, *args: Any, **kwargs: Any) -> Any:
        """Sync moderation with tracing."""
        return self._moderation_wrapper.moderation(*args, **kwargs)


def wrap_litellm(litellm_module: Any) -> LiteLLMWrapper:
    """
    Wrap the litellm module to add tracing.
    If Braintrust is not configured, nothing will be traced.

    :param litellm_module: The litellm module
    :return: Wrapped litellm module with tracing
    """
    return LiteLLMWrapper(litellm_module)


def _update_span_payload_from_params(params: dict[str, Any], input_key: str = "input") -> dict[str, Any]:
    """Updates the span payload with the parameters into LiteLLM's completion/acompletion methods."""
    span_info_d = params.pop("span_info", {})

    params = prettify_params(params)
    input_data = params.pop(input_key, None)
    model = params.pop("model", None)

    return merge_dicts(
        span_info_d,
        {"input": input_data, "metadata": {**params, "provider": "litellm", "model": model}},
    )


def _parse_metrics_from_usage(usage: Any) -> dict[str, Any]:
    """Parse usage metrics from API response."""
    # For simplicity, this function handles all the different APIs
    metrics: dict[str, Any] = {}

    if not usage:
        return metrics

    # This might be a dict or a Usage object that can be cast to a dict
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


def _is_numeric(v: Any) -> bool:
    """Check if a value is numeric."""
    return isinstance(v, (int, float, complex))


def prettify_params(params: dict[str, Any]) -> dict[str, Any]:
    """Clean up parameters by filtering out NOT_GIVEN values and serializing response_format."""
    # Filter out NOT_GIVEN parameters
    # https://linear.app/braintrustdata/issue/BRA-2467
    # ret = {k: v for k, v in params.items() if not _is_not_given(v)}
    ret = {k: v for k, v in params.items()}

    if "response_format" in ret:
        ret["response_format"] = serialize_response_format(ret["response_format"])
    return ret


def _try_to_dict(obj: Any) -> dict[str, Any] | Any:
    """Try to convert an object to a dictionary."""
    if isinstance(obj, dict):
        return obj
    # convert a pydantic object to a dict
    if hasattr(obj, "model_dump") and callable(obj.model_dump):
        try:
            result = obj.model_dump()
            if isinstance(result, dict):
                return result
        except Exception:
            pass
    # deprecated pydantic method, try model_dump first.
    if hasattr(obj, "dict") and callable(obj.dict):
        try:
            result = obj.dict()
            if isinstance(result, dict):
                return result
        except Exception:
            pass
    return obj


def serialize_response_format(response_format: Any) -> Any:
    """Serialize response format for logging."""
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


def patch_litellm() -> bool:
    """
    Patch LiteLLM to add Braintrust tracing.

    This wraps litellm.completion and litellm.acompletion to automatically
    create Braintrust spans with detailed token metrics, timing, and costs.

    Returns:
        True if LiteLLM was patched (or already patched), False if LiteLLM is not installed.

    Example:
        ```python
        import braintrust
        braintrust.patch_litellm()

        import litellm
        from braintrust import init_logger

        logger = init_logger(project="my-project")
        response = litellm.completion(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "Hello"}]
        )
        ```
    """
    try:
        import litellm

        if not hasattr(litellm, "_braintrust_wrapped"):
            wrapped = wrap_litellm(litellm)
            litellm.completion = wrapped.completion
            litellm.acompletion = wrapped.acompletion
            litellm.responses = wrapped.responses
            litellm.aresponses = wrapped.aresponses
            litellm._braintrust_wrapped = True
        return True
    except ImportError:
        return False
