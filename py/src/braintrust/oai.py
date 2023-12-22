from typing import Optional, Union

from braintrust.oai_wrappers.non_proxy_wrappers import OpenAIV0NonProxyWrapper, OpenAIV1NonProxyWrapper
from braintrust.oai_wrappers.proxy_wrappers import openai_v1_proxy_wrapper


def wrap_openai(openai, use_proxy: Union[None, str, bool] = None, api_key: Optional[str] = None):
    """
    Wrap the openai module (pre v1) or OpenAI instance (post v1) to add tracing.

    :param openai: The openai module or OpenAI object.
    :param use_proxy: By default (or if `False`), the wrapper does not trace through the proxy. Pass `True` to use the Braintrust proxy as the base URL. The URL is obtained from the environment variable `BRAINTRUST_PROXY_URL`, defaulting to `https://braintrustproxy.com/v1. Pass a string to use a custom proxy URL.
    :param api_key: Only used when `use_proxy` is set. By default, the API key is set from `BRAINTRUST_API_KEY` if available. Pass a string to use a custom API key.
    :returns: The wrapped `OpenAI` object.
    """
    if hasattr(openai, "chat") and hasattr(openai.chat, "completions"):
        if use_proxy:
            return openai_v1_proxy_wrapper(openai, use_proxy, api_key)
        else:
            return OpenAIV1NonProxyWrapper(openai)
    else:
        return OpenAIV0NonProxyWrapper(openai)
