import dataclasses
import json
from typing import (
    Any,
    Dict,
    List,
    Mapping,
    Optional,
    Sequence,
    TypedDict,
    Union,
)

from braintrust import SpanAttributes, SpanTypeAttribute
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext
from google.genai.types import Content
from opentelemetry.trace import get_current_span
from typing_extensions import NotRequired


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


def _clean(obj: Dict[str, Any]):
    return {k: v for k, v in obj.items() if v is not None}


def _start_span(
    name: Optional[str] = None,
    type: Optional[SpanTypeAttribute] = None,
    span_attributes: Optional[Union[SpanAttributes, Mapping[str, Any]]] = None,
    start_time: Optional[float] = None,
    set_current: Optional[bool] = None,
    parent: Optional[str] = None,
    event: Optional[LogEvent] = None,
):
    if event is None:
        event = {}

    span = get_current_span()
    span.set_attributes(
        _clean(
            {
                "braintrust.input_json": _safe_dumps(event["input"]) if "input" in event else None,
                "braintrust.output_json": _safe_dumps(event["output"]) if "output" in event else None,
                "braintrust.metadata": _safe_dumps(event["metadata"]) if "metadata" in event else None,
            }
        )
    )


def _safe_dumps(obj: Any) -> str:
    def default_encoder(o: Any) -> Any:
        # Handle Pydantic models (v1 and v2)
        if hasattr(o, "model_dump"):
            # Pydantic v2
            return o.model_dump()
        elif hasattr(o, "dict"):
            # Pydantic v1
            return o.dict()

        # Handle dataclasses
        if dataclasses.is_dataclass(o) and not isinstance(o, type):
            return dataclasses.asdict(o)

        # Handle common non-serializable types
        if hasattr(o, "__dict__"):
            # Generic objects with __dict__
            return o.__dict__

        # Handle sets
        if isinstance(o, set):
            return list(o)

        # Handle bytes
        if isinstance(o, bytes):
            try:
                return o.decode("utf-8")
            except UnicodeDecodeError:
                return o.hex()

        # For other types, try to convert to string
        return str(o)

    try:
        return json.dumps(obj, default=default_encoder)
    except Exception:
        return str(obj)


def _end_span(
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
    span = get_current_span()
    breakpoint()
    span.set_attributes(
        _clean(
            {
                "braintrust.input_json": _safe_dumps(input) if input else None,
                "braintrust.output_json": _safe_dumps(output) if output else None,
                "braintrust.metadata": _safe_dumps(metadata) if metadata else None,
            }
        )
    )


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


def before_agent_callback(callback_context: CallbackContext):
    _start_span(
        name=callback_context.agent_name,
        type=SpanTypeAttribute.TASK,
        set_current=True,
        event={},
    )


def after_agent_callback(callback_context: CallbackContext):
    _end_span(
        metadata=_callback_context_to_metadata(callback_context),
    )


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
        name=callback_context.agent_name,
        type=SpanTypeAttribute.LLM,
        event={
            "input": _contents_to_input(llm_request.contents),
            "metadata": {
                **_callback_context_to_metadata(callback_context),
                "model": llm_request.model,
                **(llm_request.config.model_dump(exclude_none=True) if llm_request.config else {}),
            },
        },
    )


def _contents_to_input(contents: List[Content]):
    return [content.model_dump(exclude_none=True) for content in contents]


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
        output=llm_response.model_dump(exclude_none=True),
        metadata=_callback_context_to_metadata(callback_context),
    )


def before_tool_callback(tool: BaseTool, args: dict[str, Any], tool_context: ToolContext) -> Optional[dict]:
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
        output=tool_response,
        metadata=_tool_context_to_metadata(tool_context),
    )
