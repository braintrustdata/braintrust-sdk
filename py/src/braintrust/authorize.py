from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Pattern, Union


@dataclass
class RequestContext:
    """Context for an incoming request, including origin and authentication info."""

    app_origin: Optional[str] = None
    token: Optional[str] = None


StaticOrigin = Union[str, Pattern[str]]


def extract_allowed_origin(origin: Optional[str], allowed_origins: List[StaticOrigin]) -> Optional[str]:
    """
    Check if the provided origin is allowed based on the allowed_origins list.
    Returns the matched origin or None if no match found.
    """
    if origin is None:
        return None

    for allowed_origin in allowed_origins:
        if isinstance(allowed_origin, str):
            if origin.lower() == allowed_origin.lower():
                return origin
        elif isinstance(allowed_origin, Pattern):
            if allowed_origin.match(origin.lower()):
                return origin

    return None


def check_origin(headers: Dict[str, str], allowed_origins: List[StaticOrigin]) -> Optional[str]:
    """
    Check if the request origin is allowed.
    Returns the matched origin if found, otherwise None.
    """
    origin = headers.get("Origin") or headers.get("origin")
    return extract_allowed_origin(origin, allowed_origins)


def authorize_request(headers: Dict[str, str]) -> RequestContext:
    """
    Extract and validate the origin and authorization token from request headers.
    Returns a RequestContext with the validated information.
    """
    context = RequestContext()

    # Check allowed origins
    allowed_origins = [
        "https://www.braintrust.dev",
        "https://www.braintrustdata.com",
        re.compile(r"^https://.*\.braintrustdata\.com$"),
        re.compile(r"^https://.*\.braintrust\.dev$"),
    ]

    # Add additional origins from environment variable if specified
    additional_origins = os.environ.get("BRAINTRUST_CORS_ORIGINS")
    if additional_origins:
        allowed_origins.extend(additional_origins.split(","))

    # Check if origin is allowed
    context.app_origin = check_origin(headers, allowed_origins)

    # Extract token from various header formats
    auth_header = headers.get("Authorization") or headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        context.token = auth_header[7:].strip()  # Remove "Bearer " prefix
    else:
        api_key = headers.get("X-Api-Key") or headers.get("x-api-key")
        if api_key:
            context.token = api_key

    # Normalize token
    if context.token == "null" or context.token == "":
        context.token = None

    return context


def check_authorized(context: RequestContext) -> bool:
    """
    Verify that the request is properly authorized with a valid token.
    Returns True if authorized, False otherwise.
    """
    return context.token is not None
