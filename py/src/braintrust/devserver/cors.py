import os
import re
from collections.abc import Awaitable, Callable
from typing import Any

# CORS configuration
ALLOWED_ORIGINS: list[str | re.Pattern] = [
    "https://www.braintrust.dev",
    "https://www.braintrustdata.com",
    re.compile(r"https://.*\.preview\.braintrust\.dev"),
]

ALLOWED_HEADERS = [
    "Content-Type",
    "X-Amz-Date",
    "Authorization",
    "X-Api-Key",
    "X-Amz-Security-Token",
    "x-bt-auth-token",
    "x-bt-parent",
    "x-bt-org-name",
    "x-bt-project-id",
    "x-bt-stream-fmt",
    "x-bt-use-cache",
    "x-stainless-os",
    "x-stainless-lang",
    "x-stainless-package-version",
    "x-stainless-runtime",
    "x-stainless-runtime-version",
    "x-stainless-arch",
]

EXPOSED_HEADERS = [
    "x-bt-cursor",
    "x-bt-found-existing-experiment",
    "x-bt-span-id",
    "x-bt-span-export",
]


def check_origin(origin: str) -> bool:
    """Check if the origin is allowed."""
    if not origin:
        return False

    # Check environment variables
    whitelisted_origin = os.environ.get("WHITELISTED_ORIGIN")
    if whitelisted_origin and origin == whitelisted_origin:
        return True

    braintrust_app_url = os.environ.get("BRAINTRUST_APP_URL")
    if braintrust_app_url and origin == braintrust_app_url:
        return True

    # Check static and regex patterns
    for allowed in ALLOWED_ORIGINS:
        if isinstance(allowed, str) and origin == allowed:
            return True
        elif isinstance(allowed, re.Pattern) and allowed.match(origin):
            return True

    return False


def create_cors_middleware() -> type:
    """Create a Starlette CORS middleware class."""

    class CORSMiddleware:
        def __init__(self, app: Any) -> None:
            self.app = app

        async def __call__(
            self,
            scope: dict[str, Any],
            receive: Callable[[], Awaitable[dict[str, Any]]],
            send: Callable[[dict[str, Any]], Awaitable[None]],
        ) -> None:
            if scope["type"] == "http":
                headers = dict(scope["headers"])
                origin = headers.get(b"origin", b"").decode("utf-8")

                # Handle OPTIONS requests
                if scope["method"] == "OPTIONS":

                    async def send_options_wrapper(message: dict[str, Any]) -> None:
                        if message["type"] == "http.response.start":
                            headers_dict = dict(message.get("headers", []))

                            if origin and check_origin(origin):
                                headers_dict[b"access-control-allow-origin"] = origin.encode()
                                headers_dict[b"access-control-allow-methods"] = (
                                    b"GET, POST, PUT, DELETE, OPTIONS, PATCH"
                                )
                                headers_dict[b"access-control-allow-headers"] = ", ".join(ALLOWED_HEADERS).encode()
                                headers_dict[b"access-control-expose-headers"] = ", ".join(EXPOSED_HEADERS).encode()
                                headers_dict[b"access-control-allow-credentials"] = b"true"
                                headers_dict[b"access-control-max-age"] = b"86400"

                                # Handle private network access
                                if headers.get(b"access-control-request-private-network"):
                                    headers_dict[b"access-control-allow-private-network"] = b"true"

                            message["headers"] = list(headers_dict.items())

                        await send(message)

                    # Send empty response for OPTIONS
                    await send_options_wrapper(
                        {
                            "type": "http.response.start",
                            "status": 200,
                            "headers": [],
                        }
                    )
                    await send(
                        {
                            "type": "http.response.body",
                            "body": b"",
                        }
                    )
                    return

                # For other requests, add CORS headers if origin is valid
                async def send_wrapper(message: dict[str, Any]) -> None:
                    if message["type"] == "http.response.start" and origin and check_origin(origin):
                        headers_dict = dict(message.get("headers", []))

                        # Add CORS headers
                        headers_dict[b"access-control-allow-origin"] = origin.encode()
                        headers_dict[b"access-control-allow-methods"] = b"GET, POST, PUT, DELETE, OPTIONS, PATCH"
                        headers_dict[b"access-control-allow-headers"] = ", ".join(ALLOWED_HEADERS).encode()
                        headers_dict[b"access-control-expose-headers"] = ", ".join(EXPOSED_HEADERS).encode()
                        headers_dict[b"access-control-allow-credentials"] = b"true"
                        headers_dict[b"access-control-max-age"] = b"86400"

                        # Handle private network access
                        if headers.get(b"access-control-request-private-network"):
                            headers_dict[b"access-control-allow-private-network"] = b"true"

                        message["headers"] = list(headers_dict.items())

                    await send(message)

                await self.app(scope, receive, send_wrapper)
            else:
                await self.app(scope, receive, send)

    return CORSMiddleware
