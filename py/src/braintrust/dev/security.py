from functools import lru_cache
from typing import Optional

from fastapi import Request
from fastapi.exceptions import HTTPException
from fastapi.security import HTTPBearer
from starlette.status import HTTP_401_UNAUTHORIZED

from braintrust.logger import BraintrustState, login_to_state


class BraintrustApiKey(HTTPBearer):
    async def __call__(self, request: Request) -> Optional[BraintrustState]:  # type: ignore
        auth = await super().__call__(request)
        assert auth is not None

        org_name = request.headers.get("x-bt-org-name")

        try:
            state = cached_login(api_key=auth.credentials, org_name=org_name)
        except Exception as e:
            error = e
            if "Invalid API key" in str(e):
                error = HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail=str(e))
            raise error

        return state


@lru_cache(maxsize=32)
def cached_login(api_key: str, org_name: Optional[str] = None):
    return login_to_state(api_key=api_key, org_name=org_name)
