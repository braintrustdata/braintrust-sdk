import inspect
import logging
import time
from contextlib import AbstractAsyncContextManager
from typing import Any, AsyncGenerator, Dict, Iterable, Optional, TypeVar, Union, cast

from wrapt import wrap_function_wrapper

from braintrust.logger import NOOP_SPAN, Attachment, current_span, init_logger, start_span
from braintrust.span_types import SpanTypeAttribute

logger = logging.getLogger(__name__)

__all__ = ["setup_braintrust", "setup_adk", "wrap_agent", "wrap_runner", "wrap_flow", "wrap_mcp_tool"]


def setup_braintrust(*args, **kwargs):
    logger.warning("setup_braintrust is deprecated, use setup_adk instead")
    return setup_adk(*args, **kwargs)


def setup_adk(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project_name: Optional[str] = None,
    SpanProcessor: Optional[type] = None,
) -> bool:
    """
    Setup Braintrust integration with Google ADK. Will automatically patch Google ADK agents, runners, flows, and MCP tools for automatic tracing.

    If you prefer manual patching take a look at `wrap_agent`, `wrap_runner`, `wrap_flow`, and `wrap_mcp_tool`.

    Args:
        api_key (Optional[str]): Braintrust API key.
        project_id (Optional[str]): Braintrust project ID.
        project_name (Optional[str]): Braintrust project name.
        SpanProcessor (Optional[type]): Deprecated parameter.

    Returns:
        bool: True if setup was successful, False otherwise.
    """
    if SpanProcessor is not None:
        logging.warning("SpanProcessor parameter is deprecated and will be ignored")

    span = current_span()
    if span == NOOP_SPAN:
        init_logger(project=project_name, api_key=api_key, project_id=project_id)

    try:
        from google.adk import agents, runners
        from google.adk.flows.llm_flows import base_llm_flow

        agents.BaseAgent = wrap_agent(agents.BaseAgent)
        runners.Runner = wrap_runner(runners.Runner)
        base_llm_flow.BaseLlmFlow = wrap_flow(base_llm_flow.BaseLlmFlow)

        # Try to patch McpTool if available (MCP is optional)
        try:
            from google.adk.tools.mcp_tool import mcp_tool

            mcp_tool.McpTool = wrap_mcp_tool(mcp_tool.McpTool)
            logger.debug("McpTool patching successful")
        except ImportError:
            # MCP is optional - gracefully skip if not installed
            logger.debug("McpTool not available, skipping MCP instrumentation")
        except Exception as e:
            # Log but don't fail - MCP patching is optional
            logger.warning(f"Failed to patch McpTool: {e}")

        return True
    except ImportError as e:
        logger.error(f"Failed to import Google ADK agents: {e}")
        logger.error("Google ADK is not installed. Please install it with: pip install google-adk")
        return False


def wrap_agent(Agent: Any) -> Any:
    if _is_patched(Agent):
        return Agent

    async def agent_run_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        parent_context = args[0] if len(args) > 0 else kwargs.get("parent_context")

        async def _trace():
            with start_span(
                name=f"agent_run [{instance.name}]",
                type=SpanTypeAttribute.TASK,
                metadata=_try_dict({"parent_context": parent_context, **_omit(kwargs, ["parent_context"])}),
            ) as agent_span:
                last_event = None
                async with aclosing(wrapped(*args, **kwargs)) as agen:
                    async for event in agen:
                        if event.is_final_response():
                            last_event = event
                        yield event
                if last_event:
                    agent_span.log(output=_try_dict(last_event))

        async with aclosing(_trace()) as agen:
            async for event in agen:
                yield event

    wrap_function_wrapper(Agent, "run_async", agent_run_wrapper)
    Agent._braintrust_patched = True
    return Agent


def wrap_flow(Flow: Any):
    if _is_patched(Flow):
        return Flow

    async def trace_flow(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        invocation_context = args[0] if len(args) > 0 else kwargs.get("invocation_context")

        async def _trace():
            with start_span(
                name=f"call_llm",
                type=SpanTypeAttribute.TASK,
                metadata=_try_dict(
                    {
                        "invocation_context": invocation_context,
                        **_omit(kwargs, ["invocation_context"]),
                    }
                ),
            ) as llm_span:
                last_event = None
                async with aclosing(wrapped(*args, **kwargs)) as agen:
                    async for event in agen:
                        last_event = event
                        yield event
                if last_event:
                    llm_span.log(output=_try_dict(last_event))

        async with aclosing(_trace()) as agen:
            async for event in agen:
                yield event

    wrap_function_wrapper(Flow, "run_async", trace_flow)

    async def trace_run_sync_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        invocation_context = args[0] if len(args) > 0 else kwargs.get("invocation_context")
        llm_request = args[1] if len(args) > 1 else kwargs.get("llm_request")
        model_response_event = args[2] if len(args) > 2 else kwargs.get("model_response_event")

        async def _trace():
            # Extract and serialize contents BEFORE converting to dict
            # This is critical because _try_dict converts bytes to string representations
            serialized_contents = None
            if llm_request and hasattr(llm_request, "contents"):
                contents = llm_request.contents
                if contents:
                    serialized_contents = (
                        [_serialize_content(c) for c in contents]
                        if isinstance(contents, list)
                        else _serialize_content(contents)
                    )

            # Now convert the whole request to dict
            serialized_request = _try_dict(llm_request)

            # Replace contents with our serialized version that has Attachments
            if serialized_contents is not None and isinstance(serialized_request, dict):
                serialized_request["contents"] = serialized_contents

            # Handle config specifically to serialize Pydantic schema classes
            if isinstance(serialized_request, dict) and "config" in serialized_request:
                serialized_request["config"] = _serialize_config(serialized_request["config"])

            # Extract model name from request or instance
            model_name = _extract_model_name(None, llm_request, instance)

            # Create span BEFORE execution so child spans (like mcp_tool) have proper parent
            # Start with generic name - we'll update it after we see the response
            with start_span(
                name="llm_call",
                type=SpanTypeAttribute.LLM,
                input=serialized_request,
                metadata=_try_dict(
                    {
                        "invocation_context": invocation_context,
                        "model_response_event": model_response_event,
                        "flow_class": instance.__class__.__name__,
                        "model": model_name,
                        **_omit(kwargs, ["invocation_context", "model_response_event", "flow_class", "llm_call_type"]),
                    }
                ),
            ) as llm_span:
                # Execute the LLM call and yield events while span is active
                last_event = None
                event_with_content = None
                start_time = time.time()
                first_token_time = None

                async with aclosing(wrapped(*args, **kwargs)) as agen:
                    async for event in agen:
                        # Record time to first token
                        if first_token_time is None:
                            first_token_time = time.time()

                        last_event = event
                        if hasattr(event, "content") and event.content is not None:
                            event_with_content = event
                        yield event

                # After execution, update span with correct call type and output
                if last_event:
                    output = _try_dict(last_event)
                    # If last event is missing content but we have an earlier event with content, merge them
                    if event_with_content and isinstance(output, dict):
                        if "content" not in output or output.get("content") is None:
                            content = (
                                _try_dict(event_with_content.content)
                                if hasattr(event_with_content, "content")
                                else None
                            )
                            if content:
                                output["content"] = content

                    # Extract metrics from response
                    metrics = _extract_metrics(last_event)

                    # Add time to first token if we captured it
                    if first_token_time is not None:
                        if metrics is None:
                            metrics = {}
                        metrics["time_to_first_token"] = first_token_time - start_time

                    # Determine the actual call type based on the response
                    call_type = _determine_llm_call_type(llm_request, last_event)

                    # Update span name with the specific call type now that we know it
                    llm_span.set_attributes(
                        name=f"llm_call [{call_type}]",
                        span_attributes={"llm_call_type": call_type},
                    )

                    # Log output and metrics
                    llm_span.log(output=output, metrics=metrics)

        async with aclosing(_trace()) as agen:
            async for event in agen:
                yield event

    wrap_function_wrapper(Flow, "_call_llm_async", trace_run_sync_wrapper)
    Flow._braintrust_patched = True
    return Flow


def wrap_runner(Runner: Any):
    if _is_patched(Runner):
        return Runner

    def trace_run_sync_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        user_id = kwargs.get("user_id")
        session_id = kwargs.get("session_id")
        new_message = kwargs.get("new_message")

        # Serialize new_message before any dict conversion to handle binary data
        serialized_message = _serialize_content(new_message) if new_message else None

        def _trace():
            with start_span(
                name=f"invocation [{instance.app_name}]",
                type=SpanTypeAttribute.TASK,
                input={"new_message": serialized_message},
                metadata=_try_dict(
                    {
                        "user_id": user_id,
                        "session_id": session_id,
                        **_omit(kwargs, ["user_id", "session_id", "new_message"]),
                    }
                ),
            ) as runner_span:
                last_event = None
                for event in wrapped(*args, **kwargs):
                    if event.is_final_response():
                        last_event = event
                    yield event
                if last_event:
                    runner_span.log(output=_try_dict(last_event))

        for event in _trace():
            yield event

    wrap_function_wrapper(Runner, "run", trace_run_sync_wrapper)

    async def trace_run_async_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        user_id = kwargs.get("user_id")
        session_id = kwargs.get("session_id")
        new_message = kwargs.get("new_message")
        state_delta = kwargs.get("state_delta")

        # Serialize new_message before any dict conversion to handle binary data
        serialized_message = _serialize_content(new_message) if new_message else None

        async def _trace():
            with start_span(
                name=f"invocation [{instance.app_name}]",
                type=SpanTypeAttribute.TASK,
                input={"new_message": serialized_message},
                metadata=_try_dict(
                    {
                        "user_id": user_id,
                        "session_id": session_id,
                        "state_delta": state_delta,
                        **_omit(kwargs, ["user_id", "session_id", "new_message", "state_delta"]),
                    }
                ),
            ) as runner_span:
                last_event = None
                async with aclosing(wrapped(*args, **kwargs)) as agen:
                    async for event in agen:
                        if event.is_final_response():
                            last_event = event
                        yield event
                if last_event:
                    runner_span.log(output=_try_dict(last_event))

        async with aclosing(_trace()) as agen:
            async for event in agen:
                yield event

    wrap_function_wrapper(Runner, "run_async", trace_run_async_wrapper)
    Runner._braintrust_patched = True
    return Runner


def wrap_mcp_tool(McpTool: Any) -> Any:
    """
    Wrap McpTool to trace MCP tool invocations.

    Creates Braintrust spans for each MCP tool call, capturing:
    - Tool name
    - Input arguments
    - Output results
    - Execution time
    - Errors if they occur

    Args:
        McpTool: The McpTool class to wrap

    Returns:
        The wrapped McpTool class
    """
    if _is_patched(McpTool):
        return McpTool

    async def tool_run_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        # Extract tool information
        tool_name = instance.name
        tool_args = kwargs.get("args", {})

        with start_span(
            name=f"mcp_tool [{tool_name}]",
            type=SpanTypeAttribute.TOOL,
            input={"tool_name": tool_name, "arguments": _try_dict(tool_args)},
            metadata=_try_dict(_omit(kwargs, ["args"])),
        ) as tool_span:
            try:
                result = await wrapped(*args, **kwargs)
                tool_span.log(output=_try_dict(result))
                return result
            except Exception as e:
                # Log error to span but re-raise for ADK to handle
                tool_span.log(error=str(e))
                raise

    wrap_function_wrapper(McpTool, "run_async", tool_run_wrapper)
    McpTool._braintrust_patched = True
    return McpTool


def _determine_llm_call_type(llm_request: Any, model_response: Any = None) -> str:
    """
    Determine the type of LLM call based on the request and response content.

    Returns:
        - "tool_selection" if the LLM selected a tool to call in its response
        - "response_generation" if the LLM is generating a response after tool execution
        - "direct_response" if there are no tools involved or tools available but not used
    """
    try:
        # Convert to dict if it's a model object
        request_dict = cast(Dict[str, Any], _try_dict(llm_request))

        # Check if there are tools in the config
        has_tools = bool(request_dict.get("config", {}).get("tools"))

        # Check the conversation history for function responses
        contents = request_dict.get("contents", [])
        has_function_response = False

        for content in contents:
            if isinstance(content, dict):
                parts = content.get("parts", [])
                for part in parts:
                    if isinstance(part, dict):
                        if "function_response" in part:
                            has_function_response = True

        # Check if the response contains function calls
        response_has_function_call = False
        if model_response:
            # Check if it's an Event object with get_function_calls method (ADK Event)
            if hasattr(model_response, "get_function_calls"):
                try:
                    function_calls = model_response.get_function_calls()
                    if function_calls and len(function_calls) > 0:
                        response_has_function_call = True
                except Exception:
                    pass

            # Fallback: Check the response dict structure
            if not response_has_function_call:
                response_dict = _try_dict(model_response)
                if isinstance(response_dict, dict):
                    # Try multiple possible response structures
                    # 1. Standard: response.content.parts
                    content = response_dict.get("content", {})
                    if isinstance(content, dict):
                        parts = content.get("parts", [])
                        if isinstance(parts, list):
                            for part in parts:
                                if isinstance(part, dict):
                                    if "function_call" in part or "functionCall" in part:
                                        response_has_function_call = True
                                        break

                    # 2. Alternative: response has parts directly (for some event types)
                    if not response_has_function_call and "parts" in response_dict:
                        parts = response_dict.get("parts", [])
                        if isinstance(parts, list):
                            for part in parts:
                                if isinstance(part, dict):
                                    if "function_call" in part or "functionCall" in part:
                                        response_has_function_call = True
                                        break

        # Determine the call type
        if has_function_response:
            return "response_generation"
        elif response_has_function_call:
            return "tool_selection"
        else:
            return "direct_response"

    except Exception:
        return "unknown"


def _is_patched(obj: Any):
    return getattr(obj, "_braintrust_patched", False)


def _serialize_content(content: Any) -> Any:
    """Serialize Google ADK Content/Part objects, converting binary data to Attachments."""
    if content is None:
        return None

    # Handle Content objects with parts
    if hasattr(content, "parts") and content.parts:
        serialized_parts = []
        for part in content.parts:
            serialized_parts.append(_serialize_part(part))

        result = {"parts": serialized_parts}
        if hasattr(content, "role"):
            result["role"] = content.role
        return result

    # Handle single Part
    return _serialize_part(content)


def _serialize_part(part: Any) -> Any:
    """Serialize a single Part object, handling binary data."""
    if part is None:
        return None

    # If it's already a dict, return as-is
    if isinstance(part, dict):
        return part

    # Handle Part objects with inline_data (binary data like images)
    if hasattr(part, "inline_data") and part.inline_data:
        inline_data = part.inline_data
        if hasattr(inline_data, "data") and hasattr(inline_data, "mime_type"):
            data = inline_data.data
            mime_type = inline_data.mime_type

            # Convert bytes to Attachment
            if isinstance(data, bytes):
                extension = mime_type.split("/")[1] if "/" in mime_type else "bin"
                filename = f"file.{extension}"
                attachment = Attachment(data=data, filename=filename, content_type=mime_type)

                # Return in image_url format - SDK will replace with AttachmentReference
                return {"image_url": {"url": attachment}}

    # Handle Part objects with file_data (file references)
    if hasattr(part, "file_data") and part.file_data:
        file_data = part.file_data
        result = {"file_data": {}}
        if hasattr(file_data, "file_uri"):
            result["file_data"]["file_uri"] = file_data.file_uri
        if hasattr(file_data, "mime_type"):
            result["file_data"]["mime_type"] = file_data.mime_type
        return result

    # Handle text parts
    if hasattr(part, "text") and part.text is not None:
        result = {"text": part.text}
        if hasattr(part, "thought") and part.thought:
            result["thought"] = part.thought
        return result

    # Try standard serialization methods
    return _try_dict(part)


def _serialize_pydantic_schema(schema_class: Any) -> Dict[str, Any]:
    """
    Serialize a Pydantic model class to its full JSON schema.

    Returns the complete schema including descriptions, constraints, and nested definitions
    so engineers can see exactly what structured output schema was used.
    """
    try:
        from pydantic import BaseModel

        if inspect.isclass(schema_class) and issubclass(schema_class, BaseModel):
            # Return the full JSON schema - includes all field info, descriptions, constraints, etc.
            return schema_class.model_json_schema()
    except (ImportError, AttributeError, TypeError):
        pass
    # If not a Pydantic model, return class name
    return {"__class__": schema_class.__name__ if inspect.isclass(schema_class) else str(type(schema_class).__name__)}


def _serialize_config(config: Any) -> Union[Dict[str, Any], Any]:
    """
    Serialize a config object, specifically handling schema fields that may contain Pydantic classes.

    Google ADK uses these fields for schemas:
    - response_schema, response_json_schema (in GenerateContentConfig for LLM requests)
    - input_schema, output_schema (in agent config)
    """
    if config is None:
        return None
    if not config:
        return config

    # Extract schema fields BEFORE calling _try_dict (which converts Pydantic classes to dicts)
    schema_fields = ["response_schema", "response_json_schema", "input_schema", "output_schema"]
    serialized_schemas: Dict[str, Any] = {}

    for field in schema_fields:
        schema_value = None

        # Try to get the field value
        if hasattr(config, field):
            schema_value = getattr(config, field)
        elif isinstance(config, dict) and field in config:
            schema_value = config[field]

        # If it's a Pydantic class, serialize it
        if schema_value is not None and inspect.isclass(schema_value):
            try:
                from pydantic import BaseModel

                if issubclass(schema_value, BaseModel):
                    serialized_schemas[field] = _serialize_pydantic_schema(schema_value)
            except (TypeError, ImportError):
                pass

    # Serialize the config
    config_dict = _try_dict(config)
    if not isinstance(config_dict, dict):
        return config_dict  # type: ignore

    # Replace schema fields with serialized versions
    config_dict.update(serialized_schemas)

    return config_dict


def _try_dict(obj: Any) -> Any:
    """
    Convert an object to a dict representation if possible.

    This function should NEVER raise - it's used for logging/tracing.
    Falls back to returning the original object, which Braintrust's
    serialization will handle (via bt_json module).
    """
    try:
        if hasattr(obj, "model_dump"):
            # Check if it's a class (not an instance)
            if inspect.isclass(obj):
                # For classes, return class name - schema conversion handled in _serialize_config
                return {"__class__": obj.__name__}
            # Try to serialize Pydantic instances
            try:
                return obj.model_dump(exclude_none=True)
            except Exception:
                # Return original object - Braintrust will handle it
                return obj

        if isinstance(obj, dict):
            return {k: _try_dict(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [_try_dict(item) for item in obj]

        # Return original object - Braintrust serialization handles primitives and complex types
        return obj
    except Exception:
        # Last resort: return original object
        return obj


def _omit(obj: Any, keys: Iterable[str]):
    return {k: v for k, v in obj.items() if k not in keys}


def _extract_metrics(response: Any) -> Optional[Dict[str, float]]:
    """Extract token usage metrics from Google GenAI response."""
    if not response:
        return None

    usage_metadata = getattr(response, "usage_metadata", None)
    if not usage_metadata:
        return None

    metrics: Dict[str, float] = {}

    # Core token counts
    if hasattr(usage_metadata, "prompt_token_count") and usage_metadata.prompt_token_count is not None:
        metrics["prompt_tokens"] = float(usage_metadata.prompt_token_count)

    if hasattr(usage_metadata, "candidates_token_count") and usage_metadata.candidates_token_count is not None:
        metrics["completion_tokens"] = float(usage_metadata.candidates_token_count)

    if hasattr(usage_metadata, "total_token_count") and usage_metadata.total_token_count is not None:
        metrics["tokens"] = float(usage_metadata.total_token_count)

    # Cached token metrics
    if hasattr(usage_metadata, "cached_content_token_count") and usage_metadata.cached_content_token_count is not None:
        metrics["prompt_cached_tokens"] = float(usage_metadata.cached_content_token_count)

    # Reasoning token metrics (thoughts_token_count)
    if hasattr(usage_metadata, "thoughts_token_count") and usage_metadata.thoughts_token_count is not None:
        metrics["completion_reasoning_tokens"] = float(usage_metadata.thoughts_token_count)

    return metrics if metrics else None


def _extract_model_name(response: Any, llm_request: Any, instance: Any) -> Optional[str]:
    """Extract model name from Google GenAI response, request, or flow instance."""
    # Try to get from response first
    if response:
        model_version = getattr(response, "model_version", None)
        if model_version:
            return model_version

    # Try to get from llm_request
    if llm_request:
        if hasattr(llm_request, "model") and llm_request.model:
            return str(llm_request.model)

    # Try to get from instance (flow's llm)
    if instance:
        if hasattr(instance, "llm"):
            llm = instance.llm
            if hasattr(llm, "model") and llm.model:
                return str(llm.model)

        # Try to get model from instance directly
        if hasattr(instance, "model") and instance.model:
            return str(instance.model)

    return None


G = TypeVar("G", bound=AsyncGenerator[Any, None])


# until we drop support for Python 3.9
class aclosing(AbstractAsyncContextManager[G]):
    def __init__(self, async_generator: G):
        self.async_generator = async_generator

    async def __aenter__(self):
        return self.async_generator

    async def __aexit__(self, *exc_info: Any):
        try:
            await self.async_generator.aclose()
        except ValueError as e:
            # Suppress ContextVar errors during async cleanup
            # These occur when spans are created in one context and cleaned up in another during shutdown
            if "was created in a different Context" not in str(e):
                raise
            else:
                logger.debug(
                    f"Suppressed ContextVar error during async cleanup: {e}. "
                    "This is expected when async generators yield across context boundaries."
                )
