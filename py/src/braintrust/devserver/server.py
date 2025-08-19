from typing import Any, Dict

import uvicorn
from starlette.applications import Starlette
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.routing import Route

from ..framework import Evaluator
from .auth import AuthorizationMiddleware
from .cors import create_cors_middleware

_all_evaluators: Dict[str, Evaluator[Any, Any]] = {}


async def index(request):
    return PlainTextResponse("Hello, world!")


async def list_evaluators(request):
    # Access the context if needed
    ctx = getattr(request.state, "ctx", None)
    if ctx:
        print(f"Request from origin: {ctx.app_origin}, token: {ctx.token}")

    evaluator_list = {
        k: {
            "parameters": {},
            "scores": [],
        }
        for k, v in _all_evaluators.items()
    }

    print(f"Available evaluators: {evaluator_list}")

    # Return the hardcoded response for now
    return JSONResponse(evaluator_list)


async def run_eval(request):
    pass


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
