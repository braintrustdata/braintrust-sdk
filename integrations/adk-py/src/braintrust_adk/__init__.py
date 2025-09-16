import logging
from typing import Any, Callable, Optional

from braintrust.logger import init_logger, start_span
from braintrust.span_types import SpanTypeAttribute

logger = logging.getLogger(__name__)



def setup_braintrust(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project_name: Optional[str] = None,
    SpanProcessor: Optional[type] = None,
) -> bool:
    if SpanProcessor is not None:
        logging.warning("SpanProcessor parameter is deprecated and will be ignored")

    # Initialize Braintrust
    # TODO: should do something similar that we did in langchain-py where we check if existing span (inside of an eval)
    # is not a NOOP SPAN or logger is already initialized
    init_logger(project=project_name, api_key=api_key, project_id=project_id)

    try:
        from google.adk import agents, runners
        from google.adk.flows.llm_flows import base_llm_flow

        agents.BaseAgent = wrap_agent(agents.BaseAgent)
        runners.Runner = wrap_runner(runners.Runner)
        base_llm_flow.BaseLlmFlow = wrap_flow(base_llm_flow.BaseLlmFlow)

        logger.info("Successfully monkeypatched Google ADK agents with Braintrust tracing")
        return True
    except ImportError as e:
        logger.error(f"Failed to import Google ADK agents: {e}")
        logger.error("Google ADK is not installed. Please install it with: pip install google-adk")
        return False


def wrap_agent(Agent: type) -> type:
    if _is_patched(Agent):
        return Agent

    def trace_run(original: Callable[..., Any]):
        async def wrapped(self: Any, parent_context: Any, *args: Any, **kwargs: Any):
            with start_span(
                name=f"agent_run [{self.name}]",
                type=SpanTypeAttribute.TASK,
                input={},
                metadata={"parent_context": _try_dict(parent_context)},
            ) as span:
                async for event in original(self, parent_context, *args, **kwargs):
                    if event.is_final_response():
                        # TODO: output shape
                        span.log(output=event)
                    yield event

        return wrapped

    # TODO: we likely should prefer _run_async_impl rather than the public ones
    Agent.run_live = trace_run(Agent.run_live)
    Agent.run_async = trace_run(Agent.run_async)

    Agent._braintrust_patched = True

    return Agent


def wrap_flow(Flow: type) -> type:
    if _is_patched(Flow):
        return Flow

    def trace_call(original: Callable[..., Any]):
        async def wrapped(
            self: Any, invocation_context: Any, llm_request: Any, model_response_event: Any, *args: Any, **kwargs: Any
        ):
            with start_span(
                name=f"call_llm",
                type=SpanTypeAttribute.LLM,
                input=_try_dict(llm_request),
                metadata=_try_dict(
                    {
                        "invocation_context": invocation_context,
                        "model_response_event": model_response_event,
                        **kwargs,
                    }
                ),
            ) as span:
                async for event in original(
                    self, invocation_context, llm_request, model_response_event, *args, **kwargs
                ):
                    span.log(output=event)
                    yield event

        return wrapped

    Flow._call_llm_async = trace_call(Flow._call_llm_async)

    Flow._braintrust_patched = True
    return Flow


def wrap_runner(Runner: type):
    if _is_patched(Runner):
        return Runner

    def trace_run_sync(original: Callable[..., Any]):
        def wrapped(
            self: Any,
            *,
            user_id: Any,
            session_id: Any,
            new_message: Any,
            **kwargs: Any,
        ):
            with start_span(
                name=f"invocation [{self.app_name}]",
                input={"new_message": _try_dict(new_message)},
                metadata=_try_dict(
                    {
                        "user_id": user_id,
                        "session_id": session_id,
                        **kwargs,
                    }
                ),
            ) as span:
                for event in original(
                    self,
                    user_id=user_id,
                    session_id=session_id,
                    new_message=new_message,
                    **kwargs,
                ):
                    if event.is_final_response():
                        span.log(output=_try_dict(event))
                    yield event

        return wrapped

    Runner.run = trace_run_sync(Runner.run)

    def trace_run_async(original: Callable[..., Any]):
        async def wrapped(
            self,
            *,
            user_id: str,
            session_id: str,
            new_message: Any,
            state_delta: Any = None,
            **kwargs: Any,
        ):
            with start_span(
                name=f"invocation [{self.app_name}]",
                input={"new_message": _try_dict(new_message)},
                metadata=_try_dict(
                    {
                        "user_id": user_id,
                        "session_id": session_id,
                        "state_delta": state_delta,
                        **kwargs,
                    }
                ),
            ) as span:
                async for event in original(
                    self,
                    user_id=user_id,
                    session_id=session_id,
                    new_message=new_message,
                    state_delta=state_delta,
                    **kwargs,
                ):
                    if event.is_final_response():
                        span.log(output=_try_dict(event))
                    yield event

        return wrapped

    Runner.run_async = trace_run_async(Runner.run_async)

    Runner._braintrust_patched = True
    return Runner


def _is_patched(obj: Any):
    return getattr(obj, "_braintrust_patched", False)


def _try_dict(obj: Any):
    if hasattr(obj, "model_dump"):
        obj = obj.model_dump(exclude_none=True)
    if isinstance(obj, dict):
        return {k: _try_dict(v) for k, v in obj.items()}
    return obj
