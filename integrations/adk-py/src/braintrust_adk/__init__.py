import logging
from contextlib import AbstractAsyncContextManager
from typing import Any, AsyncGenerator, Dict, Iterable, Optional, TypeVar, Union, cast

from wrapt import wrap_function_wrapper

from braintrust.logger import NOOP_SPAN, current_span, init_logger, start_span
from braintrust.span_types import SpanTypeAttribute

logger = logging.getLogger(__name__)

__all__ = ["setup_braintrust", "setup_adk", "wrap_agent", "wrap_runner", "wrap_flow"]


def setup_braintrust(*args, **kwargs):
    logger.warning("setup_braintrust is deprecated, use setup_adk instead")
    return setup_adk(*args, **kwargs)


def setup_adk(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project_name: Optional[str] = None,
    SpanProcessor: Optional[type] = None,
) -> bool:
    """
    Setup Braintrust integration with Google ADK. Will automatically patch Google ADK agents, runners, and flows for automatic tracing.

    If you prefer manual patching take a look at `wrap_agent`, `wrap_runner`, and `wrap_flow`.

    Args:
        api_key (Optional[str]): Braintrust API key.
        project_id (Optional[str]): Braintrust project ID.
        project_name (Optional[str]): Braintrust project name.
        SpanProcessor (Optional[type]): Deprecated parameter.

    Returns:
        bool: True if setup was successful, False otherwise.
    """
    if SpanProcessor is not None:
        logging.warning("SpanProcessor parameter is deprecated and will be ignored")

    span = current_span()
    if span == NOOP_SPAN:
        init_logger(project=project_name, api_key=api_key, project_id=project_id)

    try:
        from google.adk import agents, runners
        from google.adk.flows.llm_flows import base_llm_flow

        agents.BaseAgent = wrap_agent(agents.BaseAgent)
        runners.Runner = wrap_runner(runners.Runner)
        base_llm_flow.BaseLlmFlow = wrap_flow(base_llm_flow.BaseLlmFlow)

        return True
    except ImportError as e:
        logger.error(f"Failed to import Google ADK agents: {e}")
        logger.error("Google ADK is not installed. Please install it with: pip install google-adk")
        return False


def wrap_agent(Agent: Any) -> Any:
    if _is_patched(Agent):
        return Agent

    async def agent_run_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        parent_context = args[0] if len(args) > 0 else kwargs.get("parent_context")

        async def _trace():
            with start_span(
                name=f"agent_run [{instance.name}]",
                type=SpanTypeAttribute.TASK,
                metadata=_try_dict({"parent_context": parent_context, **_omit(kwargs, ["parent_context"])}),
            ) as agent_span:
                last_event = None
                async with aclosing(wrapped(*args, **kwargs)) as agen:
                    async for event in agen:
                        if event.is_final_response():
                            last_event = event
                        yield event
                if last_event:
                    agent_span.log(output=_try_dict(last_event))

        async with aclosing(_trace()) as agen:
            async for event in agen:
                yield event

    wrap_function_wrapper(Agent, "run_async", agent_run_wrapper)
    Agent._braintrust_patched = True
    return Agent


def wrap_flow(Flow: Any):
    if _is_patched(Flow):
        return Flow

    async def trace_flow(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        invocation_context = args[0] if len(args) > 0 else kwargs.get("invocation_context")

        async def _trace():
            with start_span(
                name=f"call_llm",
                type=SpanTypeAttribute.TASK,
                metadata=_try_dict(
                    {
                        "invocation_context": invocation_context,
                        **_omit(kwargs, ["invocation_context"]),
                    }
                ),
            ) as llm_span:
                last_event = None
                async with aclosing(wrapped(*args, **kwargs)) as agen:
                    async for event in agen:
                        last_event = event
                        yield event
                if last_event:
                    llm_span.log(output=_try_dict(last_event))

        async with aclosing(_trace()) as agen:
            async for event in agen:
                yield event

    wrap_function_wrapper(Flow, "run_async", trace_flow)

    async def trace_run_sync_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        invocation_context = args[0] if len(args) > 0 else kwargs.get("invocation_context")
        llm_request = args[1] if len(args) > 1 else kwargs.get("llm_request")
        model_response_event = args[2] if len(args) > 2 else kwargs.get("model_response_event")

        # Determine the type of LLM call based on the request content
        call_type = _determine_llm_call_type(llm_request)

        async def _trace():
            with start_span(
                name=f"llm_call [{call_type}]",
                type=SpanTypeAttribute.LLM,
                input=_try_dict(llm_request),
                metadata=_try_dict(
                    {
                        "invocation_context": invocation_context,
                        "model_response_event": model_response_event,
                        "flow_class": instance.__class__.__name__,
                        "llm_call_type": call_type,
                        **_omit(kwargs, ["invocation_context", "model_response_event", "flow_class", "llm_call_type"]),
                    }
                ),
            ) as llm_span:
                last_event = None

                async with aclosing(wrapped(*args, **kwargs)) as agen:
                    async for event in agen:
                        last_event = event
                        yield event

                if last_event:
                    llm_span.log(output=_try_dict(last_event))

        async with aclosing(_trace()) as agen:
            async for event in agen:
                yield event

    wrap_function_wrapper(Flow, "_call_llm_async", trace_run_sync_wrapper)
    Flow._braintrust_patched = True
    return Flow


def wrap_runner(Runner: Any):
    if _is_patched(Runner):
        return Runner

    def trace_run_sync_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        user_id = kwargs.get("user_id")
        session_id = kwargs.get("session_id")
        new_message = kwargs.get("new_message")

        def _trace():
            with start_span(
                name=f"invocation [{instance.app_name}]",
                type=SpanTypeAttribute.TASK,
                input={"new_message": _try_dict(new_message)},
                metadata=_try_dict(
                    {
                        "user_id": user_id,
                        "session_id": session_id,
                        **_omit(kwargs, ["user_id", "session_id", "new_message"]),
                    }
                ),
            ) as runner_span:
                last_event = None
                for event in wrapped(*args, **kwargs):
                    if event.is_final_response():
                        last_event = event
                    yield event
                if last_event:
                    runner_span.log(output=_try_dict(last_event))

        for event in _trace():
            yield event

    wrap_function_wrapper(Runner, "run", trace_run_sync_wrapper)

    async def trace_run_async_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        user_id = kwargs.get("user_id")
        session_id = kwargs.get("session_id")
        new_message = kwargs.get("new_message")
        state_delta = kwargs.get("state_delta")

        async def _trace():
            with start_span(
                name=f"invocation [{instance.app_name}]",
                type=SpanTypeAttribute.TASK,
                input={"new_message": _try_dict(new_message)},
                metadata=_try_dict(
                    {
                        "user_id": user_id,
                        "session_id": session_id,
                        "state_delta": state_delta,
                        **_omit(kwargs, ["user_id", "session_id", "new_message", "state_delta"]),
                    }
                ),
            ) as runner_span:
                last_event = None
                async with aclosing(wrapped(*args, **kwargs)) as agen:
                    async for event in agen:
                        if event.is_final_response():
                            last_event = event
                        yield event
                if last_event:
                    runner_span.log(output=_try_dict(last_event))

        async with aclosing(_trace()) as agen:
            async for event in agen:
                yield event

    wrap_function_wrapper(Runner, "run_async", trace_run_async_wrapper)
    Runner._braintrust_patched = True
    return Runner


def _determine_llm_call_type(llm_request: Any) -> str:
    """
    Determine the type of LLM call based on the request content.

    Returns:
        - "tool_selection" if the LLM is selecting which tool to call
        - "response_generation" if the LLM is generating a response after tool execution
        - "direct_response" if there are no tools involved
    """
    try:
        # Convert to dict if it's a model object
        request_dict = cast(Dict[str, Any], _try_dict(llm_request))

        # Check if there are tools in the config
        has_tools = bool(request_dict.get("config", {}).get("tools"))

        # Check the conversation history for function responses
        contents = request_dict.get("contents", [])
        has_function_response = False
        has_function_call = False

        for content in contents:
            if isinstance(content, dict):
                parts = content.get("parts", [])
                for part in parts:
                    if isinstance(part, dict):
                        if "function_response" in part:
                            has_function_response = True
                        if "function_call" in part:
                            has_function_call = True

        # Determine the call type
        if has_function_response:
            return "response_generation"
        elif has_tools and not has_function_call:
            return "tool_selection"
        else:
            return "direct_response"

    except Exception:
        return "unknown"


def _is_patched(obj: Any):
    return getattr(obj, "_braintrust_patched", False)


def _try_dict(obj: Any) -> Union[Iterable[Any], Dict[str, Any]]:
    if hasattr(obj, "model_dump"):
        try:
            obj = obj.model_dump(exclude_none=True)
        except ValueError as e:
            if "Circular reference" in str(e):
                # Circular reference detected: ADK reuses objects (e.g., agent) in multiple locations
                # Return empty dict as fallback - non-critical for logging/tracing purposes
                return {}
            raise

    if isinstance(obj, dict):
        return {k: _try_dict(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_try_dict(item) for item in obj]

    return obj


def _omit(obj: Any, keys: Iterable[str]):
    return {k: v for k, v in obj.items() if k not in keys}


G = TypeVar("G", bound=AsyncGenerator[Any, None])


# until we drop support for Python 3.9
class aclosing(AbstractAsyncContextManager[G]):
    def __init__(self, async_generator: G):
        self.async_generator = async_generator

    async def __aenter__(self):
        return self.async_generator

    async def __aexit__(self, *exc_info: Any):
        await self.async_generator.aclose()
