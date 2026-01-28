"""
Braintrust wrapper for Agno - provides observability for agent workflows.

This integration provides:
- Agent execution tracing with proper root spans
- LLM call tracing with proper nesting
- Tool call tracing with correct parent-child relationships

Usage:
    from braintrust.wrappers.agno import setup_agno

    # Initialize the integration
    setup_agno(project_name="my-project")

    # Your Agno agent code will now be automatically traced
    import agno
    agent = agno.Agent(...)
    response = agent.run(...)
"""

__all__ = ["setup_agno", "wrap_agent", "wrap_function_call", "wrap_model", "wrap_team"]

import logging

from braintrust.logger import NOOP_SPAN, current_span, init_logger

from .agent import wrap_agent
from .function_call import wrap_function_call
from .model import wrap_model
from .team import wrap_team

logger = logging.getLogger(__name__)


def setup_agno(
    api_key: str | None = None,
    project_id: str | None = None,
    project_name: str | None = None,
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

    try:
        from agno import agent, models, team, tools  # pyright: ignore

        agent.Agent = wrap_agent(agent.Agent)  # pyright: ignore[reportUnknownMemberType]
        team.Team = wrap_team(team.Team)  # pyright: ignore[reportUnknownMemberType]
        models.base.Model = wrap_model(models.base.Model)  # pyright: ignore[reportUnknownMemberType]
        tools.function.FunctionCall = wrap_function_call(tools.function.FunctionCall)  # pyright: ignore[reportUnknownMemberType]
        return True
    except ImportError:
        # Not installed - this is expected when using auto_instrument()
        return False
