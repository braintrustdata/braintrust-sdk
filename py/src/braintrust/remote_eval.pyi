from typing import Any, Dict, Optional

from fastapi import FastAPI

class EvalRunRequest:
    name: str
    parameters: Optional[Dict[str, Any]]
    data: Dict[str, Any]
    scores: Optional[list]

class EvalRunResponse:
    experimentId: str

def create_remote_eval_app() -> FastAPI: ...
def run_remote_eval_server(port: int = ...) -> None: ...
