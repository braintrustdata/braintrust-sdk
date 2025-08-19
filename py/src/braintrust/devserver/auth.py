from dataclasses import dataclass
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

ORIGIN_HEADER = "origin"
BRAINTRUST_AUTH_TOKEN_HEADER = "x-bt-auth-token"


@dataclass
class RequestContext:
    app_origin: Optional[str]
    token: Optional[str]


def extract_allowed_origin(origin: Optional[str]) -> Optional[str]:
    """Extract and validate the origin header."""
    # This should use the same check_origin logic from cors.py
    from .cors import check_origin

    if origin and check_origin(origin):
        return origin
    return None


def parse_braintrust_auth_header(headers: dict) -> Optional[str]:
    """Parse the authorization token from headers."""
    # Check x-bt-auth-token first
    token = headers.get(BRAINTRUST_AUTH_TOKEN_HEADER)
    if token:
        return token

    # Check Authorization header
    auth_header = headers.get("authorization")
    if auth_header:
        # Handle Bearer token format
        if auth_header.lower().startswith("bearer "):
            return auth_header[7:]  # Remove "Bearer " prefix
        return auth_header

    return None


class AuthorizationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        try:
            # Create context
            ctx = RequestContext(
                app_origin=extract_allowed_origin(request.headers.get(ORIGIN_HEADER)),
                token=None,
            )

            # Extract token from headers
            if "authorization" in request.headers or BRAINTRUST_AUTH_TOKEN_HEADER in request.headers:
                token_text = parse_braintrust_auth_header(dict(request.headers))
                if not token_text:
                    return JSONResponse({"error": "Invalid authorization token format"}, status_code=400)

                # Handle "null" token
                if token_text.lower() != "null":
                    ctx.token = token_text

            # Attach context to request state
            request.state.ctx = ctx

            # Proceed to next middleware/handler
            response = await call_next(request)
            return response

        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)
