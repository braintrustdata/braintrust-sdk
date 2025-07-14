import json
import logging
import os
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
    cast,
)
from uuid import UUID

import braintrust
from braintrust import NOOP_SPAN, Logger, Span, SpanAttributes, SpanTypeAttribute, current_span, init_logger
from langchain_core.agents import AgentAction, AgentFinish
from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.documents import Document
from langchain_core.messages import BaseMessage, ToolMessage
from langchain_core.outputs.llm_result import LLMResult
from tenacity import RetryCallState
from typing_extensions import NotRequired

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
        self.debug = bool(os.environ.get("DEBUG")) or debug
        self.exclude_metadata_props = exclude_metadata_props or re.compile(
            r"^(l[sc]_|langgraph_|__pregel_|checkpoint_ns)"
        )
        self.skipped_runs: Set[UUID] = set()

    def _start_span(
        self,
        parent_run_id: Optional[UUID],
        run_id: UUID,
        name: Optional[str] = None,
        type: Optional[SpanTypeAttribute] = None,
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
                **({"runId": run_id, "parentRunId": parent_run_id} if self.debug else {}),
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

    def clean_metadata(self, metadata: Optional[Mapping[str, Any]]) -> Mapping[str, Any]:
        return {k: v for k, v in (metadata or {}).items() if not self.exclude_metadata_props.search(k)}

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,  # TODO: response=
    ) -> Any:
        self._end_span(run_id, error=str(error))

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,  # TODO: some metadata
    ) -> Any:
        self._end_span(run_id, error=str(error))

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, error=str(error))

    def on_retriever_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, error=str(error))

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
            name=action.tool,
            event={
                "input": action.tool_input,  # type: ignore[arg-type]
            },
        )

    def on_agent_finish(
        self,
        finish: AgentFinish,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._end_span(run_id, output=finish.return_values)  # type: ignore

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
        metadata = metadata or {}
        resolved_name = metadata.get("langgraph_node") or name or last_item(serialized.get("id") or []) or "Chain"

        tags = tags or []

        # avoids extra logs that seem not as useful esp. with langgraph
        if "langsmith:hidden" in tags:
            self.skipped_runs.add(run_id)
            return

        self._start_span(
            parent_run_id,
            run_id,
            name=resolved_name,
            event={"input": inputs, "metadata": {"tags": tags, **metadata, **kwargs}},
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
        self._end_span(run_id, output=output_from_chain_values(outputs), tags=tags)

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
        name = name or last_item(serialized.get("id") or []) or "LLM"

        self._start_span(
            parent_run_id,
            run_id,
            name=name,
            type=SpanTypeAttribute.LLM,
            event={
                "input": prompts,
                "tags": tags,
                "metadata": {
                    **self.clean_metadata(metadata),
                    **kwargs["invocation_params"],
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
            name=name or last_item(serialized.get("id") or []) or "Chat Model",
            type=SpanTypeAttribute.LLM,
            event={
                "input": input_from_messages(messages),
                "tags": tags,
                "metadata": clean_object(
                    {
                        **self.clean_metadata(metadata),
                        **extract_call_args(serialized, invocation_params, metadata),
                        "tools": invocation_params.get("tools"),
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

        llm_output: Dict[str, Any] = response.llm_output or {}  # type: ignore
        generations = response.generations
        metadata = {
            k: v
            # for 3.8 we need to use dict()
            for k, v in response.dict().items()  # type: ignore
            if k not in ("llm_output", "generations")
        }

        model_name = llm_output.get("model_name")
        token_usage: Dict[str, Any] = llm_output.get("token_usage") or llm_output.get("estimatedTokens") or {}

        self._end_span(
            run_id,
            output=output_from_generations(generations),
            metrics=clean_object(
                {
                    "tokens": token_usage.get("total_tokens"),
                    "prompt_tokens": token_usage.get("prompt_tokens"),
                    "completion_tokens": token_usage.get("completion_tokens"),
                }
            ),
            tags=tags,
            metadata=self.clean_metadata({**metadata, "model_name": model_name}),
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
            name=name or last_item(serialized.get("id") or []) or "Tool",
            event={
                "input": inputs or safe_parse_serialized_json(input_str),
                "tags": tags,
                "metadata": {
                    **self.clean_metadata(metadata),
                    **extract_call_args(serialized, kwargs.get("invocation_params") or {}, metadata),
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
        self._end_span(run_id, output=output_from_tool_output(output))

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
            name=name or last_item(serialized.get("id") or []) or "Retriever",
            type=SpanTypeAttribute.FUNCTION,
            event={
                "input": query,
                "tags": tags,
                "metadata": {
                    **self.clean_metadata(metadata),
                    **extract_call_args(serialized, kwargs.get("invocation_params") or {}, metadata),
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
        self._end_span(run_id, output=documents)

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


def extract_call_args(
    llm: Dict[str, Any],
    invocation_params: Dict[str, Any],
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    metadata = metadata or {}

    # NOTE: These vary by langchain model used. We try to normalize them here.
    args = clean_object(
        {
            "model": pick(invocation_params.get("model"), metadata.get("ls_model_name"), llm.get("name")),
            "temperature": pick(invocation_params.get("temperature"), metadata.get("ls_temperature")),
            "top_p": pick(invocation_params.get("top_p"), invocation_params.get("top_k")),
            "top_k": pick(invocation_params.get("top_k"), invocation_params.get("top_p")),
            "max_tokens": pick(invocation_params.get("max_tokens"), invocation_params.get("max_output_tokens")),
            "frequency_penalty": invocation_params.get("frequency_penalty"),
            "presence_penalty": invocation_params.get("presence_penalty"),
            "response_format": invocation_params.get("response_format"),
            "tool_choice": invocation_params.get("tool_choice"),
            "function_call": invocation_params.get("function_call"),
            "n": invocation_params.get("n"),
            "stop": pick(invocation_params.get("stop"), invocation_params.get("stop_sequence")),
        }
    )

    # Failsafe let's provide the invocation params as is
    return invocation_params if not args else args


def pick(*values: Any) -> Any:
    return next((value for value in values if value is not None), None)


def output_from_generations(generations: Union[List[List[Any]], List[Any]]) -> List[Any]:
    parsed: List[Any] = []
    for batch in generations:
        if isinstance(batch, list):
            parsed.extend(map(parse_generation, batch))  # pyright: ignore
        else:
            parsed.append(parse_generation(batch))
    return parsed


def parse_generation(generation: Any) -> Any:
    if hasattr(generation, "message"):
        return get_message_content(generation.message)
    if hasattr(generation, "text"):
        return generation.text
    # Give up!
    return None


def input_from_messages(messages: List[List[Any]]) -> List[Any]:
    return [get_message_content(message) for batch in messages for message in batch]


def get_message_content(message: Any) -> Dict[str, Any]:
    role = getattr(message, "name", None) or message.type

    if message.type == "human":
        role = "user"
    elif message.type == "ai":
        role = "assistant"
    elif message.type == "system":
        role = "system"

    return clean_object(
        {
            "content": message.content,
            "role": role,
            "tool_calls": getattr(message, "tool_calls", None),
            "status": getattr(message, "status", None),
            "artifact": getattr(message, "artifact", None),
        }
    )


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


def output_from_tool_output(output: Any) -> Optional[Dict[str, Any]]:
    return get_message_content(output) if isinstance(output, ToolMessage) else None


def flatten_list(items: List[Any]) -> List[Any]:
    result: List[Any] = []
    for item in items:
        if isinstance(item, list):
            result.extend(cast(List[Any], item))
        else:
            result.append(item)
    return result


def output_from_chain_values(output: Any) -> Any:
    output_list: List[Any] = [output] if not isinstance(output, list) else output

    processed = [parse_chain_value(x) for x in output_list]

    parsed = flatten_list(processed)

    return parsed[0] if len(parsed) == 1 else parsed


def parse_chain_value(output: Any) -> Any:
    if isinstance(output, str):
        return output

    if not output:
        return output

    if hasattr(output, "content"):
        return output.content

    if hasattr(output, "messages"):
        return [parse_chain_value(m) for m in output.messages]

    if hasattr(output, "value"):
        return output.value

    if hasattr(output, "kwargs"):
        return parse_chain_value(output.kwargs)

    # XXX: RunnableMap returns an object with keys for each sequence
    if isinstance(output, dict):
        output = cast(Dict[str, Any], output)
        return {k: parse_chain_value(v) for k, v in cast(Dict[str, Any], output).items()}

    # Give up! Let's assume the user will use the raw output.
    return output


def input_from_chain_values(inputs: Any) -> Any:
    inputs_list = cast(List[Any], [inputs] if not isinstance(inputs, list) else inputs)
    parsed = [parse_chain_value(x) for x in inputs_list]
    return parsed[0] if len(parsed) == 1 else parsed


def last_item(items: List[Any]) -> Any:
    return items[-1] if items else None
