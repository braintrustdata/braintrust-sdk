from typing import Any, Dict

import uvicorn
from starlette.applications import Starlette
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.routing import Route

from ..framework import Evaluator
from .cors import create_cors_middleware

_all_evaluators: Dict[str, Evaluator[Any, Any]] = {}


async def index(request):
    return PlainTextResponse("Hello, world!")


async def list_evaluators(request):
    evaluator_list = [
        {"name": name, "description": evaluator.description, "project_name": evaluator.project_name}
        for name, evaluator in _all_evaluators.items()
    ]
    print(f"Available evaluators: {evaluator_list}")

    # Return the hardcoded response for now
    return JSONResponse({
        "Simple eval": {
            "parameters": {
                "main": {
                    "type": "prompt",
                    "default": {
                        "prompt": {"type": "chat", "messages": [{"role": "user", "content": "{{input}}"}]},
                        "options": {"model": "gpt-4o"},
                    },
                    "description": "This is the main prompt",
                },
                "another": {
                    "type": "prompt",
                    "default": {
                        "prompt": {"type": "chat", "messages": [{"role": "user", "content": "{{input}}"}]},
                        "options": {"model": "gpt-4o"},
                    },
                    "description": "This is another prompt",
                },
                "include_prefix": {
                    "type": "data",
                    "schema": {
                        "type": "boolean",
                        "default": False,
                        "description": "Include a contextual prefix",
                        "$schema": "http://json-schema.org/draft-07/schema#",
                    },
                    "description": "Include a contextual prefix",
                },
                "prefix": {
                    "type": "data",
                    "schema": {
                        "type": "string",
                        "description": "The prefix to include",
                        "default": "this is a math problem",
                        "$schema": "http://json-schema.org/draft-07/schema#",
                    },
                    "description": "The prefix to include",
                },
                "array_of_objects": {
                    "type": "data",
                    "schema": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"name": {"type": "string"}, "age": {"type": "number"}},
                            "required": ["name", "age"],
                            "additionalProperties": False,
                        },
                        "default": [{"name": "John", "age": 30}, {"name": "Jane", "age": 25}],
                        "$schema": "http://json-schema.org/draft-07/schema#",
                    },
                },
            },
            "scores": [{"name": "Levenshtein"}],
        }
    })


def run_dev_server(evaluators: list[Evaluator[Any, Any]], host: str = "localhost", port: int = 8300):
    global _all_evaluators
    _all_evaluators = {evaluator.eval_name: evaluator for evaluator in evaluators}

    print(f"Starting dev server on http://{host}:{port}")
    print(f"Loaded {len(_all_evaluators)} evaluator(s): {list(_all_evaluators.keys())}")

    routes = [
        Route("/", endpoint=index),
        Route("/list", endpoint=list_evaluators),
    ]

    app = Starlette(routes=routes)
    app.add_middleware(create_cors_middleware())

    uvicorn.run(app, host=host, port=port)
