from contextvars import ContextVar
from typing import Optional

from langchain_core.tracers.context import register_configure_hook

from braintrust_langchain.callbacks import BraintrustCallbackHandler

__all__ = ["set_global_handler", "clear_global_handler"]


braintrust_callback_handler_var: ContextVar[BraintrustCallbackHandler | None] = ContextVar(
    "braintrust_callback_handler", default=None
)


def set_global_handler(handler: BraintrustCallbackHandler):
    braintrust_callback_handler_var.set(handler)


def clear_global_handler():
    braintrust_callback_handler_var.set(None)


register_configure_hook(
    context_var=braintrust_callback_handler_var,
    inheritable=True,
)
