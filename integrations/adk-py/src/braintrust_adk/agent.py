from google.adk.agents import LlmAgent

from .callbacks import (
    after_model_callback,
    after_tool_callback,
    before_model_callback,
    before_tool_callback,
)


class Agent(LlmAgent):
    before_model_callback = before_model_callback
    after_model_callback = after_model_callback
    before_tool_callback = before_tool_callback
    after_tool_callback = after_tool_callback
