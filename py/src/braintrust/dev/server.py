import asyncio
import json
from dataclasses import asdict
from typing import Annotated, Any, AsyncGenerator, List, Optional, Union, cast

import uvicorn
from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.params import Depends
from fastapi.requests import Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware

from braintrust.cli.eval.models import (
    EvalRequest,
    ListEvals,
    LoadedEvaluator,
)
from braintrust.dev.dataset import get_dataset
from braintrust.dev.errors import format_validation_errors
from braintrust.dev.security import BraintrustApiKey
from braintrust.dev.utils import get_any
from braintrust.framework import (
    EvalAsync,
    EvalHooks,
    EvalResultWithSummary,
    Evaluator,
    ReporterDef,
    call_user_fn,
    scorer_name,
)
from braintrust.framework import report_evaluator_result as base_report_evaluator_result
from braintrust.http_headers import BT_CURSOR_HEADER, BT_FOUND_EXISTING_HEADER, BT_PARENT
from braintrust.logger import Dataset
from braintrust.util import eprint


def run_dev_server(evaluators: List[LoadedEvaluator], *, host: str = "localhost", port: int = 8300):
    app = FastAPI()

    @app.exception_handler(Exception)
    async def global_exception_handler(_: Request, exc: Exception):  # pyright: ignore[reportUnusedFunction]
        return JSONResponse(
            status_code=500,
            content=jsonable_encoder({"error": str(exc)}),
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException):  # pyright: ignore[reportUnusedFunction]
        return JSONResponse(
            status_code=exc.status_code,
            content=jsonable_encoder({"error": exc.detail}),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(  # pyright: ignore[reportUnusedFunction]
        _: Request, exc: RequestValidationError
    ):
        return JSONResponse(
            status_code=400,
            content=jsonable_encoder({"error": format_validation_errors(exc.errors())}),
        )

    all_evaluators: dict[str, Evaluator[Any, Any]] = {}

    for evaluator in evaluators:
        all_evaluators[evaluator.evaluator.eval_name] = evaluator.evaluator  # pyright: ignore[reportUnknownMemberType]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["GET", "PATCH", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "X-Amz-Date",
            "Authorization",
            "X-Api-Key",
            "X-Amz-Security-Token",
            "x-bt-auth-token",
            BT_PARENT,
            # These are eval-specific
            "x-bt-org-name",
            "x-bt-stream-fmt",
            "x-bt-use-cache",
            "x-stainless-os",
            "x-stainless-lang",
            "x-stainless-package-version",
            "x-stainless-runtime",
            "x-stainless-runtime-version",
            "x-stainless-arch",
        ],
        expose_headers=[
            BT_CURSOR_HEADER,
            BT_FOUND_EXISTING_HEADER,
            "x-bt-span-id",
            "x-bt-span-export",
        ],
        max_age=86400,
    )

    api_key_scheme = BraintrustApiKey()

    @app.get("/")
    async def health():  # pyright: ignore[reportUnusedFunction]
        return {"status": "ok"}

    @app.get("/list")
    async def list_evals(api_key: Annotated[str, Depends(api_key_scheme)]):  # pyright: ignore[reportUnusedFunction]
        eval_defs: dict[str, ListEvals] = {}
        for name, evaluator in all_evaluators.items():
            eval_defs[name] = cast(
                ListEvals,
                {
                    # "parameters": None,  # TODO: no parameters in evaluator
                    "scores": [{"name": scorer_name(score, i)} for i, score in enumerate(evaluator.scores)],
                },
            )

        return eval_defs

    @app.post("/eval")
    async def run_eval(  # pyright: ignore[reportUnusedFunction]
        api_key: Annotated[str, Depends(api_key_scheme)], eval: EvalRequest
    ):
        try:
            evaluator = all_evaluators[eval.name]
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Evaluator {eval.name} not found")

        # XXX: as of writing all python evaluators do not support parameters
        parameters = getattr(evaluator, "parameters", None)
        if parameters is None and eval.parameters:
            raise HTTPException(status_code=400, detail="Evaluator does not support parameters")

        # TODO: more elaborate parameter validation (see validateParameters in TS)
        if parameters is not None and eval.parameters is None:
            raise HTTPException(status_code=400, detail="Evaluator requires parameters")

        resolved_dataset = get_dataset(eval.data)
        eval_data = call_evaluator_data(resolved_dataset)

        eprint(f"Starting eval {evaluator.eval_name}")

        serialized = asdict(evaluator)

        if eval.stream:
            message_queue: asyncio.Queue[Optional[str]] = asyncio.Queue()

            async def stream_eval() -> AsyncGenerator[str, None]:
                try:
                    serialized_task = serialized.pop("task", None)
                    if not serialized_task:
                        raise HTTPException(status_code=400, detail="Evaluator requires task")

                    async def task(input: Any, hooks: EvalHooks[Any]):
                        result = serialized_task(input, hooks)
                        await message_queue.put(
                            serialize_sse_event(
                                "progress",
                                json.dumps(
                                    {
                                        "format": "code",
                                        "output_type": "completion",
                                        "event": "json_delta",
                                        "data": json.dumps(result),
                                        "id": hooks.span.id,
                                        "name": "basic [experimentName=My basic eval]",
                                        "object_type": "task",
                                    }
                                ),
                            )
                        )
                        return result

                    # remove extras
                    serialized.pop("name", None)
                    serialized.pop("data", None)
                    serialized.pop("scores", None)
                    serialized.pop("project_name", None)
                    serialized.pop("eval_name", None)

                    async def run_eval():
                        result = await EvalAsync(
                            **serialized,
                            name="worker-thread",
                            data=eval_data["data"],
                            scores=[{"name": scorer_name(score, i)} for i, score in enumerate(evaluator.scores)],
                            task=task,
                        )

                        summary = result.summary.as_dict()

                        await message_queue.put(
                            serialize_sse_event(
                                "summary",
                                json.dumps(
                                    {
                                        "projectName": summary["project_name"],
                                        "experimentName": summary["experiment_name"],
                                        "projectId": summary["project_id"],
                                        "experimentId": summary["experiment_id"],
                                        "projectUrl": summary["project_url"],
                                        "experimentUrl": summary["experiment_url"],
                                        "comparisonExperimentName": summary["comparison_experiment_name"],
                                        "scores": summary["scores"],
                                        "metrics": summary["metrics"],
                                    }
                                ),
                            )
                        )
                        await message_queue.put(serialize_sse_event("done", ""))
                        await message_queue.put(None)

                        return summary

                    eval_task = asyncio.create_task(run_eval())

                    while True:
                        message = await message_queue.get()
                        if message is None:
                            break
                        yield message

                    # Wait for the eval to complete
                    await eval_task
                except Exception as e:
                    await message_queue.put(serialize_sse_event("error", str(e)))
                    await message_queue.put(None)

            return StreamingResponse(
                stream_eval(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            )

        else:
            summary = await EvalAsync(
                **{
                    # type: ignore
                    **serialized,
                    **{
                        "name": "worker-thread",
                        "data": eval_data["data"],
                        "scores": [{"name": scorer_name(score, i)} for i, score in enumerate(evaluator.scores)],
                    },
                },
            )

            return summary.summary

    uvicorn.run(app, host=host, port=port)


def serialize_sse_event(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


def call_evaluator_data(dataset: Union[Dataset, List[Any]]):
    data_result = dataset() if callable(dataset) else dataset

    base_experiment: Optional[str] = None
    if get_any(data_result, "_type", None) == "BaseExperiment":
        base_experiment = getattr(data_result, "name", None)

    # Ensure all data items have an 'input' field
    if isinstance(data_result, list):
        processed_data = []
        for item in data_result:
            if isinstance(item, dict) and "input" not in item:
                # Add a default input if missing
                item = {**item, "input": None}
            processed_data.append(item)
        data_result = processed_data

    return {"data": data_result, "baseExperiment": base_experiment}
