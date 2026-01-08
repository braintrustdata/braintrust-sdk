import asyncio
import json
import sys
import textwrap
from typing import Any

try:
    import uvicorn
    from starlette.applications import Starlette
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import JSONResponse, PlainTextResponse, StreamingResponse
    from starlette.routing import Route
except ModuleNotFoundError as e:
    raise ModuleNotFoundError(
        textwrap.dedent(
            f"""\
            At least one dependency not found: {str(e)!r}
            It is possible that braintrust was installed without the CLI dependencies. Run:

              pip install 'braintrust[cli]'

            to install braintrust with the CLI dependencies (make sure to quote 'braintrust[cli]')."""
        )
    )

from ..framework import EvalAsync, EvalScorer, Evaluator, ExperimentSummary, SSEProgressEvent
from ..generated_types import FunctionId
from ..logger import BraintrustState, bt_iscoroutinefunction
from ..parameters import parameters_to_json_schema, validate_parameters
from ..span_identifier_v4 import parse_parent
from .auth import AuthorizationMiddleware
from .cache import cached_login
from .cors import create_cors_middleware
from .dataset import get_dataset
from .eval_hooks import SSEQueue
from .schemas import ValidationError, parse_eval_body

_all_evaluators: dict[str, Evaluator[Any, Any]] = {}


class CheckAuthorizedMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, allowed_org_name: str | None = None):
        super().__init__(app)
        self.allowed_org_name = allowed_org_name
        self.protected_paths = ["/list", "/eval"]

    async def dispatch(self, request: Request, call_next):
        # Only check auth for protected paths
        if request.url.path in self.protected_paths:
            ctx = getattr(request.state, "ctx", None)
            if not ctx or not ctx.token:
                return JSONResponse({"error": "Unauthorized"}, status_code=401)

            try:
                org_name = ctx.org_name

                if not org_name:
                    return JSONResponse({"error": "Missing x-bt-org-name header"}, status_code=400)

                if self.allowed_org_name and self.allowed_org_name != org_name:
                    error_message = f"Org '{org_name}' is not allowed. Only org '{self.allowed_org_name}' is allowed."
                    return JSONResponse({"error": error_message}, status_code=403)

                state = await cached_login(
                    api_key=ctx.token,
                    app_url=ctx.app_origin,
                    org_name=org_name,
                )
                ctx.state = state
            except Exception as e:
                print(f"Authorization error: {e}", file=sys.stderr)
                return JSONResponse({"error": "Unauthorized"}, status_code=401)

        return await call_next(request)


async def index(request: Request) -> PlainTextResponse:
    return PlainTextResponse("Hello, world!")


async def list_evaluators(request: Request) -> JSONResponse:
    # Get the authenticated context
    ctx = getattr(request.state, "ctx", None)

    if not ctx or not ctx.token:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    if not ctx.state:
        print("Braintrust state not initialized in request", file=sys.stderr)
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    evaluator_list = {}
    for name, evaluator in _all_evaluators.items():
        evaluator_list[name] = {
            "parameters": parameters_to_json_schema(evaluator.parameters) if evaluator.parameters else {},
            "scores": [{"name": getattr(score, "name", f"score_{i}")} for i, score in enumerate(evaluator.scores)],
        }

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

    if not ctx or not ctx.token:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    if not ctx.state:
        print("Braintrust state not initialized in request", file=sys.stderr)
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    state = ctx.state

    # Check if the evaluator exists
    evaluator = _all_evaluators.get(eval_data["name"])
    if not evaluator:
        return JSONResponse({"error": f"Evaluator '{eval_data['name']}' not found"}, status_code=404)

    # Get the dataset if data is provided
    try:
        dataset = await get_dataset(state, eval_data["data"])
    except Exception as e:
        print(f"Error loading dataset: {e}", file=sys.stderr)
        return JSONResponse({"error": f"Failed to load dataset: {str(e)}"}, status_code=400)

    # Validate parameters if provided
    validated_parameters = None
    if evaluator.parameters:
        request_parameters = eval_data.get("parameters", {})
        try:
            validated_parameters = validate_parameters(request_parameters, evaluator.parameters)
        except ValueError as e:
            return JSONResponse({"error": f"Invalid parameters: {str(e)}"}, status_code=400)

    # Check if streaming is requested
    stream = eval_data.get("stream", False)

    # Set up SSE headers for streaming
    sse_queue = SSEQueue()

    async def task(input, hooks):
        if bt_iscoroutinefunction(evaluator.task):
            result = await evaluator.task(input, hooks)
        else:
            result = evaluator.task(input, hooks)
        hooks.report_progress(
            {
                "format": "code",
                "output_type": "completion",
                "event": "json_delta",
                "data": json.dumps(result),
            }
        )
        return result

    def on_start_fn(summary: ExperimentSummary):
        """Synchronous stream function that schedules async writes."""
        if stream:
            summary_json = format_summary(summary)
            # Use create_task to schedule the async write without blocking
            asyncio.create_task(sse_queue.put_event("start", json.dumps(summary_json)))

    def stream_fn(event: SSEProgressEvent):
        """Synchronous stream function that schedules async writes."""
        if stream:
            # Use create_task to schedule the async write without blocking
            asyncio.create_task(sse_queue.put_event("progress", event))

    parent = eval_data.get("parent")
    if parent:
        parent = parse_parent(parent)

    # Override evaluator parameters with validated ones if provided
    eval_kwargs = {k: v for (k, v) in evaluator.__dict__.items() if k not in ["eval_name", "project_name"]}
    if validated_parameters is not None:
        eval_kwargs["parameters"] = validated_parameters

    try:
        eval_task = asyncio.create_task(
            EvalAsync(
                name=eval_data["name"],
                **{
                    **eval_kwargs,
                    "state": state,
                    "scores": evaluator.scores
                    + [
                        make_scorer(state, score["name"], score["function_id"], ctx.project_id)
                        for score in eval_data.get("scores", [])
                    ],
                    "stream": stream_fn,
                    "on_start": on_start_fn,
                    "data": dataset,
                    "task": task,
                    "experiment_name": eval_data.get("experiment_name"),
                    "parent": parent,
                    "project_id": eval_data.get("project_id"),
                },
            )
        )

        if stream:

            async def event_generator():
                """Generate SSE events from the queue."""

                # Create a task to run the eval and signal completion
                async def run_and_complete():
                    try:
                        result = await eval_task
                        await sse_queue.put_event("summary", format_summary(result.summary))
                    except Exception as e:
                        print(f"Error running eval: {e}", file=sys.stderr)
                        await sse_queue.put_event("error", str(e))
                    finally:
                        # Send done event and close the queue
                        await sse_queue.put_event("done", "")
                        await sse_queue.close()

                # Start the eval task
                asyncio.create_task(run_and_complete())

                # Stream events from the queue
                while True:
                    event = await sse_queue.get()
                    if event is None:  # End of stream
                        break
                    yield event

            return StreamingResponse(
                event_generator(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            )
        else:
            # Wait for the evaluation to complete
            result = await eval_task
            # Return the summary as JSON
            return JSONResponse(format_summary(result.summary))
    except Exception as e:
        print(f"Failed to run evaluation: {e}", file=sys.stderr)
        return JSONResponse({"error": f"Failed to run evaluation: {str(e)}"}, status_code=500)


def create_app(evaluators: list[Evaluator[Any, Any]], org_name: str | None = None):
    """Create and configure the Starlette app for the dev server.

    Args:
        evaluators: List of evaluators to make available
        org_name: Optional organization name to restrict access to

    Returns:
        Configured Starlette app
    """
    global _all_evaluators
    _all_evaluators = {evaluator.eval_name: evaluator for evaluator in evaluators}

    routes = [
        Route("/", endpoint=index),
        Route("/list", endpoint=list_evaluators),
        Route("/eval", endpoint=run_eval, methods=["POST"]),
    ]

    app = Starlette(routes=routes)
    # Add middlewares in reverse order (last added is executed first)
    app.add_middleware(CheckAuthorizedMiddleware, allowed_org_name=org_name)
    app.add_middleware(AuthorizationMiddleware)
    app.add_middleware(create_cors_middleware())

    return app


def run_dev_server(
    evaluators: list[Evaluator[Any, Any]], host: str = "localhost", port: int = 8300, org_name: str | None = None
):
    """Start the dev server.

    Args:
        evaluators: List of evaluators to make available
        host: Host to bind to
        port: Port to bind to
        org_name: Optional organization name to restrict access to
    """
    print(f"Starting dev server on http://{host}:{port}")
    print(f"Loaded {len(evaluators)} evaluator(s): {[e.eval_name for e in evaluators]}")

    app = create_app(evaluators, org_name=org_name)
    uvicorn.run(app, host=host, port=port)


def snake_to_camel(snake_str: str) -> str:
    """Convert snake_case to camelCase."""
    components = snake_str.split("_")
    return components[0] + "".join(x.title() for x in components[1:]) if components else snake_str


def make_scorer(
    state: BraintrustState, name: str, score: FunctionId, project_id: str | None = None
) -> EvalScorer[Any, Any]:
    def scorer_fn(input, output, expected, metadata):
        request = {
            **score,
            "input": dict(input=input, output=output, expected=expected, metadata=metadata),
            "parent": state.current_span.get().export(),
            "stream": False,
            "mode": "auto",
            "strict": True,
        }
        headers = {"Accept": "application/json"}
        if project_id:
            headers["x-bt-project-id"] = project_id
        result = state.proxy_conn().post("function/invoke", json=request, headers=headers)
        result.raise_for_status()
        data = result.json()
        return data

    scorer_fn.__name__ = name
    return scorer_fn


def format_summary(summary: ExperimentSummary) -> dict:
    """Format the summary for JSON serialization with camelCase keys."""
    return {snake_to_camel(k): v for (k, v) in summary.as_dict().items()}
