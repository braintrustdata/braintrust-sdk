"""
AgentWrapper class for Braintrust-Agno agent observability.
"""

from typing import Any, Callable, Dict

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute

from .base import Operations, Wrapper


def _omit(obj, keys):
    """Omit keys from an object."""
    return {k: v for k, v in obj.items() if k not in keys}


class AgentWrapper(Wrapper):
    """Wrapper for Agno Agent with Braintrust observability."""

    def __init__(self, agent: Any, original_methods: dict = None):
        super().__init__(agent)
        self.__agent = agent
        self.__original_methods = original_methods or {}

    def run(self, *args, **kwargs):
        wrapped_method = self.__original_methods.get("run", self.__agent.run)

        agent_name = getattr(self.__agent, "name", None) or "Agent"
        span_name = f"{agent_name}.run"

        with start_span(
            name=span_name,
            span_attributes={"type": SpanTypeAttribute.TASK},
            input=args,
            metadata=_omit(kwargs, ["audio", "images", "videos"]),
        ) as span:
            result = wrapped_method(self.__agent, *args, **kwargs)
            span.log(
                output=result,
                metrics=self._extract_run_metrics(result),
                metadata=self._extract_agent_metadata(),
            )
            return result

    async def _arun(self, *args, **kwargs):
        original_method = self.__original_methods.get("_arun", self.__agent._arun)
        return await self._trace_arun(original_method, Operations.RUN, *args, **kwargs)

    def _run_stream(self, *args, **kwargs):
        original_method = self.__original_methods.get("_run_stream", self.__agent._run_stream)
        return self._trace_run_stream(original_method, Operations.RUN_STREAM, *args, **kwargs)

    def _arun_stream(self, *args, **kwargs):
        original_method = self.__original_methods.get("_arun_stream", self.__agent._arun_stream)
        return self._trace_arun_stream(original_method, Operations.RUN_STREAM, *args, **kwargs)

    def print_response(self, *args, **kwargs):
        original_method = self.__original_methods.get("print_response", self.__agent.print_response)
        return self._trace_run(original_method, Operations.PRINT_RESPONSE, *args, **kwargs)

    def _trace_run(self, wrapped_method: Callable, operation_name: str, *args, **kwargs):
        """Trace a synchronous run operation with proper span context for nesting."""
        agent_name = getattr(self.__agent, "name", None) or "Agent"
        span_name = f"{agent_name}.{operation_name}"

        input_data = self._extract_input(*args, **kwargs)
        metadata = self._extract_agent_metadata()

        span = None
        try:
            import braintrust

            logger = braintrust.current_logger()
            if logger:
                span = logger.start_span(
                    name=span_name,
                    span_attributes={"type": SpanTypeAttribute.TASK},
                    input=input_data,
                    metadata=metadata,
                    parent=None,
                )
            else:
                span = braintrust.start_span(
                    name=span_name,
                    span_attributes={"type": SpanTypeAttribute.TASK},
                    input=input_data,
                    metadata=metadata,
                )
            span.set_current()
        except Exception:
            pass

        try:
            if hasattr(wrapped_method, "__self__"):
                result = wrapped_method(*args, **kwargs)
            else:
                result = wrapped_method(self.__agent, *args, **kwargs)
        except Exception as e:
            if span:
                self._safe_trace(lambda: span.log(error=str(e)))
                self._safe_trace(lambda: span.end())
            raise

        if span:
            self._safe_trace(
                lambda: span.log(output=self._extract_output(result), metrics=self._extract_run_metrics(result))
            )
            self._safe_trace(lambda: span.end())

        return result

    async def _trace_arun(self, wrapped_method: Callable, operation_name: str, *args, **kwargs):
        """Trace an asynchronous run operation with proper span context for nesting."""
        agent_name = getattr(self.__agent, "name", None) or "Agent"
        span_name = f"{agent_name}.{operation_name}"

        input_data = self._extract_input(*args, **kwargs)
        metadata = self._extract_agent_metadata()

        span = None
        try:
            import braintrust

            logger = braintrust.current_logger()
            if logger:
                span = logger.start_span(
                    name=span_name,
                    span_attributes={"type": SpanTypeAttribute.TASK},
                    input=input_data,
                    metadata=metadata,
                    parent=None,
                )
            else:
                span = braintrust.start_span(
                    name=span_name,
                    span_attributes={"type": SpanTypeAttribute.TASK},
                    input=input_data,
                    metadata=metadata,
                )
            span.set_current()
        except Exception:
            pass

        try:
            if hasattr(wrapped_method, "__self__"):
                result = await wrapped_method(*args, **kwargs)
            else:
                result = await wrapped_method(self.__agent, *args, **kwargs)
        except Exception as e:
            if span:
                self._safe_trace(lambda: span.log(error=str(e)))
                self._safe_trace(lambda: span.end())
            raise

        if span:
            self._safe_trace(
                lambda: span.log(output=self._extract_output(result), metrics=self._extract_run_metrics(result))
            )
            self._safe_trace(lambda: span.end())

        return result

    def _trace_run_stream(self, wrapped_method: Callable, operation_name: str, *args, **kwargs):
        """Trace a synchronous streaming operation."""
        agent_name = getattr(self.__agent, "name", None) or "Agent"
        span_name = f"{agent_name}.{operation_name}"

        try:
            if hasattr(wrapped_method, "__self__"):
                stream = wrapped_method(*args, **kwargs)
            else:
                stream = wrapped_method(self.__agent, *args, **kwargs)
        except Exception as e:
            self._safe_trace(lambda: self._trace_error(operation_name, str(e)))
            raise

        return self._trace_stream_safely(stream, span_name, *args, **kwargs)

    async def _trace_arun_stream(self, wrapped_method: Callable, operation_name: str, *args, **kwargs):
        """Trace an asynchronous streaming operation."""
        agent_name = getattr(self.__agent, "name", None) or "Agent"
        span_name = f"{agent_name}.{operation_name}"

        try:
            stream = wrapped_method(*args, **kwargs)
        except Exception as e:
            self._safe_trace(lambda: self._trace_error(operation_name, str(e)))
            raise

        return self._trace_async_stream_safely(stream, span_name, *args, **kwargs)

    def _trace_stream_safely(self, stream, span_name: str, *args, **kwargs):
        """Safely wrap a stream with tracing."""
        input_data = self._extract_input(*args, **kwargs)
        metadata = self._extract_agent_metadata()

        def safe_stream_generator():
            span = None
            try:
                span = start_span(
                    name=span_name,
                    span_attributes={"type": SpanTypeAttribute.TASK},
                    input=input_data,
                    metadata=metadata,
                )
                if span:
                    span.set_current()
            except Exception:
                pass

            try:
                for chunk in stream:
                    yield chunk

                if span and hasattr(self.__agent, "run_response"):
                    self._safe_trace(lambda: span.log(output=self._extract_output(self.__agent.run_response)))

            except Exception as e:
                if span:
                    self._safe_trace(lambda: span.log(error=str(e)))
                raise
            finally:
                if span:
                    self._safe_trace(lambda: span.end())

        return safe_stream_generator()

    async def _trace_async_stream_safely(self, stream, span_name: str, *args, **kwargs):
        """Safely wrap an async stream with tracing."""
        input_data = self._extract_input(*args, **kwargs)
        metadata = self._extract_agent_metadata()

        async def safe_async_stream_generator():
            span = None
            try:
                span = start_span(
                    name=span_name,
                    span_attributes={"type": SpanTypeAttribute.TASK},
                    input=input_data,
                    metadata=metadata,
                )
                if span:
                    span.set_current()
            except Exception:
                pass

            try:
                async for chunk in stream:
                    yield chunk

                if span and hasattr(self.__agent, "run_response"):
                    self._safe_trace(lambda: span.log(output=self._extract_output(self.__agent.run_response)))

            except Exception as e:
                if span:
                    self._safe_trace(lambda: span.log(error=str(e)))
                raise
            finally:
                if span:
                    self._safe_trace(lambda: span.end())

        return safe_async_stream_generator()

    def _extract_input(self, *args, **kwargs) -> Any:
        """Extract input data from arguments."""
        return args

    def _extract_agent_metadata(self) -> Dict[str, Any]:
        """Extract metadata about the agent."""
        metadata = {"component": "agent"}

        if hasattr(self.__agent, "name") and self.__agent.name:
            metadata["agent_name"] = self.__agent.name
        if hasattr(self.__agent, "model") and self.__agent.model:
            # Extract just the model ID instead of the full object
            if hasattr(self.__agent.model, "id"):
                metadata["model"] = self.__agent.model.id
            else:
                metadata["model"] = str(self.__agent.model.__class__.__name__)

        return metadata

    def _extract_run_metrics(self, result: Any) -> Dict[str, Any]:
        """Extract metrics from agent run result using standard Braintrust names."""
        metrics = {}

        if hasattr(result, "metrics"):
            agno_metrics = result.metrics

            if hasattr(agno_metrics, "input_tokens") and agno_metrics.input_tokens:
                metrics["prompt_tokens"] = agno_metrics.input_tokens
            if hasattr(agno_metrics, "output_tokens") and agno_metrics.output_tokens:
                metrics["completion_tokens"] = agno_metrics.output_tokens
            if hasattr(agno_metrics, "total_tokens") and agno_metrics.total_tokens:
                metrics["total_tokens"] = agno_metrics.total_tokens
            if hasattr(agno_metrics, "duration") and agno_metrics.duration:
                metrics["duration"] = agno_metrics.duration
            if hasattr(agno_metrics, "time_to_first_token") and agno_metrics.time_to_first_token:
                metrics["time_to_first_token"] = agno_metrics.time_to_first_token

        return metrics if metrics else None
