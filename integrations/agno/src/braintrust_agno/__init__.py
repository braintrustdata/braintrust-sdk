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

__all__ = ["setup_braintrust"]

import logging
from typing import Optional

from braintrust.logger import NOOP_SPAN, current_span, init_logger

from braintrust_agno.agent import wrap_agent
from braintrust_agno.function_call import wrap_function_call
from braintrust_agno.model import wrap_model
from braintrust_agno.team import wrap_team

logger = logging.getLogger(__name__)


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

    try:
        from agno import agent, models, team, tools

        agent.Agent = wrap_agent(agent.Agent)
        team.Team = wrap_team(team.Team)
        models.base.Model = wrap_model(models.base.Model)
        tools.function.FunctionCall = wrap_function_call(tools.function.FunctionCall)
        return True
    except ImportError as e:
        logger.error(f"Failed to import Agno: {e}")
        logger.error("Agno is not installed. Please install it with: pip install agno")
        return False
