import json
import logging
import re
from typing import (
    Any,
    Dict,
    List,
    Mapping,
    Optional,
    Pattern,
    Sequence,
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
    tags: NotRequired[Optional[Sequence[str]]]
    scores: NotRequired[Mapping[str, Union[int, float]]]
    metadata: NotRequired[Mapping[str, Any]]
    metrics: NotRequired[Mapping[str, Union[int, float]]]
    id: NotRequired[str]
    dataset_record_id: NotRequired[str]


class BraintrustCallbackHandler(BaseCallbackHandler):
    root_run_id: Optional[UUID] = None

    def __init__(
        self,
        logger: Optional[Union[Logger, Span]] = None,
        debug: bool = False,
        exclude_metadata_props: Optional[Pattern[str]] = None,
    ):
        self.logger = logger
        self.spans: Dict[UUID, Span] = {}
        self.debug = debug  # DEPRECATED
        self.exclude_metadata_props = exclude_metadata_props or re.compile(
            r"^(l[sc]_|langgraph_|__pregel_|checkpoint_ns)"
        )
        self.skipped_runs: Set[UUID] = set()
        # Set run_inline=True to avoid thread executor in async contexts
        # This ensures memory logger context is preserved
        self.run_inline = True

    def _start_span(
        self,
        parent_run_id: Optional[UUID],
        run_id: UUID,
        name: Optional[str] = None,
        type: Optional[SpanTypeAttribute] = SpanTypeAttribute.TASK,
        span_attributes: Optional[Union[SpanAttributes, Mapping[str, Any]]] = None,
        start_time: Optional[float] = None,
        set_current: Optional[bool] = None,
        parent: Optional[str] = None,
        event: Optional[LogEvent] = None,
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

    # TODO: serialize input, output, metadata correctly
    def _end_span(
        self,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        input: Optional[Any] = None,
        output: Optional[Any] = None,
        expected: Optional[Any] = None,
        error: Optional[str] = None,
        tags: Optional[Sequence[str]] = None,
        scores: Optional[Mapping[str, Union[int, float]]] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        metrics: Optional[Mapping[str, Union[int, float]]] = None,
        dataset_record_id: Optional[str] = None,
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

        span.end()

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,  # TODO: response=
    ) -> Any:
        self._end_span(run_id, error=str(error), metadata={**kwargs})

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,  # TODO: some metadata
    ) -> Any:
        self._end_span(run_id, error=str(error), metadata={**kwargs})

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, error=str(error), metadata={**kwargs})

    def on_retriever_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, error=str(error), metadata={**kwargs})

    # Agent Methods
    def on_agent_action(
        self,
        action: AgentAction,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
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
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, output=finish, metadata={**kwargs})

    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Any:
        tags = tags or []

        # avoids extra logs that seem not as useful esp. with langgraph
        if "langsmith:hidden" in tags:
            self.skipped_runs.add(run_id)
            return

        metadata = metadata or {}
        resolved_name = (
            metadata.get("langgraph_node")
            or name
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
        outputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, output=outputs, tags=tags, metadata={**kwargs})

    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        name: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
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
        serialized: Dict[str, Any],
        messages: List[List["BaseMessage"]],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        name: Optional[str] = None,
        invocation_params: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Any:
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
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Any:
        if run_id not in self.spans:
            return

        metrics = _get_metrics_from_response(response)
        model_name = _get_model_name_from_response(response)

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
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        inputs: Optional[Dict[str, Any]] = None,
        name: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        self._start_span(
            parent_run_id,
            run_id,
            name=name or serialized.get("name") or last_item(serialized.get("id") or []) or "Tool",
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
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, output=output, metadata={**kwargs})

    def on_retriever_start(
        self,
        serialized: Dict[str, Any],
        query: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        name: Optional[str] = None,
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
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, output=documents, metadata={**kwargs})

    def on_llm_new_token(
        self,
        token: str,
        *,
        chunk: Optional[Union["GenerationChunk", "ChatGenerationChunk"]] = None,  # type: ignore
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        pass

    def on_text(
        self,
        text: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        pass

    def on_retry(
        self,
        retry_state: RetryCallState,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        pass

    def on_custom_event(
        self,
        name: str,
        data: Any,
        *,
        run_id: UUID,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Any:
        pass


def clean_object(obj: Dict[str, Any]) -> Dict[str, Any]:
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


def last_item(items: List[Any]) -> Any:
    return items[-1] if items else None


def _walk_generations(response: LLMResult):
    for generations in response.generations or []:
        for generation in generations or []:
            yield generation


def _get_model_name_from_response(response: LLMResult) -> Optional[str]:
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
        llm_output: Dict[str, Any] = response.llm_output or {}
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

    if not metrics or not any(metrics.values()):
        llm_output: Dict[str, Any] = response.llm_output or {}
        metrics = llm_output.get("token_usage") or llm_output.get("estimatedTokens") or {}

    return clean_object(metrics)
