from typing import Any

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.routing import Route

from braintrust.logger import login_to_state

from ..framework import Evaluator
from .auth import AuthorizationMiddleware
from .cors import create_cors_middleware
from .schemas import ValidationError, parse_eval_body

_all_evaluators: dict[str, Evaluator[Any, Any]] = {}


async def index(request: Request) -> PlainTextResponse:
    return PlainTextResponse("Hello, world!")


async def list_evaluators(request: Request) -> JSONResponse:
    # Access the context if needed
    ctx = getattr(request.state, "ctx", None)
    if ctx:
        print(f"Request from origin: {ctx.app_origin}, token: {ctx.token}")

    evaluator_list = {
        k: {
            # XXX Fill this in :)
            "parameters": {},
            "scores": [],
        }
        for k in _all_evaluators.keys()
    }

    print(f"Available evaluators: {evaluator_list}")

    # Return the hardcoded response for now
    return JSONResponse(evaluator_list)


async def run_eval(request: Request) -> JSONResponse:
    """Handle eval execution requests."""
    try:
        # Get request body
        body = await request.body()

        # Parse and validate the request
        eval_data = parse_eval_body(body)
    except ValidationError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": f"Internal error: {str(e)}"}, status_code=500)

    # Access the context if needed
    ctx = getattr(request.state, "ctx", None)

    try:
        state = login_to_state(api_key=ctx.token, app_url=ctx.app_origin)
    except Exception as e:
        return JSONResponse({"error": f"Failed to log in: {str(e)}"}, status_code=401)

    # Check if the evaluator exists
    evaluator = _all_evaluators.get(eval_data["name"])
    if not evaluator:
        return JSONResponse({"error": f"Evaluator '{eval_data['name']}' not found"}, status_code=404)

    print(evaluator)

    # TODO: Actually run the evaluator with the provided parameters
    # For now, just return a success response
    return JSONResponse({
        "success": True,
        "evaluator": eval_data["name"],
        "parameters": eval_data.get("parameters"),
        "stream": eval_data.get("stream", False),
        "message": "Eval execution not yet implemented",
    })


def run_dev_server(evaluators: list[Evaluator[Any, Any]], host: str = "localhost", port: int = 8300):
    global _all_evaluators
    _all_evaluators = {evaluator.eval_name: evaluator for evaluator in evaluators}

    print(f"Starting dev server on http://{host}:{port}")
    print(f"Loaded {len(_all_evaluators)} evaluator(s): {list(_all_evaluators.keys())}")

    routes = [
        Route("/", endpoint=index),
        Route("/list", endpoint=list_evaluators),
        Route("/eval", endpoint=run_eval, methods=["POST"]),
    ]

    app = Starlette(routes=routes)
    # Add middlewares in reverse order (last added is executed first)
    app.add_middleware(AuthorizationMiddleware)
    app.add_middleware(create_cors_middleware())

    uvicorn.run(app, host=host, port=port)
