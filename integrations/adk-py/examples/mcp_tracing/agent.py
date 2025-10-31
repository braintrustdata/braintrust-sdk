"""
Example showing automatic tracing of MCP tool invocations.

This demonstrates how braintrust-adk automatically traces:
1. Agent execution
2. LLM calls (tool selection and response generation)
3. MCP tool invocations - tool name, parameters, results, and duration

Requirements:
    Python 3.10+ (MCP requirement)
    export GOOGLE_API_KEY=your_key

Usage:
    python agent.py
"""

import asyncio

from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from google.genai import types
from mcp import StdioServerParameters

from braintrust_adk import setup_adk

# Setup Braintrust integration - automatically patches agents, runners, flows, and MCP tools
setup_adk(project_name="adk-mcp-example")


async def main():
    """Run the MCP tool tracing example."""

    # Create agent with MCP filesystem tools
    agent = LlmAgent(
        name="filesystem_assistant",
        model="gemini-2.0-flash-exp",
        instruction="You are a helpful assistant that can read and list files. Be concise in your responses.",
        tools=[
            MCPToolset(
                connection_params=StdioConnectionParams(
                    server_params=StdioServerParameters(
                        command="npx",
                        args=[
                            "-y",
                            "@modelcontextprotocol/server-filesystem",
                            "/tmp",  # Limit to /tmp for safety
                        ],
                    ),
                ),
                tool_filter=["list_directory", "read_file"],
            )
        ],
    )

    # Setup session
    APP_NAME = "filesystem_app"
    USER_ID = "demo-user"
    SESSION_ID = "demo-session"

    session_service = InMemorySessionService()
    await session_service.create_session(
        app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID
    )

    runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)

    # Make a request that will use MCP tools
    print("\n=== Asking agent to list files in /tmp ===\n")
    user_msg = types.Content(
        role="user",
        parts=[types.Part(text="What files are in /tmp? Just list a few.")],
    )

    async for event in runner.run_async(
        user_id=USER_ID, session_id=SESSION_ID, new_message=user_msg
    ):
        if event.is_final_response():
            text = (
                event.content.parts[0].text
                if event.content and event.content.parts
                else "No response"
            )
            print(f"Agent response: {text}\n")

    print("=== Trace complete ===")
    print("View traces at: https://www.braintrust.dev/app")
    print("Project: adk-mcp-example")
    print("\nLook for 'mcp_tool [list_directory]' span showing:")
    print("  - Tool name and arguments")
    print("  - Tool execution results")
    print("  - Duration")


if __name__ == "__main__":
    asyncio.run(main())
