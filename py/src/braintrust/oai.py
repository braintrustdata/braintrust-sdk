from braintrust.oai_wrappers.non_proxy_wrappers import OpenAIV0NonProxyWrapper, OpenAIV1NonProxyWrapper
from braintrust.oai_wrappers.proxy_wrappers import PROXY_SENTINEL, openai_v1_proxy_wrapper


def wrap_openai(openai, proxy_base_url=PROXY_SENTINEL, proxy_api_key=PROXY_SENTINEL):
    """
    Wrap the openai module (pre v1) or OpenAI instance (post v1) to add tracing.

    :param openai: The openai module or OpenAI object.
    :param proxy_base_url: For post v1 clients only. Use the Braintrust proxy (https://github.com/braintrustdata/braintrust-proxy) as the base URL. When left as the default sentinel value, the URL is obtained from the environment variable `BRAINTRUST_PROXY_URL`, defaulting to `https://braintrustproxy.com/v[api_version]`. Pass `None` to leave the original base URL intact and use the non-proxy wrapper, or pass a string to use a custom URL.
    :param proxy_api_key: For post v1 clients using the proxy wrapper (`proxy_base_url` is not None). When left as the default sentinel value, the API key is set from `BRAINTRUST_API_KEY` if available. Pass `None` to leave the original API key intact, or pass a string to use a custom API key.
    :returns: The wrapped `OpenAI` object.
    """
    if hasattr(openai, "chat") and hasattr(openai.chat, "completions"):
        if proxy_base_url is None:
            return OpenAIV1NonProxyWrapper(openai)
        else:
            return openai_v1_proxy_wrapper(openai, proxy_base_url, proxy_api_key)
    else:
        return OpenAIV0NonProxyWrapper(openai)
