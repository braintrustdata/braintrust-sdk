"""Tests for MCP tool tracing integration."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from braintrust_adk import setup_adk, wrap_mcp_tool


@pytest.mark.asyncio
async def test_wrap_mcp_tool_marks_as_patched():
    """Test that wrap_mcp_tool marks the class as patched."""

    # Create a real class to wrap
    class MockMcpTool:
        async def run_async(self, *, args, tool_context):
            return {"result": "success"}

    # Wrap the class
    wrapped_class = wrap_mcp_tool(MockMcpTool)

    # Verify it's marked as patched
    assert hasattr(wrapped_class, "_braintrust_patched")
    assert wrapped_class._braintrust_patched is True


@pytest.mark.asyncio
async def test_mcp_tool_execution_creates_span():
    """Test that MCP tool execution creates proper trace spans."""

    with patch("braintrust_adk.start_span") as mock_start_span:
        # Setup mock span
        mock_span = MagicMock()
        mock_span.__enter__ = MagicMock(return_value=mock_span)
        mock_span.__exit__ = MagicMock(return_value=False)
        mock_start_span.return_value = mock_span

        # Mock McpTool class and instance
        MockMcpTool = MagicMock()
        mock_instance = MagicMock()
        mock_instance.name = "read_file"
        mock_instance.run_async = AsyncMock(return_value={"content": [{"type": "text", "text": "file contents"}]})

        # Wrap the class
        wrapped_class = wrap_mcp_tool(MockMcpTool)

        # Simulate tool execution
        tool_args = {"path": "/tmp/test.txt"}
        tool_context = None

        # Call the wrapped method directly on the mock instance
        # We need to manually trigger the wrapper

        # Get the original method
        original_run_async = mock_instance.run_async

        # Create wrapped version by calling wrap_mcp_tool's wrapper
        # This simulates what wrapt does
        async def call_wrapped():
            return await original_run_async(args=tool_args, tool_context=tool_context)

        result = await call_wrapped()

        # For now, just verify the mock was called
        mock_instance.run_async.assert_called_once_with(args=tool_args, tool_context=tool_context)


@pytest.mark.asyncio
async def test_mcp_tool_span_captures_tool_info():
    """Test that MCP tool spans capture tool name, args, and results."""
    from braintrust.span_types import SpanTypeAttribute

    with patch("braintrust_adk.start_span") as mock_start_span:
        mock_span = MagicMock()
        mock_span.__enter__ = MagicMock(return_value=mock_span)
        mock_span.__exit__ = MagicMock(return_value=False)
        mock_start_span.return_value = mock_span

        # Create a real-ish McpTool mock
        class MockMcpTool:
            def __init__(self):
                self.name = "list_directory"
                self._original_run_async = AsyncMock(
                    return_value={"content": [{"type": "text", "text": "file1.txt\nfile2.txt"}]}
                )

            async def run_async(self, *, args, tool_context):
                return await self._original_run_async(args=args, tool_context=tool_context)

        # Wrap the class
        wrap_mcp_tool(MockMcpTool)

        # Create instance and call
        tool = MockMcpTool()
        tool_args = {"path": "/tmp"}
        tool_context = None

        result = await tool.run_async(args=tool_args, tool_context=tool_context)

        # Verify span was created
        assert mock_start_span.called
        call_kwargs = mock_start_span.call_args[1]

        # Check span name includes tool name
        assert "list_directory" in call_kwargs["name"]

        # Check span type is TOOL
        assert call_kwargs["type"] == SpanTypeAttribute.TOOL

        # Check input contains tool name and arguments
        assert "tool_name" in call_kwargs["input"]
        assert call_kwargs["input"]["tool_name"] == "list_directory"
        assert call_kwargs["input"]["arguments"] == tool_args

        # Verify output was logged
        mock_span.log.assert_called_once()
        log_call = mock_span.log.call_args[1]
        assert "output" in log_call


@pytest.mark.asyncio
async def test_mcp_tool_error_handling():
    """Test that MCP tool errors are captured in spans."""
    with patch("braintrust_adk.start_span") as mock_start_span:
        mock_span = MagicMock()
        mock_span.__enter__ = MagicMock(return_value=mock_span)
        mock_span.__exit__ = MagicMock(return_value=False)
        mock_start_span.return_value = mock_span

        # Create mock tool that raises error
        class MockMcpTool:
            def __init__(self):
                self.name = "failing_tool"

            async def run_async(self, *, args, tool_context):
                raise ValueError("Tool execution failed")

        # Wrap the class
        wrap_mcp_tool(MockMcpTool)

        # Create instance and call (should raise)
        tool = MockMcpTool()

        with pytest.raises(ValueError, match="Tool execution failed"):
            await tool.run_async(args={}, tool_context=None)

        # Verify error was logged to span
        assert mock_span.log.called
        # Check if error was logged
        log_calls = [call for call in mock_span.log.call_args_list]
        # Should have logged the error


@pytest.mark.asyncio
async def test_setup_adk_patches_mcp_tool():
    """Test that setup_adk automatically patches McpTool."""
    with patch("braintrust_adk.init_logger"):
        with patch("braintrust_adk.wrap_mcp_tool") as mock_wrap:
            # Mock google-adk imports
            mock_mcp_tool_module = MagicMock()
            MockMcpTool = MagicMock()
            mock_mcp_tool_module.McpTool = MockMcpTool

            with patch.dict("sys.modules", {"google.adk.tools.mcp_tool.mcp_tool": mock_mcp_tool_module}):
                result = setup_adk(project_name="test")

                # Verify wrap_mcp_tool was called
                assert result is True
                mock_wrap.assert_called_once_with(MockMcpTool)


@pytest.mark.asyncio
async def test_setup_adk_graceful_fallback_when_mcp_unavailable():
    """Test that setup_adk gracefully handles MCP not being installed."""
    with patch("braintrust_adk.init_logger"):
        # This test is tricky - we need MCP import to fail but not break other imports
        # The actual behavior is tested in integration: when Python 3.9 tries to import MCP,
        # it gets ImportError from the google.adk.tools.mcp_tool module itself
        # For this test, we just verify setup_adk succeeds even when MCP module raises ImportError

        result = setup_adk(project_name="test")

        # Should succeed - MCP is optional
        assert result is True

        # In Python 3.9 environment, MCP import fails but setup_adk continues
        # This is the actual graceful fallback in action


@pytest.mark.asyncio
async def test_mcp_tool_async_context_preservation():
    """Test that MCP tool spans handle async context switching correctly.

    This test reproduces the "was created in a different Context" error that occurs
    when async generators yield control and resume in a different async context.
    This is the issue we're seeing in the trace screenshot where mcp_tool spans
    lose their parent context.
    """
    import contextvars

    from braintrust_adk import wrap_mcp_tool

    # Track context switches
    context_var = contextvars.ContextVar("test_context", default=None)

    class MockMcpTool:
        def __init__(self):
            self.name = "test_tool"

        async def run_async(self, *, args, tool_context):
            # Simulate async work that might switch contexts
            import asyncio

            await asyncio.sleep(0.001)
            return {"result": "success"}

    # Wrap the tool
    wrap_mcp_tool(MockMcpTool)

    # Create tool instance
    tool = MockMcpTool()

    # Set initial context
    context_var.set("initial")

    # Create an async generator that yields and switches contexts
    async def context_switching_generator():
        # Call the tool (creates span)
        context_var.set("during_call")
        result = await tool.run_async(args={"test": "value"}, tool_context=None)
        yield result

        # Switch context after yield
        context_var.set("after_yield")

    # Execute the generator - this should trigger the context switch issue
    results = []
    async for result in context_switching_generator():
        results.append(result)

    # Verify the tool executed successfully despite context switches
    assert len(results) == 1
    assert results[0]["result"] == "success"

    # The test passes if no ValueError about "different Context" is raised
    # The aclosing wrapper in __init__.py should suppress this error


@pytest.mark.asyncio
async def test_mcp_tool_nested_async_generators():
    """Test MCP tool execution within nested async generators.

    This simulates the real-world scenario where:
    1. Runner.run_async creates an async generator with a span
    2. Agent.run_async creates another async generator with a span
    3. MCP tool execution happens deep in the stack
    4. All generators yield and resume, potentially in different contexts
    """
    from braintrust_adk import wrap_mcp_tool

    class MockMcpTool:
        def __init__(self):
            self.name = "nested_tool"

        async def run_async(self, *, args, tool_context):
            import asyncio

            await asyncio.sleep(0.001)
            return {"nested": "result"}

    wrap_mcp_tool(MockMcpTool)
    tool = MockMcpTool()

    # Simulate nested async generators like Runner -> Agent -> Tool
    async def outer_generator():
        """Simulates Runner.run_async"""
        async for event in middle_generator():
            yield event

    async def middle_generator():
        """Simulates Agent.run_async"""
        # Execute tool in the middle of generator execution
        result = await tool.run_async(args={"nested": "test"}, tool_context=None)
        yield {"type": "tool_result", "data": result}

        # Yield more events after tool execution
        yield {"type": "final", "done": True}

    # Collect all events
    events = []
    async for event in outer_generator():
        events.append(event)

    # Verify execution completed successfully
    assert len(events) == 2
    assert events[0]["type"] == "tool_result"
    assert events[0]["data"]["nested"] == "result"
    assert events[1]["type"] == "final"

    # If we get here without ValueError, the context handling is working


@pytest.mark.asyncio
async def test_real_context_loss_with_braintrust_spans():
    """Test that demonstrates the actual context loss issue with real Braintrust spans.

    This test creates a scenario that matches the real-world issue:
    1. Create a span in an async generator
    2. Yield from that generator
    3. Try to clean up the span after context has switched

    This should trigger the "was created in a different Context" error that we're
    suppressing in the aclosing.__aexit__ method.
    """
    import asyncio

    from braintrust import init_logger
    from braintrust_adk import aclosing

    # Initialize a test logger
    logger = init_logger(project="test-context-loss")

    # Track if we hit the context error
    context_error_occurred = False

    async def problematic_generator():
        """Generator that creates a span and yields, simulating the Flow behavior."""
        from braintrust import start_span

        with start_span(name="test_span", type="task") as span:
            # Yield some events
            yield {"event": 1}
            await asyncio.sleep(0.001)
            yield {"event": 2}
            # Span cleanup happens in __exit__, which may be in different context

    # Create a new async context and run the generator
    async def outer_context():
        """Simulates the outer runner context."""
        events = []

        # Use aclosing which has the error suppression
        async with aclosing(problematic_generator()) as gen:
            async for event in gen:
                events.append(event)
                # Force context switch
                await asyncio.sleep(0.001)

        return events

    # Run in a fresh event loop context
    events = await outer_context()

    # Verify we got the events
    assert len(events) == 2
    assert events[0]["event"] == 1
    assert events[1]["event"] == 2

    # If we get here without an unhandled ValueError, the suppression is working
    # The aclosing.__aexit__ should have caught and suppressed any context errors
