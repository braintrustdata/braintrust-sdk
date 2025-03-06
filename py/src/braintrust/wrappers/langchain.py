import contextvars
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from typing_extensions import Protocol

import braintrust

_logger = logging.getLogger("braintrust.wrappers.langchain")

try:
    from langchain.callbacks.base import BaseCallbackHandler  # type: ignore
    from langchain.schema import Document  # type: ignore
    from langchain.schema.messages import BaseMessage  # type: ignore
    from langchain.schema.output import LLMResult  # type: ignore
except ImportError:
    _logger.warning("Failed to import langchain, using stubs")
    class BaseCallbackHandler:
        def on_llm_start(self, *args: Any, **kwargs: Any) -> None: ...
        def on_llm_end(self, *args: Any, **kwargs: Any) -> None: ...
        def on_chain_start(self, *args: Any, **kwargs: Any) -> None: ...
        def on_chain_end(self, *args: Any, **kwargs: Any) -> None: ...
        def on_tool_start(self, *args: Any, **kwargs: Any) -> None: ...
        def on_tool_end(self, *args: Any, **kwargs: Any) -> None: ...
        def on_retriever_start(self, *args: Any, **kwargs: Any) -> None: ...
        def on_retriever_end(self, *args: Any, **kwargs: Any) -> None: ...

    class Document:
        pass

    class BaseMessage(Protocol):
        def dict(self) -> Dict[str, Any]:
            ...

    class LLMResult(Protocol):
        llm_output: Dict[str, Any]
        generations: List[List[BaseMessage]]
        def dict(self) -> Dict[str, Any]:
            ...

langchain_parent: contextvars.ContextVar[Optional[braintrust.Span]] = contextvars.ContextVar("langchain_current_span", default=None)


class BraintrustTracer(BaseCallbackHandler):
    def __init__(self, logger: Optional[braintrust.Logger] = None):
        self.logger = logger
        self.spans: Dict[UUID, braintrust.Span] = {}

    def _start_span(self, parent_run_id: Optional[UUID], run_id: UUID, name: Optional[str], **kwargs: Any) -> Any:
        assert run_id not in self.spans, f"Span already exists for run_id {run_id} (this is likely a bug)"

        current_parent = langchain_parent.get()
        if parent_run_id in self.spans:
            parent_span = self.spans[parent_run_id]
        elif current_parent is not None:
            parent_span = current_parent
        elif self.logger is not None:
            parent_span = self.logger
        else:
            parent_span = braintrust

        span = parent_span.start_span(name=name, **kwargs)
        langchain_parent.set(span)
        self.spans[run_id] = span
        return span

    def _end_span(self, run_id: UUID, **kwargs: Any) -> Any:
        assert run_id in self.spans, f"No span exists for run_id {run_id} (this is likely a bug)"
        span = self.spans.pop(run_id)
        span.log(**kwargs)

        if langchain_parent.get() == span:
            langchain_parent.set(None)

        span.end()

    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Any:
        self._start_span(parent_run_id, run_id, "Chain", input=inputs, metadata={"tags": tags})

    def on_chain_end(
        self, outputs: Dict[str, Any], *, run_id: UUID, parent_run_id: Optional[UUID] = None, **kwargs: Any
    ) -> Any:
        self._end_span(run_id, output=outputs)

    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Any:
        self._start_span(
            parent_run_id,
            run_id,
            "LLM",
            input=prompts,
            metadata={"tags": tags, **kwargs["invocation_params"]},
        )

    def on_chat_model_start(
        self,
        serialized: Dict[str, Any],
        messages: List[List[BaseMessage]],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Any:
        self._start_span(
            parent_run_id,
            run_id,
            "Chat Model",
            input=[[m.dict() for m in batch] for batch in messages],
            metadata={"tags": tags, **kwargs["invocation_params"]},
        )

    def on_llm_end(
        self, response: LLMResult, *, run_id: UUID, parent_run_id: Optional[UUID] = None, **kwargs: Any
    ) -> Any:
        metrics = {}
        token_usage = response.llm_output.get("token_usage", {})
        if "total_tokens" in token_usage:
            metrics["tokens"] = token_usage["total_tokens"]
        if "prompt_tokens" in token_usage:
            metrics["prompt_tokens"] = token_usage["prompt_tokens"]
        if "completion_tokens" in token_usage:
            metrics["completion_tokens"] = token_usage["completion_tokens"]

        self._end_span(run_id, output=[[m.dict() for m in batch] for batch in response.generations], metrics=metrics)

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Any:
        _logger.warning("Starting tool, but it will not be traced in braintrust (unsupported)")

    def on_tool_end(self, output: str, *, run_id: UUID, parent_run_id: Optional[UUID] = None, **kwargs: Any) -> Any:
        pass

    def on_retriever_start(
        self, query: str, *, run_id: UUID, parent_run_id: Optional[UUID] = None, **kwargs: Any
    ) -> Any:
        _logger.warning("Starting retriever, but it will not be traced in braintrust (unsupported)")

    def on_retriever_end(
        self, response: List[Document], *, run_id: UUID, parent_run_id: Optional[UUID] = None, **kwargs: Any
    ) -> Any:
        pass
