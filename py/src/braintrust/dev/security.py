from typing import Optional

from fastapi import Request
from fastapi.exceptions import HTTPException
from fastapi.security import HTTPBearer
from starlette.status import HTTP_403_FORBIDDEN

from braintrust.logger import login


class BraintrustApiKey(HTTPBearer):
    async def __call__(self, request: Request) -> Optional[str]:  # type: ignore
        auth = await super().__call__(request)
        assert auth is not None

        org_name = request.headers.get("x-bt-org-name")

        try:
            login(api_key=auth.credentials, org_name=org_name)
        except Exception as e:
            if "Invalid API key" in str(e):
                if self.auto_error:
                    raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail=str(e))

        return auth.credentials
