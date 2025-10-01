import dataclasses
import logging
import threading
import time
from typing import Any, AsyncGenerator, Callable, Dict, List, Optional, Tuple

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute
from braintrust.wrappers._anthropic_utils import Wrapper, extract_anthropic_usage, finalize_anthropic_tokens

log = logging.getLogger(__name__)

# Thread-local storage to propagate parent span export to tool handlers
# The Claude Agent SDK may execute tools in separate async contexts that don't
# preserve contextvars, so we use threading.local() as a fallback
_thread_local = threading.local()


class ClaudeAgentSDKWrapper(Wrapper):
    """Main wrapper for claude_agent_sdk module. Intercepts query and tool creation."""

    def __init__(self, sdk: Any):
        super().__init__(sdk)
        self.__sdk = sdk

    @property
    def query(self) -> Any:
        """Pass through query without wrapping - use ClaudeSDKClient for tracing."""
        return self.__sdk.query

    @property
    def SdkMcpTool(self) -> Any:
        """Intercept SdkMcpTool to wrap handlers."""
        return _create_tool_wrapper_class(self.__sdk.SdkMcpTool)

    @property
    def tool(self) -> Any:
        """Intercept tool() function if it exists."""
        if hasattr(self.__sdk, "tool"):
            return _wrap_tool_factory(self.__sdk.tool)
        raise AttributeError("tool")

    @property
    def ClaudeSDKClient(self) -> Any:
        """Intercept ClaudeSDKClient class to wrap its methods."""
        if hasattr(self.__sdk, "ClaudeSDKClient"):
            return _create_client_wrapper_class(self.__sdk.ClaudeSDKClient)
        raise AttributeError("ClaudeSDKClient")


def _create_tool_wrapper_class(original_tool_class: Any) -> Any:
    """Creates a wrapper class for SdkMcpTool that wraps handlers."""

    class WrappedSdkMcpTool(original_tool_class):  # type: ignore[valid-type,misc]
        def __init__(
            self,
            name: Any,
            description: Any,
            input_schema: Any,
            handler: Any,
            **kwargs: Any,
        ):
            wrapped_handler = _wrap_tool_handler(handler, name)
            super().__init__(name, description, input_schema, wrapped_handler, **kwargs)  # type: ignore[call-arg]

    return WrappedSdkMcpTool


def _wrap_tool_factory(tool_fn: Any) -> Callable[..., Any]:
    """Wraps the tool() factory function to return wrapped tools."""

    def wrapped_tool(*args: Any, **kwargs: Any) -> Any:
        result = tool_fn(*args, **kwargs)

        # The tool() function returns a decorator, not a tool definition
        # We need to wrap the decorator to intercept the final tool definition
        if not callable(result):
            return result

        def wrapped_decorator(handler_fn: Any) -> Any:
            tool_def = result(handler_fn)

            # Now we have the actual tool definition, wrap its handler
            if tool_def and hasattr(tool_def, "handler"):
                tool_name = getattr(tool_def, "name", "unknown")
                original_handler = tool_def.handler
                tool_def.handler = _wrap_tool_handler(original_handler, tool_name)

            return tool_def

        return wrapped_decorator

    return wrapped_tool


def _wrap_tool_handler(handler: Any, tool_name: Any) -> Callable[..., Any]:
    """Wraps a tool handler to add tracing.

    Uses start_span context manager which automatically:
    - Handles exceptions and logs them to the span
    - Sets the span as current for nested operations
    - Nests under the parent span (TASK span) via the parent parameter

    The Claude Agent SDK may execute tool handlers in a separate async context,
    so we try the context variable first, then fall back to current_span export.
    """

    async def wrapped_handler(args: Any) -> Any:
        # Get parent span export from thread-local storage
        parent_export = getattr(_thread_local, 'parent_span_export', None)

        with start_span(
            name=str(tool_name),
            span_attributes={"type": SpanTypeAttribute.TOOL},
            input=args,
            parent=parent_export,
        ) as span:
            result = await handler(args)
            span.log(output=result)
            return result

    return wrapped_handler


def _create_client_wrapper_class(original_client_class: Any) -> Any:
    """Creates a wrapper class for ClaudeSDKClient that wraps query and receive_response."""

    class WrappedClaudeSDKClient(Wrapper):
        def __init__(self, *args: Any, **kwargs: Any):
            # Create the original client instance
            client = original_client_class(*args, **kwargs)
            super().__init__(client)
            self.__client = client
            self.__last_prompt: Optional[str] = None

        async def query(self, *args: Any, **kwargs: Any) -> Any:
            """Wrap query to capture the prompt for tracing."""
            # Capture the prompt for use in receive_response
            if args:
                self.__last_prompt = str(args[0])
            elif "prompt" in kwargs:
                self.__last_prompt = str(kwargs["prompt"])

            return await self.__client.query(*args, **kwargs)

        async def receive_response(self) -> AsyncGenerator[Any, None]:
            """Wrap receive_response to add tracing.

            Uses start_span context manager which automatically:
            - Handles exceptions and logs them as errors
            - Sets the span as current so tool calls automatically nest under it
            - Manages span lifecycle (start/end)
            """
            generator = self.__client.receive_response()

            with start_span(
                name="Claude Agent",
                span_attributes={"type": SpanTypeAttribute.TASK},
                input=self.__last_prompt if self.__last_prompt else None,
            ) as span:
                # Store the parent span export in thread-local storage for tool handlers
                _thread_local.parent_span_export = span.export()

                final_results: List[Dict[str, Any]] = []
                last_llm_span: Optional[Any] = None
                # Record start time for the first LLM call (starts immediately)
                llm_start_time: Optional[float] = time.time()

                try:
                    try:
                        async for message in generator:
                            # Detect message type by class name
                            message_type = type(message).__name__

                            # Handle assistant messages - create LLM span immediately (no grouping)
                            if message_type == "AssistantMessage":
                                # End the previous LLM span if it exists
                                if last_llm_span:
                                    last_llm_span.end()

                                final_content, llm_span = _create_llm_span_for_messages(
                                    [message],
                                    self.__last_prompt,
                                    final_results,
                                    start_time=llm_start_time,
                                )
                                if final_content:
                                    final_results.append(final_content)

                                last_llm_span = llm_span

                                # Reset for next LLM call
                                llm_start_time = None

                            # Handle user messages (tool results) - add to conversation history
                            elif message_type == "UserMessage":
                                if hasattr(message, "content"):
                                    content = _serialize_content_blocks(message.content)
                                    final_results.append({"content": content, "role": "user"})

                                # After tool results, the next LLM call starts
                                llm_start_time = time.time()

                            # Capture usage from result message and log to the last LLM span
                            elif message_type == "ResultMessage":
                                if hasattr(message, "usage") and last_llm_span:
                                    # Extract usage metrics and log to the last LLM span
                                    usage_metrics = _extract_usage_from_result_message(message)
                                    if usage_metrics:
                                        last_llm_span.log(metrics=usage_metrics)

                                # Log metadata to the query TASK span
                                result_metadata = {
                                    k: v for k, v in {
                                        "num_turns": getattr(message, "num_turns", None),
                                        "session_id": getattr(message, "session_id", None),
                                    }.items() if v is not None
                                }
                                if result_metadata:
                                    span.log(metadata=result_metadata)

                            yield message

                        # Log final output to top-level span
                        span.log(output=final_results[-1] if final_results else None)
                    except Exception as e:
                        log.warning("Error in tracing code", exc_info=e)
                finally:
                    # Clean up: always end the last LLM span if it exists
                    if last_llm_span:
                        try:
                            last_llm_span.end()
                        except Exception as e:
                            log.warning("Error ending LLM span", exc_info=e)

                    # Clean up thread-local storage to prevent memory leaks
                    if hasattr(_thread_local, 'parent_span_export'):
                        delattr(_thread_local, 'parent_span_export')

        async def __aenter__(self) -> "WrappedClaudeSDKClient":
            await self.__client.__aenter__()
            return self

        async def __aexit__(self, *args: Any) -> None:
            await self.__client.__aexit__(*args)

    return WrappedClaudeSDKClient


def _create_llm_span_for_messages(
    messages: List[Any],  # List of AssistantMessage objects
    prompt: Any,
    conversation_history: List[Dict[str, Any]],
    start_time: Optional[float] = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[Any]]:
    """Creates an LLM span for a group of AssistantMessage objects.

    Returns a tuple of (final_content, span):
    - final_content: The final message content to add to conversation history
    - span: The LLM span object (for logging metrics later)

    Automatically nests under the current span (TASK span from receive_response).

    Note: This is called from within a catch_exceptions block, so errors won't break user code.
    """
    if not messages:
        return None, None

    last_message = messages[-1]
    # Check if this is an AssistantMessage
    if type(last_message).__name__ != "AssistantMessage":
        return None, None

    # Extract model from message
    model = getattr(last_message, "model", None)

    # Build input from prompt and conversation history
    input_messages = _build_llm_input(prompt, conversation_history)

    # Extract outputs from AssistantMessages
    outputs: List[Dict[str, Any]] = []
    for msg in messages:
        if hasattr(msg, "content"):
            # Convert content blocks to a serializable format
            content = _serialize_content_blocks(msg.content)
            outputs.append({"content": content, "role": "assistant"})

    # Create LLM span - automatically nests under current span
    # Note: We don't use a context manager here because we need to return the span
    # to log metrics to it later and end it when we get the ResultMessage.
    llm_span = start_span(
        name="anthropic.messages.create",
        span_attributes={"type": SpanTypeAttribute.LLM},
        input=input_messages,
        output=outputs,
        metadata={"model": model} if model else None,
        start_time=start_time,
    )

    # Return final message content for conversation history and the span
    if hasattr(last_message, "content"):
        content = _serialize_content_blocks(last_message.content)
        return {"content": content, "role": "assistant"}, llm_span

    return None, llm_span


def _serialize_content_blocks(content: Any) -> Any:
    """Converts content blocks to a serializable format with proper type fields.

    Claude Agent SDK uses dataclasses for content blocks, so we use dataclasses.asdict()
    for serialization and add the 'type' field based on the class name.
    """
    if isinstance(content, list):
        result = []
        for block in content:
            # Claude Agent SDK content blocks are dataclasses
            if dataclasses.is_dataclass(block):
                serialized = dataclasses.asdict(block)

                # Add type field based on class name for Braintrust UI rendering
                block_type = type(block).__name__
                if block_type == "TextBlock":
                    serialized["type"] = "text"
                elif block_type == "ToolUseBlock":
                    serialized["type"] = "tool_use"
                elif block_type == "ToolResultBlock":
                    serialized["type"] = "tool_result"

                    # Simplify tool result content for better UI rendering
                    content_value = serialized.get("content")
                    # If content is an array with a single text block, flatten it to just the text string
                    if isinstance(content_value, list) and len(content_value) == 1:
                        item = content_value[0]
                        if isinstance(item, dict) and item.get("type") == "text" and "text" in item:
                            serialized["content"] = item["text"]

                    # Remove is_error field if it's None/null for cleaner schema compliance
                    if "is_error" in serialized and serialized["is_error"] is None:
                        del serialized["is_error"]
            else:
                # Fallback for non-dataclass blocks (shouldn't happen with Claude Agent SDK)
                serialized = block

            result.append(serialized)
        return result
    return content


def _extract_usage_from_result_message(result_message: Any) -> Dict[str, float]:
    """Extracts and normalizes usage metrics from a ResultMessage.

    Uses shared Anthropic utilities for consistent metric extraction.
    """
    if not hasattr(result_message, "usage"):
        return {}

    usage = result_message.usage
    if not usage:
        return {}

    # Use shared utility to extract and finalize metrics
    metrics = extract_anthropic_usage(usage)
    if metrics:
        metrics = finalize_anthropic_tokens(metrics)

    return metrics


def _build_llm_input(
    prompt: Any, conversation_history: List[Dict[str, Any]]
) -> Optional[List[Dict[str, Any]]]:
    """Builds the input array for an LLM span from the initial prompt and conversation history.

    Formats input to match Anthropic messages API format for proper UI rendering.
    """
    # For the first LLM call, prepend the user prompt as a string (not array)
    if isinstance(prompt, str):
        if len(conversation_history) == 0:
            return [{"content": prompt, "role": "user"}]
        else:
            # Include prompt at the beginning of conversation
            return [{"content": prompt, "role": "user"}] + conversation_history

    return conversation_history if conversation_history else None


def wrap_claude_agent_sdk(sdk: Any) -> Any:
    """
    Wrap the Claude Agent SDK module to add Braintrust tracing.

    This wraps the query() function and tool creation to automatically trace:
    - Agent interactions (as TASK spans)
    - LLM calls (as LLM spans)
    - Tool executions (as TOOL spans)

    If Braintrust is not configured, tracing will be minimal overhead.

    :param sdk: The claude_agent_sdk module
    :return: Wrapped module with tracing

    Example:
        ```python
        import claude_agent_sdk
        from braintrust import init_logger, wrap_claude_agent_sdk

        init_logger(project="my-project")
        claude_agent_sdk = wrap_claude_agent_sdk(claude_agent_sdk)

        # Use ClaudeSDKClient for automatic tracing
        options = claude_agent_sdk.ClaudeAgentOptions(
            model="claude-sonnet-4-5-20250929"
        )
        async with claude_agent_sdk.ClaudeSDKClient(options=options) as client:
            await client.query("Hello!")
            async for message in client.receive_response():
                print(message)
        ```
    """
    return ClaudeAgentSDKWrapper(sdk)
