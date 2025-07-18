import asyncio
import inspect
import json
from dataclasses import asdict
from typing import Annotated, Any, AsyncGenerator, Dict, List, Optional, Union, cast

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
    ScoreFunctionId,
)
from braintrust.dev.dataset import get_dataset
from braintrust.dev.errors import format_validation_errors
from braintrust.dev.security import BraintrustApiKey
from braintrust.dev.utils import get_any
from braintrust.framework import (
    EvalAsync,
    EvalCase,
    EvalHooks,
    Evaluator,
    ScorerLike,
    scorer_name,
)
from braintrust.http_headers import BT_CURSOR_HEADER, BT_FOUND_EXISTING_HEADER, BT_PARENT
from braintrust.logger import BraintrustState, Dataset, flush, get_span_parent_object
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
    async def list_evals(
        state: Annotated[BraintrustState, Depends(api_key_scheme)]
    ):  # pyright: ignore[reportUnusedFunction]
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
        state: Annotated[BraintrustState, Depends(api_key_scheme)], eval_raw: Dict[str, Any]
    ):
        eval = EvalRequest.from_dict_deep(eval_raw)

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

        resolved_dataset = get_dataset(state, eval.data)
        eval_data = call_evaluator_data(resolved_dataset)

        eprint(f"Starting eval {evaluator.eval_name}")

        message_queue: asyncio.Queue[Optional[str]] = asyncio.Queue()

        async def progress_task(input: Any, hooks: EvalHooks[Any]):
            task_args = [input]
            if len(inspect.signature(evaluator.task).parameters) == 2:
                task_args.append(hooks)

            result = evaluator.task(*task_args)

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
                            "name": "Say Hi Bot",
                            "object_type": "task",
                        }
                    ),
                )
            )
            return result

        async def evaluate():
            scores = evaluator.scores
            if eval.scores:
                scores += [make_scorer(state, score.name, score.function_id) for score in eval.scores]

            result = await EvalAsync(
                name=evaluator.eval_name,
                data=eval_data["data"],
                task=progress_task,
                scores=scores,
                experiment_name=evaluator.experiment_name,
                trial_count=evaluator.trial_count,
                metadata=evaluator.metadata,
                is_public=evaluator.is_public,
                update=evaluator.update,
                timeout=evaluator.timeout,
                max_concurrency=evaluator.max_concurrency,
                project_id=evaluator.project_id,
                base_experiment_name=evaluator.base_experiment_name,
                base_experiment_id=evaluator.base_experiment_id,
                git_metadata_settings=evaluator.git_metadata_settings,
                repo_info=evaluator.repo_info,
                error_score_handler=evaluator.error_score_handler,
                description=evaluator.description,
                summarize_scores=evaluator.summarize_scores,
                state=state,
            )

            # we're done
            await message_queue.put(None)

            return result

        eval_task = asyncio.create_task(evaluate())

        if eval.stream:

            async def stream_eval() -> AsyncGenerator[str, None]:
                while True:
                    message = await message_queue.get()
                    if message is None:
                        break
                    yield message

                result = await eval_task

                summary = result.summary.as_dict()

                yield serialize_sse_event(
                    "summary",
                    json.dumps({"projectName": "Say Hi Bot", "experimentName": "Say Hi Bot", "scores": {}}),
                )

                yield serialize_sse_event("done", "")

            return StreamingResponse(
                stream_eval(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            )

        result = await eval_task

        flush()

        return result.summary

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


def make_scorer(state: BraintrustState, name: str, score: ScoreFunctionId) -> ScorerLike[Any, Any]:
    def scorer(input: EvalCase[Any, Any]):
        request = {
            **asdict(score),
            "input": input,
            "parent": get_span_parent_object().export(),
            "stream": False,
            "mode": "auto",
            "strict": True,
        }
        result = state.proxy_conn().post(
            "function/invoke",
            request,
            headers={
                "Accept": "application/json",
            },
        )
        return result.json()

    scorer.__name__ = name

    return scorer
