"""
Braintrust wrapper for Agno - provides observability for agent workflows.

This integration provides:
- Agent execution tracing with proper root spans
- LLM call tracing with proper nesting
- Tool call tracing with correct parent-child relationships

Usage:
    from braintrust import init_logger
    from braintrust_agno import setup_braintrust

    setup_braintrust(project_name="my-project")

"""

import importlib
import inspect
import logging
from typing import Any, Dict, Optional

from braintrust.logger import NOOP_SPAN, current_span, init_logger

from .wrappers import AgentWrapper, FunctionCallWrapper, ModelWrapper

# Global state tracking
_original_methods: Dict[str, Dict[str, Any]] = {}

logger = logging.getLogger(__name__)

def setup_braintrust(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project_name: Optional[str] = None,
) -> bool:
    """
    Setup Braintrust integration with Agno. Will automatically patch Agno agents, models, and function calls for tracing.

    Args:
        api_key (Optional[str]): Braintrust API key.
        project_id (Optional[str]): Braintrust project ID.
        project_name (Optional[str]): Braintrust project name.

    Returns:
        bool: True if setup was successful, False otherwise.
    """
    span = current_span()
    if span == NOOP_SPAN:
        init_logger(project=project_name, api_key=api_key, project_id=project_id)


    try:
        agno_agent = importlib.import_module('agno.agent')
        if hasattr(agno_agent, 'Agent'):
            _wrap_agent_class(agno_agent.Agent)
    except ImportError as e:
        logger.error(f"Failed to import agno.agent: {e}")
        return False

    try:
        agno_base_model = importlib.import_module('agno.models.base')
        if hasattr(agno_base_model, 'Model'):
            _wrap_model_class(agno_base_model.Model)
    except ImportError as e:
        logger.error(f"Failed to import agno.models.base: {e}")
        return False

    try:
        agno_tools = importlib.import_module('agno.tools.function')
        if hasattr(agno_tools, 'FunctionCall'):
            _wrap_function_call_class(agno_tools.FunctionCall)
    except ImportError as e:
        logger.error(f"Failed to import agno.tools.function: {e}")
        return False


    return True


def teardown_braintrust():
    """Restore original methods - useful for testing."""
    for class_name, methods in _original_methods.items():
        try:
            module_name, class_name = class_name.rsplit('.', 1)
            module = importlib.import_module(module_name)
            cls = getattr(module, class_name)

            for method_name, original_method in methods.items():
                setattr(cls, method_name, original_method)
        except (ImportError, AttributeError):
            continue

    _original_methods.clear()


def _wrap_agent_class(agent_class: type):
    """Wrap the Agent class methods."""
    class_key = f"{agent_class.__module__}.{agent_class.__name__}"
    _original_methods[class_key] = {}

    methods_to_wrap = ['run', '_arun', '_run_stream', '_arun_stream', 'print_response']

    for method_name in methods_to_wrap:
        if hasattr(agent_class, method_name):
            original_method = getattr(agent_class, method_name)
            _original_methods[class_key][method_name] = original_method

            def create_wrapped_method(method_name, original_method):
                def wrapped_method(self, *args, **kwargs):
                    wrapper = AgentWrapper(self, _original_methods[class_key])
                    return getattr(wrapper, method_name)(*args, **kwargs)

                async def wrapped_async_method(self, *args, **kwargs):
                    wrapper = AgentWrapper(self, _original_methods[class_key])
                    return await getattr(wrapper, method_name)(*args, **kwargs)

                if inspect.iscoroutinefunction(original_method):
                    return wrapped_async_method
                else:
                    return wrapped_method

            wrapped = create_wrapped_method(method_name, original_method)
            setattr(agent_class, method_name, wrapped)


def _wrap_model_class(model_class: type):
    """Wrap a model class methods."""
    class_key = f"{model_class.__module__}.{model_class.__name__}"
    _original_methods[class_key] = {}

    methods_to_wrap = ['invoke', 'ainvoke', 'invoke_stream', 'ainvoke_stream', 'response', 'aresponse', 'response_stream', 'aresponse_stream']

    for method_name in methods_to_wrap:
        if hasattr(model_class, method_name):
            original_method = getattr(model_class, method_name)
            _original_methods[class_key][method_name] = original_method

            def create_wrapped_method(method_name, original_method):
                def wrapped_method(self, *args, **kwargs):
                    wrapper = ModelWrapper(self, _original_methods[class_key])
                    return getattr(wrapper, method_name)(*args, **kwargs)

                async def wrapped_async_method(self, *args, **kwargs):
                    wrapper = ModelWrapper(self, _original_methods[class_key])
                    return await getattr(wrapper, method_name)(*args, **kwargs)

                if inspect.iscoroutinefunction(original_method):
                    return wrapped_async_method
                else:
                    return wrapped_method

            wrapped = create_wrapped_method(method_name, original_method)
            setattr(model_class, method_name, wrapped)


def _wrap_function_call_class(function_call_class: type):
    """Wrap the FunctionCall class methods."""
    class_key = f"{function_call_class.__module__}.{function_call_class.__name__}"
    _original_methods[class_key] = {}

    methods_to_wrap = ['execute', 'aexecute']

    for method_name in methods_to_wrap:
        if hasattr(function_call_class, method_name):
            original_method = getattr(function_call_class, method_name)
            _original_methods[class_key][method_name] = original_method

            def create_wrapped_method(method_name, original_method):
                def wrapped_method(self, *args, **kwargs):
                    wrapper = FunctionCallWrapper(self, _original_methods[class_key])
                    return getattr(wrapper, method_name)(*args, **kwargs)

                async def wrapped_async_method(self, *args, **kwargs):
                    wrapper = FunctionCallWrapper(self, _original_methods[class_key])
                    return await getattr(wrapper, method_name)(*args, **kwargs)

                if inspect.iscoroutinefunction(original_method):
                    return wrapped_async_method
                else:
                    return wrapped_method

            wrapped = create_wrapped_method(method_name, original_method)
            setattr(function_call_class, method_name, wrapped)
