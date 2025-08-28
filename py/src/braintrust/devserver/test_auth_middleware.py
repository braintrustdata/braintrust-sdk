import asyncio
import sys
from io import StringIO
from unittest.mock import AsyncMock, patch

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from .auth import AuthorizationMiddleware, RequestContext
from .server import CheckAuthorizedMiddleware, list_evaluators, run_eval


class TestAuthMiddleware:
    def test_check_authorized_middleware_missing_token(self):
        """Test that missing token returns 401."""

        async def test_endpoint(request):
            return JSONResponse({"success": True})

        app = Starlette(routes=[Route("/test", endpoint=test_endpoint)])
        app.add_middleware(CheckAuthorizedMiddleware)
        app.add_middleware(AuthorizationMiddleware)

        client = TestClient(app)
        response = client.get("/test")

        assert response.status_code == 401
        assert response.json() == {"error": "Unauthorized"}

    @patch('braintrust.devserver.server.cached_login')
    def test_check_authorized_middleware_login_failure(self, mock_cached_login):
        """Test that login failure logs to stderr and returns 401."""
        mock_cached_login.side_effect = Exception("Login failed")

        async def test_endpoint(request):
            return JSONResponse({"success": True})

        app = Starlette(routes=[Route("/test", endpoint=test_endpoint)])
        app.add_middleware(CheckAuthorizedMiddleware)
        app.add_middleware(AuthorizationMiddleware)

        # Capture stderr
        captured_stderr = StringIO()
        with patch.object(sys, 'stderr', captured_stderr):
            client = TestClient(app)
            response = client.get("/test", headers={"x-bt-auth-token": "invalid-token"})

        # Should return generic 401 error
        assert response.status_code == 401
        assert response.json() == {"error": "Unauthorized"}

        # Should log authorization error to stderr
        stderr_output = captured_stderr.getvalue()
        assert "Authorization error:" in stderr_output

    def test_list_evaluators_without_state(self):
        """Test that list_evaluators logs to stderr when state is not initialized."""

        async def mock_list_evaluators():
            # Create a mock request with context but no state
            request = AsyncMock()
            request.state.ctx = RequestContext(
                app_origin="http://example.com",
                token="valid-token",
                org_name=None,
                state=None  # This is the key - no state initialized
            )

            # Capture stderr
            captured_stderr = StringIO()
            with patch.object(sys, 'stderr', captured_stderr):
                response = await list_evaluators(request)

            # Should return 401
            assert response.status_code == 401
            assert response.body == b'{"error":"Unauthorized"}'

            # Should log to stderr
            stderr_output = captured_stderr.getvalue()
            assert "Braintrust state not initialized in request" in stderr_output

        # Run the async test
        asyncio.run(mock_list_evaluators())

    def test_run_eval_without_state(self):
        """Test that run_eval logs to stderr when state is not initialized."""

        async def mock_run_eval():
            # Create a mock request with context but no state
            request = AsyncMock()
            request.state.ctx = RequestContext(
                app_origin="http://example.com",
                token="valid-token",
                org_name=None,
                state=None  # This is the key - no state initialized
            )
            # Mock the request body parsing
            request.body.return_value = b'{"name": "test-eval"}'

            # Capture stderr
            captured_stderr = StringIO()
            with patch.object(sys, 'stderr', captured_stderr):
                with patch('braintrust.devserver.server.parse_eval_body') as mock_parse:
                    mock_parse.return_value = {"name": "test-eval"}
                    response = await run_eval(request)

            # Should return 401
            assert response.status_code == 401
            assert response.body == b'{"error":"Unauthorized"}'

            # Should log to stderr
            stderr_output = captured_stderr.getvalue()
            assert "Braintrust state not initialized in request" in stderr_output

        # Run the async test
        asyncio.run(mock_run_eval())
