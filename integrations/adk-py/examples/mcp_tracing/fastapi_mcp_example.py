"""
FastAPI + Google ADK + MCP + Braintrust - Complete Tracing Example

This example demonstrates how braintrust-adk automatically traces:
1. Agent execution
2. LLM calls (tool selection and response generation)
3. MCP tool invocations (NEW!)

Installation:
    cd examples/mcp_tracing
    uv sync
    export BRAINTRUST_API_KEY=your_key
    export GOOGLE_API_KEY=your_key

Usage:
    uvicorn fastapi_mcp_example:app --reload

Test:
    curl -X POST "http://localhost:8000/ask" \
      -H "Content-Type: application/json" \
      -d '{"question": "List files in /tmp"}'

View traces at: https://www.braintrust.dev/app
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from braintrust_adk import setup_adk
from fastapi import FastAPI
from google.adk import Runner
from google.adk.agents import LlmAgent
from google.adk.sessions import InMemorySessionService
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from google.genai import types
from mcp import StdioServerParameters
from pydantic import BaseModel


class QueryRequest(BaseModel):
    question: str


class QueryResponse(BaseModel):
    answer: str


runner: Runner | None = None
session_service: InMemorySessionService | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan manager.

    STARTUP:
    1. setup_adk() - patches ADK classes + McpTool for tracing
    2. Create agent with MCP tools
    3. Create runner
    """
    global runner, session_service

    print("Setting up Braintrust ADK integration with MCP tracing...")
    setup_adk(project_name="fastapi-adk-mcp")

    print("Creating session service...")
    session_service = InMemorySessionService()

    print("Creating agent with MCP filesystem tools...")
    agent = LlmAgent(
        name="filesystem_assistant",
        model="gemini-2.0-flash-exp",
        instruction="You are a helpful assistant that can read and list files.",
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

    runner = Runner(
        app_name="filesystem_app", agent=agent, session_service=session_service
    )

    print("Startup complete! MCP tool calls will be traced automatically.")
    yield

    print("Shutting down...")
    runner = None
    session_service = None


app = FastAPI(
    title="FastAPI + Google ADK + MCP + Braintrust",
    lifespan=lifespan,
)


@app.post("/ask", response_model=QueryResponse)
async def ask_question(request: QueryRequest) -> QueryResponse:
    """
    Process a question using Google ADK with MCP tools and Braintrust tracing.

    With setup_adk() called at startup, all tracing happens automatically:
    - Agent execution
    - LLM calls (tool selection + response generation)
    - MCP tool invocations (tool name, params, results) <- NEW!
    """
    print(f"\n=== Request: {request.question} ===")

    if runner is None or session_service is None:
        raise RuntimeError("Runner not initialized")

    session_id = "persistent-session"
    user_id = "fastapi-user"

    try:
        await session_service.create_session(
            app_name="filesystem_app", user_id=user_id, session_id=session_id
        )
        print(f"Created session: {session_id}")
    except Exception as e:
        print(f"Using existing session: {session_id}")

    new_message = types.Content(
        parts=[types.Part(text=request.question)],
        role="user",
    )

    events = runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=new_message,
    )

    answer_parts = []
    async for event in events:
        if hasattr(event, "content") and event.content:
            for part in event.content.parts:
                if hasattr(part, "text") and part.text:
                    answer_parts.append(part.text)

    answer = " ".join(answer_parts) if answer_parts else "No response"
    print(f"=== Response: {answer[:50]}... ===\n")

    return QueryResponse(answer=answer)


if __name__ == "__main__":
    import uvicorn

    print("""
╔══════════════════════════════════════════════════════════════╗
║  FastAPI + Google ADK + MCP + Braintrust                    ║
║  MCP Tool Tracing Example                                   ║
╚══════════════════════════════════════════════════════════════╝

Environment variables required:
- BRAINTRUST_API_KEY
- GOOGLE_API_KEY

Starting server on http://localhost:8000
Visit http://localhost:8000/docs to test

Check traces at: https://www.braintrust.dev/app
Look for mcp_tool spans showing tool name, params, and results!
    """)

    uvicorn.run(app, host="0.0.0.0", port=8000)
