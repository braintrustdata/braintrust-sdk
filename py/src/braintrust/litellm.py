import abc
import time
from typing import Any, Callable, Dict, List, Optional

from braintrust.logger import Span, start_span
from braintrust.span_types import SpanTypeAttribute
from braintrust.util import merge_dicts

X_LEGACY_CACHED_HEADER = "x-cached"
X_CACHED_HEADER = "x-bt-cached"


class NamedWrapper:
    def __init__(self, wrapped: Any):
        self.__wrapped = wrapped

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__wrapped, name)


class AsyncResponseWrapper:
    """Wrapper that properly preserves async context manager behavior for LiteLLM responses."""

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


def log_headers(response: Any, span: Span):
    cached_value = response.headers.get(X_CACHED_HEADER) or response.headers.get(X_LEGACY_CACHED_HEADER)

    if cached_value:
        span.log(
            metrics={
                "cached": 1 if cached_value.lower() in ["true", "hit"] else 0,
            }
        )


class CompletionWrapper:
    def __init__(self, completion_fn: Optional[Callable[..., Any]], acompletion_fn: Optional[Callable[..., Any]]):
        self.completion_fn = completion_fn
        self.acompletion_fn = acompletion_fn

    def completion(self, *args: Any, **kwargs: Any) -> Any:
        params = self._parse_params(kwargs)
        stream = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(dict(name="Completion", span_attributes={"type": SpanTypeAttribute.LLM}), params)
        )
        should_end = True

        try:
            start = time.time()
            if self.completion_fn is None:
                raise RuntimeError("Completion function is not available")
            completion_response = self.completion_fn(*args, **kwargs)
            if hasattr(completion_response, "parse"):
                raw_response = completion_response.parse()
                log_headers(completion_response, span)
            else:
                raw_response = completion_response
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

    async def acompletion(self, *args: Any, **kwargs: Any) -> Any:
        params = self._parse_params(kwargs)
        stream = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(dict(name="Completion", span_attributes={"type": SpanTypeAttribute.LLM}), params)
        )
        should_end = True

        try:
            start = time.time()
            if self.acompletion_fn is None:
                raise RuntimeError("Async completion function is not available")
            completion_response = await self.acompletion_fn(*args, **kwargs)

            if hasattr(completion_response, "parse"):
                raw_response = completion_response.parse()
                log_headers(completion_response, span)
            else:
                raw_response = completion_response

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
    def _parse_params(cls, params: Dict[str, Any]) -> Dict[str, Any]:
        # First, destructively remove span_info
        ret = params.pop("span_info", {})

        # Then, copy the rest of the params
        params = prettify_params(params)
        messages = params.pop("messages", None)
        model = params.pop("model", None)
        return merge_dicts(
            ret,
            {
                "input": messages,
                "metadata": {**params, "provider": "litellm", "model": model},
            },
        )

    @classmethod
    def _postprocess_streaming_results(cls, all_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        role = None
        content = None
        tool_calls: Optional[List[Any]] = None
        finish_reason = None
        metrics: Dict[str, float] = {}
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


class BaseWrapper(abc.ABC):
    def __init__(self, create_fn: Optional[Callable[..., Any]], acreate_fn: Optional[Callable[..., Any]], name: str):
        self._create_fn = create_fn
        self._acreate_fn = acreate_fn
        self._name = name

    @abc.abstractmethod
    def process_output(self, response: Dict[str, Any], span: Span):
        """Process the API response and log relevant information to the span."""
        pass

    def create(self, *args: Any, **kwargs: Any) -> Any:
        params = self._parse_params(kwargs)

        with start_span(
            **merge_dicts(dict(name=self._name, span_attributes={"type": SpanTypeAttribute.LLM}), params)
        ) as span:
            if self._create_fn is None:
                raise RuntimeError("Create function is not available")
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
            if self._acreate_fn is None:
                raise RuntimeError("Async create function is not available")
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
    def _parse_params(cls, params: Dict[str, Any]) -> Dict[str, Any]:
        # First, destructively remove span_info
        ret = params.pop("span_info", {})

        params = prettify_params(params)
        input = params.pop("input", None)

        return merge_dicts(
            ret,
            {
                "input": input,
                "metadata": {**params, "provider": "litellm"},
            },
        )


class EmbeddingWrapper(BaseWrapper):
    def __init__(self, embedding_fn: Optional[Callable[..., Any]], aembedding_fn: Optional[Callable[..., Any]]):
        super().__init__(embedding_fn, aembedding_fn, "Embedding")

    def process_output(self, response: Dict[str, Any], span: Span):
        usage = response.get("usage")
        metrics = _parse_metrics_from_usage(usage)
        span.log(
            metrics=metrics,
            # TODO: Add a flag to control whether to log the full embedding vector,
            # possibly w/ JSON compression.
            output={"embedding_length": len(response["data"][0]["embedding"])},
        )


class LiteLLMWrapper(NamedWrapper):

    def __init__(self, litellm_module: Any):
        super().__init__(litellm_module)
        self._completion_wrapper = CompletionWrapper(litellm_module.completion, None)
        self._acompletion_wrapper = CompletionWrapper(None, litellm_module.acompletion)

    def completion(self, *args: Any, **kwargs: Any) -> Any:
        return self._completion_wrapper.completion(*args, **kwargs)
        
    async def acompletion(self, *args: Any, **kwargs: Any) -> Any:
        return await self._acompletion_wrapper.acompletion(*args, **kwargs)



def wrap_litellm(litellm_module: Any):
    """
    Wrap the litellm module to add tracing.
    If Braintrust is not configured, nothing will be traced.

    :param litellm_module: The litellm module
    """
    return LiteLLMWrapper(litellm_module)


# LiteLLM's representation to Braintrust's representation
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


def _parse_metrics_from_usage(usage: Any) -> Dict[str, Any]:
    # For simplicity, this function handles all the different APIs
    metrics = {}

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


def _is_numeric(v):
    return isinstance(v, (int, float, complex))


def prettify_params(params: Dict[str, Any]) -> Dict[str, Any]:
    # Filter out NOT_GIVEN parameters
    # https://linear.app/braintrustdata/issue/BRA-2467
    ret = {k: v for k, v in params.items() if not _is_not_given(v)}

    if "response_format" in ret:
        ret["response_format"] = serialize_response_format(ret["response_format"])
    return ret


def _try_to_dict(obj: Any) -> Dict[str, Any]:
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
