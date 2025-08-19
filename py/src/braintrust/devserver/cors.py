import os
import re
from typing import List, Union

from bottle import hook, request, response

# CORS configuration
ALLOWED_ORIGINS: List[Union[str, re.Pattern]] = [
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


@hook("after_request")
def enable_cors():
    """Add CORS headers to every response."""
    origin = request.environ.get("HTTP_ORIGIN")

    # Only set CORS headers if origin is valid
    if origin and check_origin(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
        response.headers["Access-Control-Allow-Headers"] = ", ".join(ALLOWED_HEADERS)
        response.headers["Access-Control-Expose-Headers"] = ", ".join(EXPOSED_HEADERS)
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Max-Age"] = "86400"

        # Handle Access-Control-Request-Private-Network
        if request.headers.get("access-control-request-private-network"):
            response.headers["Access-Control-Allow-Private-Network"] = "true"
