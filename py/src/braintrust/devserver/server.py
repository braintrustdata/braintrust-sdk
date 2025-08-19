import asyncio
import json
import traceback
from typing import Any

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, StreamingResponse
from starlette.routing import Route

from ..framework import EvalAsync, Evaluator, SSEProgressEvent
from ..logger import bt_iscoroutinefunction, login_to_state
from ..span_identifier_v3 import parse_parent
from .auth import AuthorizationMiddleware
from .cors import create_cors_middleware
from .dataset import get_dataset
from .eval_hooks import SSEQueue
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


async def run_eval(request: Request) -> JSONResponse | StreamingResponse:
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
        # XXX Cache these logins with an LRU cache
        # XXX Put login in front of /list too
        state = login_to_state(api_key=ctx.token, app_url=ctx.app_origin, org_name=ctx.org_name)
    except Exception as e:
        return JSONResponse({"error": f"Failed to log in: {str(e)}"}, status_code=401)

    # Check if the evaluator exists
    evaluator = _all_evaluators.get(eval_data["name"])
    if not evaluator:
        return JSONResponse({"error": f"Evaluator '{eval_data['name']}' not found"}, status_code=404)

    # Get the dataset if data is provided
    print("DATASET DATA", eval_data.get("data"))
    try:
        dataset = await get_dataset(state, eval_data["data"])
    except Exception as e:
        return JSONResponse({"error": f"Failed to load dataset: {str(e)}"}, status_code=400)

    try:
        print(dataset)
        print(list(dataset))
    except Exception as e:
        print(traceback.format_exc())
        return JSONResponse({"error": f"Failed to process dataset: {str(e)}"}, status_code=400)

    # Check if streaming is requested
    stream = eval_data.get("stream", False)

    # Set up SSE headers for streaming
    sse_queue = SSEQueue()

    async def task(input, hooks):
        print("TASK", evaluator.task)
        if bt_iscoroutinefunction(evaluator.task):
            result = await evaluator.task(input, hooks)
        else:
            result = evaluator.task(input, hooks)
        hooks.report_progress({
            "format": "code",
            "output_type": "completion",
            "event": "json_delta",
            "data": json.dumps(result),
        })
        return result

    async def stream_fn(event: SSEProgressEvent):
        print("STREAMING EVENT", event)
        # if stream:
        #    # Serialize the event and put it in the SSE queue
        #    await sse_queue.put_event("progress", event)

    parent = eval_data.get("parent")
    if parent:
        parent = parse_parent(parent)

    print("STATE", state)
    try:
        eval_task = asyncio.create_task(
            EvalAsync(
                name="worker thead",
                **{
                    **{k: v for (k, v) in evaluator.__dict__.items() if k not in ["eval_name", "project_name"]},
                    # XXX Need to propagate this variable
                    "state": state,
                    "data": dataset,
                    "task": task,
                    "experiment_name": eval_data.get("experiment_name"),
                    "parent": parent,
                    # XXX Need to propagate this variable
                    # "project_id": eval_data.get("project_id"),
                },
            )
        )

        if stream:

            async def event_generator():
                """Generate SSE events from the queue."""
                # Stream events from the queue
                #                while True:
                #                    event = await sse_queue.get()
                #                    if event is None:  # End of stream
                #                        break
                #                    yield event
                yield f"data: {json.dumps({'status': 'started'})}\n\n"

                # Wait for eval to complete
                await eval_task

            return StreamingResponse(
                event_generator(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            )
        else:
            await eval_task
            # Return regular JSON response
            return JSONResponse({
                "success": True,
                "evaluator": eval_data["name"],
                "parameters": eval_data.get("parameters"),
                "stream": stream,
                "dataset_loaded": dataset is not None,
                "message": "Eval execution not yet implemented",
            })
    except Exception as e:
        print(traceback.format_exc())
        return JSONResponse({"error": f"Failed to run evaluation: {str(e)}"}, status_code=500)


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
