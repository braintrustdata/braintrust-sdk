from typing import Any, Dict, List

from bottle import response, route, run

from ..framework import Evaluator

# Import CORS to register hooks
from .cors import enable_cors  # This will register the CORS hook

_all_evaluators: Dict[str, Evaluator[Any, Any]] = {}

# Ensure CORS is loaded (the @hook decorator registers it automatically), but this appeases the linter.
_ = enable_cors


@route("/<path:path>", method="OPTIONS")
def handle_options(path: str):
    """Handle preflight OPTIONS requests."""
    response.status = 200
    response.content_type = "text/plain"
    return ""


@route("/", method="GET")
def index():
    return "Hello, world!"


@route("/list", method="GET")
def list_evaluators():
    response.content_type = "application/json"
    evaluator_list = [
        {"name": name, "description": evaluator.description, "project_name": evaluator.project_name}
        for name, evaluator in _all_evaluators.items()
    ]
    print(f"Available evaluators: {evaluator_list}")
    return """{
    "Simple eval": {
        "parameters": {
            "main": {
                "type": "prompt",
                "default": {
                    "prompt": {
                        "type": "chat",
                        "messages": [
                            {
                                "role": "user",
                                "content": "{{input}}"
                            }
                        ]
                    },
                    "options": {
                        "model": "gpt-4o"
                    }
                },
                "description": "This is the main prompt"
            },
            "another": {
                "type": "prompt",
                "default": {
                    "prompt": {
                        "type": "chat",
                        "messages": [
                            {
                                "role": "user",
                                "content": "{{input}}"
                            }
                        ]
                    },
                    "options": {
                        "model": "gpt-4o"
                    }
                },
                "description": "This is another prompt"
            },
            "include_prefix": {
                "type": "data",
                "schema": {
                    "type": "boolean",
                    "default": false,
                    "description": "Include a contextual prefix",
                    "$schema": "http://json-schema.org/draft-07/schema#"
                },
                "description": "Include a contextual prefix"
            },
            "prefix": {
                "type": "data",
                "schema": {
                    "type": "string",
                    "description": "The prefix to include",
                    "default": "this is a math problem",
                    "$schema": "http://json-schema.org/draft-07/schema#"
                },
                "description": "The prefix to include"
            },
            "array_of_objects": {
                "type": "data",
                "schema": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {
                                "type": "string"
                            },
                            "age": {
                                "type": "number"
                            }
                        },
                        "required": [
                            "name",
                            "age"
                        ],
                        "additionalProperties": false
                    },
                    "default": [
                        {
                            "name": "John",
                            "age": 30
                        },
                        {
                            "name": "Jane",
                            "age": 25
                        }
                    ],
                    "$schema": "http://json-schema.org/draft-07/schema#"
                }
            }
        },
        "scores": [
            {
                "name": "Levenshtein"
            }
        ]
    }
}"""


def run_dev_server(evaluators: List[Evaluator[Any, Any]], host: str = "localhost", port: int = 8300):
    global _all_evaluators
    _all_evaluators = {evaluator.eval_name: evaluator for evaluator in evaluators}

    print(f"Starting dev server on http://{host}:{port}")
    print(f"Loaded {len(_all_evaluators)} evaluator(s): {list(_all_evaluators.keys())}")

    # Use paste server if available (multi-threaded), otherwise fall back to default
    try:
        run(host=host, port=port, server="paste", debug=False, reloader=False)
    except ImportError:
        # Fall back to default server but warn about potential issues
        print("Warning: 'paste' server not available. Using single-threaded server.")
        print("To avoid potential hanging issues, install paste: pip install paste")
        run(host=host, port=port, debug=False, reloader=False, threaded=False)
