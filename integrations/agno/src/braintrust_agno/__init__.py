"""
Braintrust wrapper for Agno - provides observability for agent workflows.

This integration provides:
- Agent execution tracing with proper root spans
- LLM call tracing with proper nesting
- Tool call tracing with correct parent-child relationships

Usage:
    from braintrust_agno import init_agno

    # Initialize the integration
    init_agno(project_name="my-project")

    # Your Agno agent code will now be automatically traced
    import agno
    agent = agno.Agent(...)
    response = agent.run(...)
"""

__all__ = ["init_agno", "setup_braintrust", "teardown_braintrust"]

import importlib
import inspect
import logging
from typing import Any, Dict, Optional

from braintrust.logger import NOOP_SPAN, current_span, init_logger

from braintrust_agno.agent import AgentWrapper
from braintrust_agno.function_call import FunctionCallWrapper
from braintrust_agno.model import ModelWrapper

# Global state tracking
_original_methods: Dict[str, Dict[str, Any]] = {}

logger = logging.getLogger(__name__)


def init_agno(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project_name: Optional[str] = None,
) -> bool:
    """
    Initialize Braintrust integration with Agno for automatic tracing.

    This is the main entry point for the integration. It will automatically
    patch Agno agents, models, and function calls to enable tracing.

    Args:
        api_key: Braintrust API key (optional, can use env var BRAINTRUST_API_KEY)
        project_id: Braintrust project ID (optional)
        project_name: Braintrust project name (optional, can use env var BRAINTRUST_PROJECT)

    Returns:
        True if initialization was successful, False otherwise

    Example:
        >>> from braintrust_agno import init_agno
        >>> init_agno(project_name="my-agno-project")
        >>> # Now all Agno operations will be traced
    """
    return setup_braintrust(api_key=api_key, project_id=project_id, project_name=project_name)


def setup_braintrust(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project_name: Optional[str] = None,
) -> bool:
    """
    Setup Braintrust integration with Agno. Will automatically patch Agno agents, models, and function calls for tracing.

    This function is called by init_agno() and can also be used directly for more control.

    Args:
        api_key: Braintrust API key (optional, can use env var BRAINTRUST_API_KEY)
        project_id: Braintrust project ID (optional)
        project_name: Braintrust project name (optional, can use env var BRAINTRUST_PROJECT)

    Returns:
        True if setup was successful, False otherwise
    """
    span = current_span()
    if span == NOOP_SPAN:
        init_logger(project=project_name, api_key=api_key, project_id=project_id)

    success = True

    # Try to wrap agent classes
    try:
        agno_agent = importlib.import_module("agno.agent")
        if hasattr(agno_agent, "Agent"):
            _wrap_agent_class(agno_agent.Agent)
            logger.debug("Successfully wrapped agno.agent.Agent")
    except ImportError as e:
        logger.warning(f"Failed to import agno.agent: {e}")
        success = False

    # Try to wrap model classes
    try:
        agno_base_model = importlib.import_module("agno.models.base")
        if hasattr(agno_base_model, "Model"):
            _wrap_model_class(agno_base_model.Model)
            logger.debug("Successfully wrapped agno.models.base.Model")
    except ImportError as e:
        logger.warning(f"Failed to import agno.models.base: {e}")
        # Don't fail completely if models aren't available
        pass

    # Try to wrap function call classes
    try:
        agno_tools = importlib.import_module("agno.tools.function")
        if hasattr(agno_tools, "FunctionCall"):
            _wrap_function_call_class(agno_tools.FunctionCall)
            logger.debug("Successfully wrapped agno.tools.function.FunctionCall")
    except ImportError as e:
        logger.warning(f"Failed to import agno.tools.function: {e}")
        # Don't fail completely if tools aren't available
        pass

    return success


def teardown_braintrust():
    """
    Restore original methods - useful for testing and cleanup.

    This will remove all Braintrust instrumentation from Agno classes.
    """
    for class_name, methods in _original_methods.items():
        try:
            module_name, class_name = class_name.rsplit(".", 1)
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

    methods_to_wrap = ["run", "_arun", "_run_stream", "_arun_stream", "print_response"]

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

    methods_to_wrap = [
        "invoke",
        "ainvoke",
        "invoke_stream",
        "ainvoke_stream",
        "response",
        "aresponse",
        "response_stream",
        "aresponse_stream",
    ]

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

    methods_to_wrap = ["execute", "aexecute"]

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
