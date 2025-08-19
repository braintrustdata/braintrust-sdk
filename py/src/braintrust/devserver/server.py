import json
from typing import Any, Dict, List

from bottle import response, route, run

from ..framework import Evaluator

_all_evaluators: Dict[str, Evaluator[Any, Any]] = {}


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
    return json.dumps(evaluator_list)


def run_dev_server(evaluators: List[Evaluator[Any, Any]], host: str = "localhost", port: int = 8300):
    global _all_evaluators
    _all_evaluators = {evaluator.eval_name: evaluator for evaluator in evaluators}

    # XXX Remove debug params
    run(host=host, port=port, debug=True, reloader=True)
