import dataclasses
import logging
import threading
import time
from collections.abc import AsyncGenerator, AsyncIterable, Callable
from typing import Any

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute
from braintrust.wrappers._anthropic_utils import Wrapper, extract_anthropic_usage, finalize_anthropic_tokens

log = logging.getLogger(__name__)

# Thread-local storage to propagate parent span export to tool handlers
# The Claude Agent SDK may execute tools in separate async contexts that don't
# preserve contextvars, so we use threading.local()
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

        # Preserve generic typing support
        __class_getitem__ = classmethod(lambda cls, params: cls)  # type: ignore[assignment]

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
    # Check if already wrapped to prevent double-wrapping
    if hasattr(handler, "_braintrust_wrapped"):
        return handler

    async def wrapped_handler(args: Any) -> Any:
        # Get parent span export from thread-local storage
        parent_export = getattr(_thread_local, "parent_span_export", None)

        with start_span(
            name=str(tool_name),
            span_attributes={"type": SpanTypeAttribute.TOOL},
            input=args,
            parent=parent_export,
        ) as span:
            result = await handler(args)
            span.log(output=result)
            return result

    # Mark as wrapped to prevent double-wrapping
    wrapped_handler._braintrust_wrapped = True  # type: ignore[attr-defined]
    return wrapped_handler


def _create_client_wrapper_class(original_client_class: Any) -> Any:
    """Creates a wrapper class for ClaudeSDKClient that wraps query and receive_response."""

    class LLMSpanTracker:
        """Manages LLM span lifecycle for Claude Agent SDK message streams.

        Message flow per turn:
        1. UserMessage (tool results) → mark the time when next LLM will start
        2. AssistantMessage - LLM response arrives → create span with the marked start time, ending previous span
        3. ResultMessage - usage metrics → log to span

        We end the previous span when the next AssistantMessage arrives, using the marked
        start time to ensure sequential timing (no overlapping LLM spans).
        """

        def __init__(self, query_start_time: float | None = None):
            self.current_span: Any | None = None
            self.next_start_time: float | None = query_start_time

        def start_llm_span(
            self, message: Any, prompt: Any, conversation_history: list[dict[str, Any]]
        ) -> dict[str, Any] | None:
            """Start a new LLM span, ending the previous one if it exists."""
            # Use the marked start time, or current time as fallback
            start_time = self.next_start_time if self.next_start_time is not None else time.time()

            # End the previous span at this start time to ensure sequential spans
            if self.current_span:
                self.current_span.end(end_time=start_time)

            final_content, span = _create_llm_span_for_messages(
                [message], prompt, conversation_history, start_time=start_time
            )
            self.current_span = span
            self.next_start_time = None  # Reset for next span
            return final_content

        def mark_next_llm_start(self) -> None:
            """Mark when the next LLM call will start (after tool results)."""
            self.next_start_time = time.time()

        def log_usage(self, usage_metrics: dict[str, float]) -> None:
            """Log usage metrics to the current LLM span."""
            if self.current_span and usage_metrics:
                self.current_span.log(metrics=usage_metrics)

        def cleanup(self) -> None:
            """End any unclosed spans."""
            if self.current_span:
                self.current_span.end()
                self.current_span = None

    class WrappedClaudeSDKClient(Wrapper):
        def __init__(self, *args: Any, **kwargs: Any):
            # Create the original client instance
            client = original_client_class(*args, **kwargs)
            super().__init__(client)
            self.__client = client
            self.__last_prompt: str | None = None
            self.__query_start_time: float | None = None
            self.__captured_messages: list[dict[str, Any]] | None = None

        async def query(self, *args: Any, **kwargs: Any) -> Any:
            """Wrap query to capture the prompt and start time for tracing."""
            # Capture the time when query is called (when LLM call starts)
            self.__query_start_time = time.time()
            self.__captured_messages = None

            # Capture the prompt for use in receive_response
            prompt = args[0] if args else kwargs.get("prompt")

            if prompt is not None:
                if isinstance(prompt, str):
                    self.__last_prompt = prompt
                elif isinstance(prompt, AsyncIterable):
                    # AsyncIterable[dict] - wrap it to capture messages as they're yielded
                    captured: list[dict[str, Any]] = []
                    self.__captured_messages = captured
                    self.__last_prompt = None  # Will be set after messages are captured

                    async def capturing_wrapper() -> AsyncGenerator[dict[str, Any], None]:
                        async for msg in prompt:
                            captured.append(msg)
                            yield msg

                    # Replace the prompt with our capturing wrapper
                    if args:
                        args = (capturing_wrapper(),) + args[1:]
                    else:
                        kwargs["prompt"] = capturing_wrapper()
                else:
                    self.__last_prompt = str(prompt)

            return await self.__client.query(*args, **kwargs)

        async def receive_response(self) -> AsyncGenerator[Any, None]:
            """Wrap receive_response to add tracing.

            Uses start_span context manager which automatically:
            - Handles exceptions and logs them as errors
            - Sets the span as current so tool calls automatically nest under it
            - Manages span lifecycle (start/end)
            """
            generator = self.__client.receive_response()

            # Determine the initial input - may be updated later if using async generator
            initial_input = self.__last_prompt if self.__last_prompt else None

            with start_span(
                name="Claude Agent",
                span_attributes={"type": SpanTypeAttribute.TASK},
                input=initial_input,
            ) as span:
                # If we're capturing async messages, we'll update input after they're consumed
                input_needs_update = self.__captured_messages is not None
                # Store the parent span export in thread-local storage for tool handlers
                _thread_local.parent_span_export = span.export()

                final_results: list[dict[str, Any]] = []
                llm_tracker = LLMSpanTracker(query_start_time=self.__query_start_time)

                try:
                    async for message in generator:
                        # Update input from captured async messages (once, after they're consumed)
                        if input_needs_update and self.__captured_messages:
                            captured_input = _format_captured_messages(self.__captured_messages)
                            if captured_input:
                                span.log(input=captured_input)
                            input_needs_update = False

                        message_type = type(message).__name__

                        if message_type == "AssistantMessage":
                            final_content = llm_tracker.start_llm_span(message, self.__last_prompt, final_results)
                            if final_content:
                                final_results.append(final_content)
                        elif message_type == "UserMessage":
                            if hasattr(message, "content"):
                                content = _serialize_content_blocks(message.content)
                                final_results.append({"content": content, "role": "user"})

                            llm_tracker.mark_next_llm_start()
                        elif message_type == "ResultMessage":
                            if hasattr(message, "usage"):
                                usage_metrics = _extract_usage_from_result_message(message)
                                llm_tracker.log_usage(usage_metrics)

                            result_metadata = {
                                k: v
                                for k, v in {
                                    "num_turns": getattr(message, "num_turns", None),
                                    "session_id": getattr(message, "session_id", None),
                                }.items()
                                if v is not None
                            }
                            if result_metadata:
                                span.log(metadata=result_metadata)

                        yield message
                    span.log(output=final_results[-1] if final_results else None)
                except Exception as e:
                    log.warning("Error in tracing code", exc_info=e)
                finally:
                    llm_tracker.cleanup()
                    if hasattr(_thread_local, "parent_span_export"):
                        delattr(_thread_local, "parent_span_export")

        async def __aenter__(self) -> "WrappedClaudeSDKClient":
            await self.__client.__aenter__()
            return self

        async def __aexit__(self, *args: Any) -> None:
            await self.__client.__aexit__(*args)

    return WrappedClaudeSDKClient


def _create_llm_span_for_messages(
    messages: list[Any],  # List of AssistantMessage objects
    prompt: Any,
    conversation_history: list[dict[str, Any]],
    start_time: float | None = None,
) -> tuple[dict[str, Any] | None, Any | None]:
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
    if type(last_message).__name__ != "AssistantMessage":
        return None, None
    model = getattr(last_message, "model", None)
    input_messages = _build_llm_input(prompt, conversation_history)

    outputs: list[dict[str, Any]] = []
    for msg in messages:
        if hasattr(msg, "content"):
            content = _serialize_content_blocks(msg.content)
            outputs.append({"content": content, "role": "assistant"})

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
            if dataclasses.is_dataclass(block):
                serialized = dataclasses.asdict(block)

                block_type = type(block).__name__
                if block_type == "TextBlock":
                    serialized["type"] = "text"
                elif block_type == "ToolUseBlock":
                    serialized["type"] = "tool_use"
                elif block_type == "ToolResultBlock":
                    serialized["type"] = "tool_result"

                    content_value = serialized.get("content")
                    if isinstance(content_value, list) and len(content_value) == 1:
                        item = content_value[0]
                        if isinstance(item, dict) and item.get("type") == "text" and "text" in item:
                            serialized["content"] = item["text"]

                    if "is_error" in serialized and serialized["is_error"] is None:
                        del serialized["is_error"]
            else:
                serialized = block

            result.append(serialized)
        return result
    return content


def _extract_usage_from_result_message(result_message: Any) -> dict[str, float]:
    """Extracts and normalizes usage metrics from a ResultMessage.

    Uses shared Anthropic utilities for consistent metric extraction.
    """
    if not hasattr(result_message, "usage"):
        return {}

    usage = result_message.usage
    if not usage:
        return {}

    metrics = extract_anthropic_usage(usage)
    if metrics:
        metrics = finalize_anthropic_tokens(metrics)

    return metrics


def _build_llm_input(prompt: Any, conversation_history: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    """Builds the input array for an LLM span from the initial prompt and conversation history.

    Formats input to match Anthropic messages API format for proper UI rendering.
    """
    if isinstance(prompt, str):
        if len(conversation_history) == 0:
            return [{"content": prompt, "role": "user"}]
        else:
            return [{"content": prompt, "role": "user"}] + conversation_history

    return conversation_history if conversation_history else None


def _format_captured_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Formats captured async generator messages into structured input.

    Returns the messages as-is to preserve structure for tracing.
    Empty list returns empty list.
    """
    return messages if messages else []
