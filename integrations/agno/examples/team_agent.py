from braintrust_agno import setup_braintrust

# Set up Braintrust observability
setup_braintrust(project_name="team-agent-project")

from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.team import Team
from agno.tools.yfinance import YFinanceTools

# Create specialized agents for the team
research_agent = Agent(
    name="Research Analyst",
    model=OpenAIChat(id="gpt-4o-mini"),
    tools=[YFinanceTools()],
    instructions="""You are a financial research analyst. Your job is to:
    1. Gather financial data and market information
    2. Analyze stock performance and trends
    3. Provide factual, data-driven insights
    Keep your responses concise and focused on the data.""",
    debug_mode=True,
)

advisor_agent = Agent(
    name="Investment Advisor",
    model=OpenAIChat(id="gpt-4o-mini"),
    instructions="""You are an investment advisor. Your job is to:
    1. Take research findings from the analyst
    2. Provide investment recommendations
    3. Explain risk factors and potential outcomes
    Always base recommendations on the research data provided.""",
    debug_mode=True,
)

# Create a team with both agents
investment_team = Team(
    name="Investment Research Team",
    model=OpenAIChat(id="gpt-4o-mini"),
    members=[research_agent, advisor_agent],
    instructions="""You are a team of financial experts working together.
    The Research Analyst should first gather and analyze data.
    The Investment Advisor should then provide recommendations based on that analysis.
    Work collaboratively to provide comprehensive financial advice.""",
    debug_mode=True,
)

investment_team.print_response(
    "I'm considering investing in Apple (AAPL). Can you analyze the current stock performance and give me investment advice?",
    session_id="team_session_apple"
)

investment_team.print_response(
    "Compare Microsoft (MSFT) and Google (GOOGL) for a long-term investment. Which would be better for a conservative portfolio?",
    session_id="team_session_comparison"
)

investment_team.print_response(
    "What are the current trends in the tech sector? Should I be worried about market volatility?",
    session_id="team_session_trends"
)
