import time

from .logger import current_span


class ChatCompletionWrapper:
    def __init__(self, chat):
        self.chat = chat

    def create(self, *args, **kwargs):
        params = self._parse_params(kwargs)
        stream = kwargs.get("stream", False)
        with current_span().start_span(name="OpenAI Chat Completion", **params) as span:
            start = time.time()
            response = self.chat.create(*args, **kwargs)
            if stream:

                def gen():
                    first = True
                    all_results = []
                    for item in response:
                        if first:
                            span.log(
                                metrics={
                                    "time_to_first_token": time.time() - start,
                                }
                            )
                            first = False
                        all_results.append(item)
                        yield item
                    span.log(output=all_results)

                return (x for x in gen())
            else:
                span.log(
                    metrics={
                        "tokens": response["usage"]["total_tokens"],
                        "prompt_tokens": response["usage"]["prompt_tokens"],
                        "completion_tokens": response["usage"]["completion_tokens"],
                    },
                    output=response["choices"][0],
                )
                return response

    async def acreate(self, *args, **kwargs):
        params = self._parse_params(kwargs)
        stream = kwargs.get("stream", False)
        with current_span().start_span(name="OpenAI Chat Completion", **params) as span:
            start = time.time()
            response = await self.chat.create(*args, **kwargs)
            if stream:

                async def gen():
                    first = True
                    all_results = []
                    async for item in response:
                        if first:
                            span.log(
                                metrics={
                                    "time_to_first_token": time.time() - start,
                                }
                            )
                            first = False
                        all_results.append(item)
                        yield item
                    span.log(output=all_results)

                return (x async for x in gen())
            else:
                span.log(
                    metrics={
                        "tokens": response["usage"]["total_tokens"],
                        "prompt_tokens": response["usage"]["prompt_tokens"],
                        "completion_tokens": response["usage"]["completion_tokens"],
                    },
                    output=response["choices"][0],
                )
                return response

    @classmethod
    def _parse_params(cls, params):
        params = {**params}
        messages = params.pop("messages", None)
        return {
            "input": messages,
            "metadata": params,
        }

    def __getattr__(self, name):
        return getattr(self.chat, name)


class OpenAIWrapper:
    def __init__(self, openai):
        self.openai = openai
        self.ChatCompletion = ChatCompletionWrapper(openai.ChatCompletion)

    def __getattr__(self, name):
        return getattr(self.openai, name)


def wrap_openai(openai):
    return OpenAIWrapper(openai)
