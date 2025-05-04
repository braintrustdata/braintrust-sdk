from __future__ import annotations

import importlib.util
import json
import os
import sys
import traceback
from typing import Any, Dict, List, Optional, Type, Union, cast

# Check if required packages are installed
missing_packages = []
for package in ["fastapi", "uvicorn", "pydantic"]:
    if importlib.util.find_spec(package) is None:
        missing_packages.append(package)

if missing_packages:
    raise ImportError(
        f"Missing required packages for remote evaluations: {', '.join(missing_packages)}. "
        f"Install them with 'pip install braintrust[cli]'"
    )

import asyncio

import fastapi
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

import braintrust
from braintrust.authorize import RequestContext, authorize_request, check_authorized
from braintrust.eval_registry import Registry
from braintrust.state import UserState, create_experiment, login_to_state


class EvalRunRequest(BaseModel):
    """Request model for running a remote eval."""

    name: str
    parameters: Optional[Dict[str, Any]] = Field(default_factory=dict)
    data: Dict[str, Any]
    scores: Optional[List[Dict[str, Any]]] = None


class EvalRunResponse(BaseModel):
    """Response model for a completed eval run."""

    experimentId: str


def run_eval_task(
    experiment_logger: braintrust.BrainTrust, eval_config: Dict[str, Any], eval_request: EvalRunRequest
) -> Dict[str, Any]:
    """
    Run the evaluation task and return the results.

    Args:
        experiment_logger: The logger for the experiment
        eval_config: The configuration for the evaluation
        eval_request: The request with parameters and data

    Returns:
        Dict with evaluation results
    """
    task_fn = eval_config.get("task_fn")
    if not task_fn:
        raise ValueError("Eval does not have a task function")

    # Prepare the data
    data = eval_request.data.get("data", [])
    if not isinstance(data, list):
        raise ValueError("Data must be a list of objects")

    parameters = eval_request.parameters or {}

    # Apply scores from the request if provided
    scores = eval_request.scores or eval_config.get("scores", [])

    # Run the task for each data item
    results = []
    for item in data:
        try:
            with experiment_logger.log(inputs=item) as log:
                # Run the task function with the input and parameters
                output = task_fn(item.get("input"), {"parameters": parameters})
                log.output = output

                # Apply scores if specified
                if scores:
                    for score_config in scores:
                        score_name = score_config.get("name")
                        if not score_name:
                            continue

                        # Apply the score function if available
                        # In a real implementation, this would use the function_id to load
                        # the appropriate scorer function
                        expected = item.get("expected")
                        if expected is not None:
                            # Simple exact match score as example
                            log.score(score_name, 1.0 if str(output) == str(expected) else 0.0)

                results.append({"input": item.get("input"), "output": output, "scores": log._scores})
        except Exception as e:
            print(f"Error processing item: {e}")
            traceback.print_exc()

    return {"results": results}


def create_remote_eval_app() -> FastAPI:
    """Create and configure FastAPI app for remote evaluations."""
    app = FastAPI()

    # Configure CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # This is handled by our custom auth middleware
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    async def health() -> Dict[str, str]:
        """Health check endpoint."""
        return {"status": "ok"}

    @app.get("/list")
    async def list_evals() -> Dict[str, Dict[str, Any]]:
        """List available evals."""
        return Registry.list()

    @app.post("/eval")
    async def run_eval(request: Request) -> EvalRunResponse:
        """
        Run a remote evaluation.
        Requires authentication via Authorization header.
        """
        # Authenticate request
        headers = dict(request.headers.items())
        context = authorize_request(headers)

        if not check_authorized(context):
            raise HTTPException(status_code=401, detail="Unauthorized")

        # Get user state from auth token
        state = login_to_state(context)
        if not state:
            raise HTTPException(status_code=401, detail="Invalid token")

        # Parse request body
        try:
            body = await request.json()
            eval_request = EvalRunRequest(**body)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")

        # Get the eval configuration
        eval_config = Registry.get(eval_request.name)
        if not eval_config:
            raise HTTPException(status_code=404, detail=f"Evaluation '{eval_request.name}' not found")

        # Create an experiment
        experiment_info = create_experiment(state, name=f"Remote eval: {eval_request.name}", tags=["remote-eval"])

        # Initialize a logger for the experiment
        experiment_logger = braintrust.BrainTrust(
            api_key=state.token, api_url=state.api_url, experiment_id=experiment_info["experimentId"]
        )

        # Run the evaluation in a separate thread to not block the API
        loop = asyncio.get_event_loop()
        try:
            # Run the eval task
            await loop.run_in_executor(None, run_eval_task, experiment_logger, eval_config, eval_request)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error running evaluation: {str(e)}")

        return EvalRunResponse(experimentId=experiment_info["experimentId"])


def run_remote_eval_server(port: int = 8080) -> None:
    """Run the remote eval server on the specified port."""
    import uvicorn

    app = create_remote_eval_app()
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    run_remote_eval_server(port)
