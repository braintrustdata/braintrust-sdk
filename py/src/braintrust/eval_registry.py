"""Registry for maintaining available evaluations and their configurations."""

from __future__ import annotations

import importlib
import importlib.util
import inspect
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Type, Union, cast

import braintrust


@dataclass
class EvalConfig:
    """Configuration for a registered evaluation."""

    name: str
    description: Optional[str] = None
    task_fn: Optional[Callable] = None
    parameters: Dict[str, Any] = field(default_factory=dict)
    scores: List[Dict[str, Any]] = field(default_factory=list)
    module_path: Optional[str] = None


class Registry:
    """Registry for available evaluations."""

    _evals: Dict[str, EvalConfig] = {}

    @classmethod
    def register(cls, name: str, config: EvalConfig) -> None:
        """Register an evaluation."""
        cls._evals[name] = config

    @classmethod
    def get(cls, name: str) -> Optional[EvalConfig]:
        """Get an evaluation configuration by name."""
        return cls._evals.get(name)

    @classmethod
    def list(cls) -> Dict[str, Dict[str, Any]]:
        """List all registered evaluations."""
        return {
            name: {
                "name": config.name,
                "description": config.description or "",
                "parameters": config.parameters,
            }
            for name, config in cls._evals.items()
        }

    @classmethod
    def load_from_file(cls, file_path: str) -> Set[str]:
        """
        Load evaluations from a Python file.
        Returns the set of evaluation names loaded.
        """
        # Add the directory to sys.path for importing
        dir_path = os.path.dirname(os.path.abspath(file_path))
        if dir_path not in sys.path:
            sys.path.insert(0, dir_path)

        # Import the module
        module_name = os.path.splitext(os.path.basename(file_path))[0]
        spec = importlib.util.spec_from_file_location(module_name, file_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Could not load module from {file_path}")

        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)

        # Return the names of evaluations from this module
        return {name for name, config in cls._evals.items() if config.module_path == file_path}


def register_eval(
    name: str,
    task_fn: Callable,
    parameters: Dict[str, Any] = None,
    scores: List[Dict[str, Any]] = None,
    description: str = None,
) -> None:
    """
    Register an evaluation with the registry.

    Args:
        name: Name of the evaluation
        task_fn: The task function to execute
        parameters: Parameter schema for the evaluation
        scores: Scoring configuration for the evaluation
        description: Description of the evaluation
    """
    # Get the file path of the calling module
    frame = inspect.currentframe()
    if frame is None:
        module_path = None
    else:
        try:
            frame_info = inspect.getouterframes(frame)[1]
            module_path = frame_info.filename
        finally:
            del frame

    config = EvalConfig(
        name=name,
        task_fn=task_fn,
        parameters=parameters or {},
        scores=scores or [],
        description=description,
        module_path=module_path,
    )

    Registry.register(name, config)


# Add a patch to braintrust module to make Eval globally available
def Eval(
    name: str,
    config: Dict[str, Any] = None,
) -> None:
    """
    Register an evaluation.

    Args:
        name: Name of the evaluation
        config: Configuration for the evaluation
    """
    if config is None:
        config = {}

    task_fn = config.get("task")
    parameters = config.get("parameters", {})
    scores = config.get("scores", [])
    description = config.get("description", None)

    register_eval(name, task_fn, parameters, scores, description)


# Make the Eval function available in the braintrust module
setattr(braintrust, "Eval", Eval)
