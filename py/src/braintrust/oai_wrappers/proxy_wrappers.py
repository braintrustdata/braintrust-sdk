"""Wrappers for the openAI client which go through the Braintrust proxy."""
import os
from typing import Union

from braintrust.logger import _internal_get_global_state, current_span

_httpx = None


def get_httpx():
    global _httpx
    if _httpx is None:
        import httpx

        _httpx = httpx
    return _httpx


class _ProxySentinel:
    pass


PROXY_SENTINEL = _ProxySentinel()


def _get_proxy_base_url_sentinel(version: int):
    return os.environ.get("BRAINTRUST_PROXY_URL", f"https://braintrustproxy.com/v{version}")


def _get_proxy_api_key_sentinel():
    return os.environ.get("BRAINTRUST_API_KEY")


# Defined in
# https://github.com/braintrustdata/braintrust-proxy/blob/main/packages/proxy/src/tracing.ts.
PARENT_SPAN_HEADER = "x-bt-parent-span"
SERIALIZED_STATE_HEADER = "x-bt-serialized-state"


def wrap_build_request(orig_build_request):
    def ret(*args, **kwargs):
        req = orig_build_request(*args, **kwargs)
        req.headers[PARENT_SPAN_HEADER] = current_span().serialize()
        req.headers[SERIALIZED_STATE_HEADER] = _internal_get_global_state().serialize_login_info()
        return req

    return ret


# This wraps 1.*.* versions of the openai module, eg
# https://github.com/openai/openai-python/tree/v1.1.0.
def openai_v1_proxy_wrapper(
    openai, proxy_base_url: Union[_ProxySentinel, str], proxy_api_key: Union[_ProxySentinel, str]
):

    if proxy_base_url == PROXY_SENTINEL:
        proxy_base_url = _get_proxy_base_url_sentinel(version=1)
    if proxy_base_url is not None:
        openai.base_url = get_httpx().URL(proxy_base_url)

    if proxy_api_key == PROXY_SENTINEL:
        proxy_api_key = _get_proxy_api_key_sentinel()
    if proxy_api_key is not None:
        openai.api_key = proxy_api_key

    openai._client.build_request = wrap_build_request(openai._client.build_request)
    return openai
