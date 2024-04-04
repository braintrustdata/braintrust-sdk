import time

from braintrust_core.span_types import SpanTypeAttribute
from braintrust_core.util import merge_dicts

from .logger import start_span


class NamedWrapper:
    def __init__(self, wrapped):
        self.__wrapped = wrapped

    def __getattr__(self, name):
        return getattr(self.__wrapped, name)


def postprocess_streaming_results(all_results):
    role = None
    content = None
    tool_calls = None
    finish_reason = None
    for result in all_results:
        delta = result["choices"][0]["delta"]
        if role is None and delta.get("role") is not None:
            role = delta.get("role")

        if delta.get("finish_reason") is not None:
            finish_reason = delta.get("finish_reason")

        if delta.get("content") is not None:
            content = (content or "") + delta.get("content")
        if delta.get("tool_calls") is not None:
            if tool_calls is None:
                tool_calls = [
                    {
                        "id": delta["tool_calls"][0]["id"],
                        "type": delta["tool_calls"][0]["type"],
                        "function": delta["tool_calls"][0]["function"],
                    }
                ]
            else:
                tool_calls[0]["function"]["arguments"] += delta["tool_calls"][0]["function"]["arguments"]

    return [
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
    ]


class ChatCompletionWrapper:
    def __init__(self, create_fn, acreate_fn):
        self.create_fn = create_fn
        self.acreate_fn = acreate_fn

    def create(self, *args, **kwargs):
        params = self._parse_params(kwargs)
        stream = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(dict(name="Chat Completion", span_attributes={"type": SpanTypeAttribute.LLM}), params)
        )
        should_end = True

        try:
            start = time.time()
            raw_response = self.create_fn(*args, **kwargs)
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
                            all_results.append(item if isinstance(item, dict) else item.dict())
                            yield item

                        span.log(output=postprocess_streaming_results(all_results))
                    finally:
                        span.end()

                should_end = False
                return gen()
            else:
                log_response = raw_response if isinstance(raw_response, dict) else raw_response.dict()
                span.log(
                    metrics={
                        "time_to_first_token": time.time() - start,
                        "tokens": log_response["usage"]["total_tokens"],
                        "prompt_tokens": log_response["usage"]["prompt_tokens"],
                        "completion_tokens": log_response["usage"]["completion_tokens"],
                    },
                    output=log_response["choices"],
                )
                return raw_response
        finally:
            if should_end:
                span.end()

    async def acreate(self, *args, **kwargs):
        params = self._parse_params(kwargs)
        stream = kwargs.get("stream", False)

        span = start_span(
            **merge_dicts(dict(name="Chat Completion", span_attributes={"type": SpanTypeAttribute.LLM}), params)
        )
        should_end = True

        try:
            start = time.time()
            raw_response = await self.acreate_fn(*args, **kwargs)
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
                            all_results.append(item if isinstance(item, dict) else item.dict())
                            yield item

                        span.log(output=postprocess_streaming_results(all_results))
                    finally:
                        span.end()

                should_end = False
                return gen()
            else:
                log_response = raw_response if isinstance(raw_response, dict) else raw_response.dict()
                span.log(
                    metrics={
                        "tokens": log_response["usage"]["total_tokens"],
                        "prompt_tokens": log_response["usage"]["prompt_tokens"],
                        "completion_tokens": log_response["usage"]["completion_tokens"],
                    },
                    output=log_response["choices"],
                )
                return raw_response
        finally:
            if should_end:
                span.end()

    @classmethod
    def _parse_params(cls, params):
        # First, destructively remove span_info
        ret = params.pop("span_info", {})

        # Then, copy the rest of the params
        params = {**params}
        messages = params.pop("messages", None)
        return merge_dicts(
            ret,
            {
                "input": messages,
                "metadata": params,
            },
        )


class EmbeddingWrapper:
    def __init__(self, create_fn, acreate_fn):
        self.create_fn = create_fn
        self.acreate_fn = acreate_fn

    def create(self, *args, **kwargs):
        params = self._parse_params(kwargs)

        with start_span(
            **merge_dicts(dict(name="Embedding", span_attributes={"type": SpanTypeAttribute.LLM}), params)
        ) as span:
            raw_response = self.create_fn(*args, **kwargs)
            log_response = raw_response if isinstance(raw_response, dict) else raw_response.dict()
            span.log(
                metrics={
                    "tokens": log_response["usage"]["total_tokens"],
                    "prompt_tokens": log_response["usage"]["prompt_tokens"],
                },
                # TODO: Add a flag to control whether to log the full embedding vector,
                # possibly w/ JSON compression.
                output={"embedding_length": len(log_response["data"][0]["embedding"])},
            )
            return raw_response

    async def acreate(self, *args, **kwargs):
        params = self._parse_params(kwargs)

        with start_span(
            **merge_dicts(dict(name="Embedding", span_attributes={"type": SpanTypeAttribute.LLM}), params)
        ) as span:
            raw_response = await self.acreate_fn(*args, **kwargs)
            log_response = raw_response if isinstance(raw_response, dict) else raw_response.dict()
            span.log(
                metrics={
                    "tokens": log_response["usage"]["total_tokens"],
                    "prompt_tokens": log_response["usage"]["prompt_tokens"],
                },
                # TODO: Add a flag to control whether to log the full embedding vector,
                # possibly w/ JSON compression.
                output={"embedding_length": len(log_response["data"][0]["embedding"])},
            )
            return raw_response

    @classmethod
    def _parse_params(cls, params):
        # First, destructively remove span_info
        ret = params.pop("span_info", {})

        params = {**params}
        input = params.pop("input", None)

        return merge_dicts(
            ret,
            {
                "input": input,
                "metadata": params,
            },
        )


class ChatCompletionV0Wrapper(NamedWrapper):
    def __init__(self, chat):
        self.__chat = chat
        super().__init__(chat)

    def create(self, *args, **kwargs):
        return ChatCompletionWrapper(self.__chat.create, self.__chat.acreate).create(*args, **kwargs)

    async def acreate(self, *args, **kwargs):
        return await ChatCompletionWrapper(self.__chat.create, self.__chat.acreate).acreate(*args, **kwargs)


class EmbeddingV0Wrapper(NamedWrapper):
    def __init__(self, embedding):
        self.__embedding = embedding
        super().__init__(embedding)

    def create(self, *args, **kwargs):
        return EmbeddingWrapper(self.__embedding.create, self.__embedding.acreate).create(*args, **kwargs)

    async def acreate(self, *args, **kwargs):
        return await ChatCompletionWrapper(self.__embedding.create, self.__embedding.acreate).acreate(*args, **kwargs)


# This wraps 0.*.* versions of the openai module, eg https://github.com/openai/openai-python/tree/v0.28.1
class OpenAIV0Wrapper(NamedWrapper):
    def __init__(self, openai):
        super().__init__(openai)
        self.ChatCompletion = ChatCompletionV0Wrapper(openai.ChatCompletion)
        self.Embedding = EmbeddingV0Wrapper(openai.Embedding)


class CompletionsV1Wrapper(NamedWrapper):
    def __init__(self, completions):
        self.__completions = completions
        super().__init__(completions)

    def create(self, *args, **kwargs):
        return ChatCompletionWrapper(self.__completions.create, None).create(*args, **kwargs)


class EmbeddingV1Wrapper(NamedWrapper):
    def __init__(self, embedding):
        self.__embedding = embedding
        super().__init__(embedding)

    def create(self, *args, **kwargs):
        return EmbeddingWrapper(self.__embedding.create, None).create(*args, **kwargs)


class AsyncCompletionsV1Wrapper(NamedWrapper):
    def __init__(self, completions):
        self.__completions = completions
        super().__init__(completions)

    async def create(self, *args, **kwargs):
        return await ChatCompletionWrapper(None, self.__completions.create).acreate(*args, **kwargs)


class AsyncEmbeddingV1Wrapper(NamedWrapper):
    def __init__(self, embedding):
        self.__embedding = embedding
        super().__init__(embedding)

    async def create(self, *args, **kwargs):
        return await EmbeddingWrapper(None, self.__embedding.create).acreate(*args, **kwargs)


class ChatV1Wrapper(NamedWrapper):
    def __init__(self, chat):
        super().__init__(chat)

        import openai

        if type(chat.completions) == openai.resources.chat.completions.AsyncCompletions:
            self.completions = AsyncCompletionsV1Wrapper(chat.completions)
        else:
            self.completions = CompletionsV1Wrapper(chat.completions)


# This wraps 1.*.* versions of the openai module, eg https://github.com/openai/openai-python/tree/v1.1.0
class OpenAIV1Wrapper(NamedWrapper):
    def __init__(self, openai):
        super().__init__(openai)
        import openai as oai

        self.chat = ChatV1Wrapper(openai.chat)

        if type(openai.embeddings) == oai.resources.embeddings.AsyncEmbeddings:
            self.embeddings = AsyncEmbeddingV1Wrapper(openai.embeddings)
        else:
            self.embeddings = EmbeddingV1Wrapper(openai.embeddings)


def wrap_openai(openai):
    """
    Wrap the openai module (pre v1) or OpenAI instance (post v1) to add tracing.
    If Braintrust is not configured, this is a no-op.

    :param openai: The openai module or OpenAI object
    """
    if hasattr(openai, "chat") and hasattr(openai.chat, "completions"):
        return OpenAIV1Wrapper(openai)
    else:
        return OpenAIV0Wrapper(openai)
