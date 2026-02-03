"""
Braintrust integration for Claude Agent SDK with automatic tracing.

Usage (imports can be before or after setup):
    from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
    from braintrust.wrappers.claude_agent_sdk import setup_claude_agent_sdk

    setup_claude_agent_sdk(project="my-project")

    # Use normally - all calls are automatically traced
    options = ClaudeAgentOptions(model="claude-sonnet-4-5-20250929")
    async with ClaudeSDKClient(options=options) as client:
        await client.query("Hello!")
        async for message in client.receive_response():
            print(message)
"""

import logging

from braintrust.logger import NOOP_SPAN, current_span, init_logger

from ._wrapper import _create_client_wrapper_class, _create_tool_wrapper_class, _wrap_tool_factory

logger = logging.getLogger(__name__)

__all__ = ["setup_claude_agent_sdk"]


def setup_claude_agent_sdk(
    api_key: str | None = None,
    project_id: str | None = None,
    project: str | None = None,
) -> bool:
    """
    Setup Braintrust integration with Claude Agent SDK. Will automatically patch the SDK for automatic tracing.

    Args:
        api_key (Optional[str]): Braintrust API key.
        project_id (Optional[str]): Braintrust project ID.
        project (Optional[str]): Braintrust project name.

    Returns:
        bool: True if setup was successful, False otherwise.

    Example:
        ```python
        import claude_agent_sdk
        from braintrust.wrappers.claude_agent_sdk import setup_claude_agent_sdk

        setup_claude_agent_sdk(project="my-project")

        # Now use claude_agent_sdk normally - all calls automatically traced
        options = claude_agent_sdk.ClaudeAgentOptions(model="claude-sonnet-4-5-20250929")
        async with claude_agent_sdk.ClaudeSDKClient(options=options) as client:
            await client.query("Hello!")
            async for message in client.receive_response():
                print(message)
        ```
    """
    span = current_span()
    if span == NOOP_SPAN:
        init_logger(project=project, api_key=api_key, project_id=project_id)

    try:
        import sys

        import claude_agent_sdk

        # Store original classes before patching
        original_client = claude_agent_sdk.ClaudeSDKClient if hasattr(claude_agent_sdk, "ClaudeSDKClient") else None
        original_tool_class = claude_agent_sdk.SdkMcpTool if hasattr(claude_agent_sdk, "SdkMcpTool") else None
        original_tool_fn = claude_agent_sdk.tool if hasattr(claude_agent_sdk, "tool") else None

        # Patch ClaudeSDKClient
        if original_client:
            wrapped_client = _create_client_wrapper_class(original_client)
            claude_agent_sdk.ClaudeSDKClient = wrapped_client

            # Update all modules that already imported ClaudeSDKClient
            for module in list(sys.modules.values()):
                if module and hasattr(module, "ClaudeSDKClient"):
                    if getattr(module, "ClaudeSDKClient", None) is original_client:
                        setattr(module, "ClaudeSDKClient", wrapped_client)

        # Patch SdkMcpTool
        if original_tool_class:
            wrapped_tool_class = _create_tool_wrapper_class(original_tool_class)
            claude_agent_sdk.SdkMcpTool = wrapped_tool_class

            # Update all modules that already imported SdkMcpTool
            for module in list(sys.modules.values()):
                if module and hasattr(module, "SdkMcpTool"):
                    if getattr(module, "SdkMcpTool", None) is original_tool_class:
                        setattr(module, "SdkMcpTool", wrapped_tool_class)

        # Patch tool() decorator
        if original_tool_fn:
            wrapped_tool_fn = _wrap_tool_factory(original_tool_fn)
            claude_agent_sdk.tool = wrapped_tool_fn

            # Update all modules that already imported tool
            for module in list(sys.modules.values()):
                if module and hasattr(module, "tool"):
                    if getattr(module, "tool", None) is original_tool_fn:
                        setattr(module, "tool", wrapped_tool_fn)

        return True
    except ImportError:
        # Not installed - this is expected when using auto_instrument()
        return False
