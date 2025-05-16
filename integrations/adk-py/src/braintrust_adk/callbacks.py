import logging
from contextvars import ContextVar
from typing import (
    Any,
    Mapping,
    Optional,
    Sequence,
    TypedDict,
    Union,
)

import braintrust
from braintrust import (
    NOOP_SPAN,
    SpanAttributes,
    SpanTypeAttribute,
    current_span,
    init_logger,
)
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext
from typing_extensions import NotRequired

_logger = logging.getLogger("braintrust_adk")


class LogEvent(TypedDict):
    input: NotRequired[Any]
    output: NotRequired[Any]
    expected: NotRequired[Any]
    error: NotRequired[str]
    tags: NotRequired[Optional[Sequence[str]]]
    scores: NotRequired[Mapping[str, Union[int, float]]]
    metadata: NotRequired[Mapping[str, Any]]
    metrics: NotRequired[Mapping[str, Union[int, float]]]
    id: NotRequired[str]
    dataset_record_id: NotRequired[str]


def _start_span(
    parent_run_id: Optional[str],
    run_id: str,
    name: Optional[str] = None,
    type: Optional[SpanTypeAttribute] = None,
    span_attributes: Optional[Union[SpanAttributes, Mapping[str, Any]]] = None,
    start_time: Optional[float] = None,
    set_current: Optional[bool] = None,
    parent: Optional[str] = None,
    event: Optional[LogEvent] = None,
):
    spans = spans_ctx.get()
    if run_id in spans:
        _logger.warning(
            f"Span already exists for run_id {run_id} (this is likely a bug)"
        )

    # branch in invocation_context may be a parent_id equivalent

    current_parent = current_span()
    parent_span = None
    if current_parent != NOOP_SPAN:
        parent_span = current_parent
    # TODO: support project logs?
    else:
        parent_span = braintrust

    span = parent_span.start_span(
        name=name,
        type=type,
        span_attributes=span_attributes,
        start_time=start_time,
        set_current=set_current,
        parent=parent,
        **event,
    )

    if span == NOOP_SPAN:
        _logger.warning(
            "Braintrust logging not configured. Call `init_logger`, or run an experiment to configure Braintrust logging. Setting up a default."
        )
        span = init_logger().start_span(
            name=name,
            type=type,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            parent=parent,
            **event,
        )

    spans[run_id] = span


def _end_span(
    run_id: str,
    parent_run_id: Optional[str] = None,
    input: Optional[Any] = None,
    output: Optional[Any] = None,
    expected: Optional[Any] = None,
    error: Optional[str] = None,
    tags: Optional[Sequence[str]] = None,
    scores: Optional[Mapping[str, Union[int, float]]] = None,
    metadata: Optional[Mapping[str, Any]] = None,
    metrics: Optional[Mapping[str, Union[int, float]]] = None,
    dataset_record_id: Optional[str] = None,
):
    spans = spans_ctx.get()
    span = spans.pop(run_id, None)
    if not span:
        return

    span.log(
        input=input,
        output=output,
        expected=expected,
        error=error,
        tags=None,
        scores=scores,
        metadata={
            **({"tags": tags} if tags else {}),
            **(metadata or {}),
        },
        metrics=metrics,
        dataset_record_id=dataset_record_id,
    )

    span.end()


def _callback_context_to_metadata(callback_context: CallbackContext) -> dict[str, Any]:
    return {
        "invocation_id": callback_context.invocation_id,
        "state": callback_context.state.to_dict(),
        "user_content": callback_context.user_content,
        "user_id": callback_context._invocation_context.session.user_id,
    }


def _tool_context_to_metadata(tool_context: ToolContext) -> dict[str, Any]:
    return {
        "function_call_id": tool_context.function_call_id,
        **_callback_context_to_metadata(tool_context),
    }


def before_model_callback(callback_context: CallbackContext, llm_request: LlmRequest):
    """Called before calling the LLM.
    Args:
      callback_context: CallbackContext,
      llm_request: LlmRequest, The raw model request. Callback can mutate the
      request.

    Returns:
      The content to return to the user. When present, the model call will be
      skipped and the provided content will be returned to user.
    """
    _start_span(
        parent_run_id=None,  # TODO: ?
        run_id=callback_context._invocation_context.invocation_id,
        name=callback_context.agent_name,
        type=SpanTypeAttribute.LLM,
        event={
            # TODO: cleaner?
            "input": llm_request.model_dump(),
            "metadata": _callback_context_to_metadata(callback_context),
        },
    )


def after_model_callback(callback_context: CallbackContext, llm_response: LlmResponse):
    """Called after calling LLM.

    Args:
      callback_context: CallbackContext,
      llm_response: LlmResponse, the actual model response.

    Returns:
      The content to return to the user. When present, the actual model response
      will be ignored and the provided content will be returned to user.
    """
    _end_span(
        run_id=callback_context._invocation_context.invocation_id,
        # TODO: cleaner?
        output=llm_response.model_dump(),
        metadata=_callback_context_to_metadata(callback_context),
    )


def before_tool_callback(
    tool: BaseTool, args: dict[str, Any], tool_context: ToolContext
) -> Optional[dict]:
    """Called before the tool is called.

    Args:
      tool: The tool to be called.
      args: The arguments to the tool.
      tool_context: ToolContext,

    Returns:
      The tool response. When present, the returned tool response will be used and
      the framework will skip calling the actual tool.
    """
    _start_span(
        parent_run_id=None,  # ?
        run_id=tool_context._invocation_context.invocation_id,
        name=tool.name,
        type=SpanTypeAttribute.TOOL,
        event={
            "input": args,
            "metadata": _tool_context_to_metadata(tool_context),
        },
    )


def after_tool_callback(
    tool: BaseTool, args: dict[str, Any], tool_context: ToolContext, tool_response: dict
) -> Optional[dict]:
    """Called after the tool is called.

    Args:
      tool: The tool to be called.
      args: The arguments to the tool.
      tool_context: ToolContext,
      tool_response: The response from the tool.

    Returns:
      When present, the returned dict will be used as tool result.
    """
    _end_span(
        run_id=tool_context._invocation_context.invocation_id,
        output=tool_response,
        metadata=_tool_context_to_metadata(tool_context),
    )


spans_ctx = ContextVar("braintrust_spans", default={})
