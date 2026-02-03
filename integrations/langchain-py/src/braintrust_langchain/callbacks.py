import json
import logging
import re
import time
from collections.abc import Mapping, Sequence
from re import Pattern
from typing import (
    Any,
    Dict,
    List,
    Optional,
    Set,
    TypedDict,
    Union,
)
from uuid import UUID

import braintrust
from braintrust import NOOP_SPAN, Logger, Span, SpanAttributes, SpanTypeAttribute, current_span, init_logger
from braintrust.version import VERSION as sdk_version
from langchain_core.agents import AgentAction, AgentFinish
from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.documents import Document
from langchain_core.messages import BaseMessage
from langchain_core.outputs.llm_result import LLMResult
from tenacity import RetryCallState
from typing_extensions import NotRequired

from braintrust_langchain.version import version

_logger = logging.getLogger("braintrust_langchain")


class LogEvent(TypedDict):
    input: NotRequired[Any]
    output: NotRequired[Any]
    expected: NotRequired[Any]
    error: NotRequired[str]
    tags: NotRequired[Sequence[str] | None]
    scores: NotRequired[Mapping[str, int | float]]
    metadata: NotRequired[Mapping[str, Any]]
    metrics: NotRequired[Mapping[str, int | float]]
    id: NotRequired[str]
    dataset_record_id: NotRequired[str]


class BraintrustCallbackHandler(BaseCallbackHandler):
    root_run_id: UUID | None = None

    def __init__(
        self,
        logger: Logger | Span | None = None,
        debug: bool = False,
        exclude_metadata_props: Pattern[str] | None = None,
    ):
        self.logger = logger
        self.spans: dict[UUID, Span] = {}
        self.debug = debug  # DEPRECATED
        self.exclude_metadata_props = exclude_metadata_props or re.compile(
            r"^(l[sc]_|langgraph_|__pregel_|checkpoint_ns)"
        )
        self.skipped_runs: set[UUID] = set()
        # Set run_inline=True to avoid thread executor in async contexts
        # This ensures memory logger context is preserved
        self.run_inline = True

        self._start_times: dict[UUID, float] = {}
        self._first_token_times: dict[UUID, float] = {}
        self._ttft_ms: dict[UUID, float] = {}

    def _start_span(
        self,
        parent_run_id: UUID | None,
        run_id: UUID,
        name: str | None = None,
        type: SpanTypeAttribute | None = SpanTypeAttribute.TASK,
        span_attributes: SpanAttributes | Mapping[str, Any] | None = None,
        start_time: float | None = None,
        set_current: bool | None = None,
        parent: str | None = None,
        event: LogEvent | None = None,
    ) -> Any:
        if run_id in self.spans:
            # XXX: See graph test case of an example where this _may_ be intended.
            _logger.warning(f"Span already exists for run_id {run_id} (this is likely a bug)")
            return

        if not parent_run_id:
            self.root_run_id = run_id

        current_parent = current_span()
        parent_span = None
        if parent_run_id and parent_run_id in self.spans:
            parent_span = self.spans[parent_run_id]
        elif current_parent != NOOP_SPAN:
            parent_span = current_parent
        elif self.logger is not None:
            parent_span = self.logger
        else:
            parent_span = braintrust

        if event is None:
            event = {}

        tags = event.get("tags") or []
        event = {
            **event,
            "tags": None,
            "metadata": {
                **({"tags": tags}),
                **(event.get("metadata") or {}),
                "run_id": run_id,
                "parent_run_id": parent_run_id,
                "braintrust": {
                    "integration_name": "langchain-py",
                    "integration_version": version,
                    "sdk_version": sdk_version,
                    "language": "python",
                },
            },
        }

        span = parent_span.start_span(
            name=name,
            type=type,
            span_attributes=span_attributes,
            start_time=start_time,
            set_current=set_current,
            parent=parent,
            **event,
        )

        if self.logger != NOOP_SPAN and span == NOOP_SPAN:
            _logger.warning(
                "Braintrust logging not configured. Pass a `logger`, call `init_logger`, or run an experiment to configure Braintrust logging. Setting up a default."
            )
            span = init_logger().start_span(
                name=name,
                type=type,
                span_attributes=span_attributes,
                start_time=start_time,
                set_current=set_current,
                parent=parent,
                **event,
            )

        span.set_current()

        self.spans[run_id] = span
        return span

    def _end_span(
        self,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        input: Any | None = None,
        output: Any | None = None,
        expected: Any | None = None,
        error: str | None = None,
        tags: Sequence[str] | None = None,
        scores: Mapping[str, int | float] | None = None,
        metadata: Mapping[str, Any] | None = None,
        metrics: Mapping[str, int | float] | None = None,
        dataset_record_id: str | None = None,
    ) -> Any:
        if run_id not in self.spans:
            return

        if run_id in self.skipped_runs:
            self.skipped_runs.discard(run_id)
            return

        span = self.spans.pop(run_id)

        if self.root_run_id == run_id:
            self.root_run_id = None

        span.log(
            input=input,
            output=output,
            expected=expected,
            error=error,
            tags=None,
            scores=scores,
            metadata={
                **({"tags": tags} if tags else {}),
                **(metadata or {}),
            },
            metrics=metrics,
            dataset_record_id=dataset_record_id,
        )

        # In async workflows, callbacks may execute in different async contexts.
        # The span's context variable token may have been created in a different
        # context, causing ValueError when trying to reset it. We catch and ignore
        # this specific error since the span hierarchy is maintained via self.spans.
        try:
            span.unset_current()
        except ValueError as e:
            if "was created in a different Context" in str(e):
                pass
            else:
                raise

        span.end()

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,  # TODO: response=
    ) -> Any:
        self._end_span(run_id, error=str(error), metadata={**kwargs})

        self._start_times.pop(run_id, None)
        self._first_token_times.pop(run_id, None)
        self._ttft_ms.pop(run_id, None)

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,  # TODO: some metadata
    ) -> Any:
        self._end_span(run_id, error=str(error), metadata={**kwargs})

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, error=str(error), metadata={**kwargs})

    def on_retriever_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, error=str(error), metadata={**kwargs})

    # Agent Methods
    def on_agent_action(
        self,
        action: AgentAction,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        self._start_span(
            parent_run_id,
            run_id,
            type=SpanTypeAttribute.LLM,
            name=action.tool,
            event={"input": action, "metadata": {**kwargs}},
        )

    def on_agent_finish(
        self,
        finish: AgentFinish,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, output=finish, metadata={**kwargs})

    def on_chain_start(
        self,
        serialized: dict[str, Any],
        inputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        name: str | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Any:
        tags = tags or []

        # avoids extra logs that seem not as useful esp. with langgraph
        if "langsmith:hidden" in tags:
            self.skipped_runs.add(run_id)
            return

        metadata = metadata or {}
        resolved_name = (
            name
            or metadata.get("langgraph_node")
            or serialized.get("name")
            or last_item(serialized.get("id") or [])
            or "Chain"
        )

        self._start_span(
            parent_run_id,
            run_id,
            name=resolved_name,
            event={
                "input": inputs,
                "tags": tags,
                "metadata": {
                    "serialized": serialized,
                    "name": name,
                    "metadata": metadata,
                    **kwargs,
                },
            },
        )

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, output=outputs, tags=tags, metadata={**kwargs})

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        name: str | None = None,
        **kwargs: Any,
    ) -> Any:
        self._start_times[run_id] = time.perf_counter()
        self._first_token_times.pop(run_id, None)
        self._ttft_ms.pop(run_id, None)

        name = name or serialized.get("name") or last_item(serialized.get("id") or []) or "LLM"
        self._start_span(
            parent_run_id,
            run_id,
            name=name,
            type=SpanTypeAttribute.LLM,
            event={
                "input": prompts,
                "tags": tags,
                "metadata": {
                    "serialized": serialized,
                    "name": name,
                    "metadata": metadata,
                    **kwargs,
                },
            },
        )

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list["BaseMessage"]],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        name: str | None = None,
        invocation_params: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Any:
        self._start_times[run_id] = time.perf_counter()
        self._first_token_times.pop(run_id, None)
        self._ttft_ms.pop(run_id, None)

        invocation_params = invocation_params or {}
        self._start_span(
            parent_run_id,
            run_id,
            name=name or serialized.get("name") or last_item(serialized.get("id") or []) or "Chat Model",
            type=SpanTypeAttribute.LLM,
            event={
                "input": messages,
                "tags": tags,
                "metadata": (
                    {
                        "serialized": serialized,
                        "invocation_params": invocation_params,
                        "metadata": metadata or {},
                        "name": name,
                        **kwargs,
                    }
                ),
            },
        )

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        **kwargs: Any,
    ) -> Any:
        if run_id not in self.spans:
            return

        metrics = _get_metrics_from_response(response)

        ttft = self._ttft_ms.pop(run_id, None)
        if ttft is not None:
            metrics["time_to_first_token"] = ttft

        model_name = _get_model_name_from_response(response)

        self._start_times.pop(run_id, None)
        self._first_token_times.pop(run_id, None)

        self._end_span(
            run_id,
            output=response,
            metrics=metrics,
            tags=tags,
            metadata={
                "model": model_name,
                **kwargs,
            },
        )

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        inputs: dict[str, Any] | None = None,
        name: str | None = None,
        **kwargs: Any,
    ) -> Any:
        self._start_span(
            parent_run_id,
            run_id,
            name=name or serialized.get("name") or last_item(serialized.get("id") or []) or "Tool",
            type=SpanTypeAttribute.TOOL,
            event={
                "input": inputs or safe_parse_serialized_json(input_str),
                "tags": tags,
                "metadata": {
                    "metadata": metadata,
                    "serialized": serialized,
                    "input_str": input_str,
                    "input": safe_parse_serialized_json(input_str),
                    "inputs": inputs,
                    "name": name,
                    **kwargs,
                },
            },
        )

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, output=output, metadata={**kwargs})

    def on_retriever_start(
        self,
        serialized: dict[str, Any],
        query: str,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        name: str | None = None,
        **kwargs: Any,
    ) -> Any:
        self._start_span(
            parent_run_id,
            run_id,
            name=name or serialized.get("name") or last_item(serialized.get("id") or []) or "Retriever",
            type=SpanTypeAttribute.FUNCTION,
            event={
                "input": query,
                "tags": tags,
                "metadata": {
                    "serialized": serialized,
                    "metadata": metadata,
                    "name": name,
                    **kwargs,
                },
            },
        )

    def on_retriever_end(
        self,
        documents: Sequence[Document],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, output=documents, metadata={**kwargs})

    def on_llm_new_token(
        self,
        token: str,
        *,
        chunk: Union["GenerationChunk", "ChatGenerationChunk"] | None = None,  # type: ignore
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        if run_id not in self._first_token_times:
            now = time.perf_counter()
            self._first_token_times[run_id] = now
            start = self._start_times.get(run_id)
            if start is not None:
                self._ttft_ms[run_id] = now - start

    def on_text(
        self,
        text: str,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        pass

    def on_retry(
        self,
        retry_state: RetryCallState,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        pass

    def on_custom_event(
        self,
        name: str,
        data: Any,
        *,
        run_id: UUID,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Any:
        pass


def clean_object(obj: dict[str, Any]) -> dict[str, Any]:
    return {
        k: v
        for k, v in obj.items()
        if v is not None and not (isinstance(v, list) and not v) and not (isinstance(v, dict) and not v)
    }


def safe_parse_serialized_json(input_str: str) -> Any:
    try:
        return json.loads(input_str)
    except:
        return input_str


def last_item(items: list[Any]) -> Any:
    return items[-1] if items else None


def _walk_generations(response: LLMResult):
    for generations in response.generations or []:
        yield from generations or []


def _get_model_name_from_response(response: LLMResult) -> str | None:
    model_name = None
    for generation in _walk_generations(response):
        message = getattr(generation, "message", None)
        if not message:
            continue

        response_metadata = getattr(message, "response_metadata", None)
        if response_metadata and isinstance(response_metadata, dict):
            model_name = response_metadata.get("model_name")

        if model_name:
            break

    if not model_name:
        llm_output: dict[str, Any] = response.llm_output or {}
        model_name = llm_output.get("model_name") or llm_output.get("model") or ""

    return model_name


def _get_metrics_from_response(response: LLMResult):
    metrics = {}

    for generation in _walk_generations(response):
        message = getattr(generation, "message", None)
        if not message:
            continue

        usage_metadata = getattr(message, "usage_metadata", None)

        if usage_metadata and isinstance(usage_metadata, dict):
            metrics.update(
                clean_object(
                    {
                        "total_tokens": usage_metadata.get("total_tokens"),
                        "prompt_tokens": usage_metadata.get("input_tokens"),
                        "completion_tokens": usage_metadata.get("output_tokens"),
                    }
                )
            )

            # Extract cache tokens from nested input_token_details (LangChain format)
            # Maps to Braintrust's standard cache token metric names
            input_token_details = usage_metadata.get("input_token_details")
            if input_token_details and isinstance(input_token_details, dict):
                cache_read = input_token_details.get("cache_read")
                cache_creation = input_token_details.get("cache_creation")

                if cache_read is not None:
                    metrics["prompt_cached_tokens"] = cache_read
                if cache_creation is not None:
                    metrics["prompt_cache_creation_tokens"] = cache_creation

    if not metrics or not any(metrics.values()):
        llm_output: dict[str, Any] = response.llm_output or {}
        metrics = llm_output.get("token_usage") or llm_output.get("estimatedTokens") or {}

    return clean_object(metrics)
