from google.adk.agents import LlmAgent

from .callbacks import (
    after_agent_callback,
    after_model_callback,
    after_tool_callback,
    before_agent_callback,
    before_model_callback,
    before_tool_callback,
)


class Agent(LlmAgent):
    after_agent_callback = after_agent_callback
    after_model_callback = after_model_callback
    after_tool_callback = after_tool_callback
    before_agent_callback = before_agent_callback
    before_model_callback = before_model_callback
    before_tool_callback = before_tool_callback
