from typing import (
    Any,
    Optional,
)

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext


def before_agent_callback(callback_context: CallbackContext):
    pass


def after_agent_callback(callback_context: CallbackContext):
    pass


def before_model_callback(callback_context: CallbackContext, llm_request: LlmRequest):
    pass


def after_model_callback(callback_context: CallbackContext, llm_response: LlmResponse):
    pass


def before_tool_callback(
    tool: BaseTool, args: dict[str, Any], tool_context: ToolContext
) -> Optional[dict]:
    pass


def after_tool_callback(
    tool: BaseTool, args: dict[str, Any], tool_context: ToolContext, tool_response: dict
) -> Optional[dict]:
    pass
