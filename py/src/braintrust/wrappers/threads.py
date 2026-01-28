import contextvars
import functools
import logging
import threading
from concurrent import futures
from typing import Any, TypeVar

from wrapt import wrap_function_wrapper  # pyright: ignore[reportUnknownVariableType, reportMissingTypeStubs]

logger = logging.getLogger(__name__)

__all__ = ["setup_threads", "patch_thread", "patch_thread_pool_executor"]


def setup_threads() -> bool:
    """
    Setup automatic context propagation for threading.

    This patches stdlib threading primitives to automatically
    propagate Braintrust context across thread boundaries.

    Enable via:
        - BRAINTRUST_INSTRUMENT_THREADS=true env var (automatic)
        - Call this function directly (manual)

    Returns:
        bool: True if instrumentation was successful, False otherwise.
    """
    try:
        patch_thread(threading.Thread)
        patch_thread_pool_executor(futures.ThreadPoolExecutor)

        logger.debug("Braintrust thread instrumentation enabled")
        return True

    except Exception as e:
        logger.warning(f"Failed to enable thread instrumentation: {e}")
        return False


T = TypeVar("T", bound=type[threading.Thread])


def patch_thread(thread_cls: T) -> T:
    if __is_patched(thread_cls):
        return thread_cls

    def _wrap_thread_start(wrapped: Any, instance: Any, args: Any, kwargs: Any) -> Any:
        try:
            instance._braintrust_context = contextvars.copy_context()
        except Exception as e:
            logger.debug(f"Failed to capture context in thread start: {e}")
        return wrapped(*args, **kwargs)

    wrap_function_wrapper(thread_cls, "start", _wrap_thread_start)

    def _wrap_thread_run(wrapped: Any, instance: Any, args: Any, kwargs: Any) -> Any:
        try:
            if hasattr(instance, "_braintrust_context"):
                return instance._braintrust_context.run(wrapped, *args, **kwargs)
        except Exception as e:
            logger.debug(f"Failed to restore context in thread run: {e}")
        return wrapped(*args, **kwargs)

    wrap_function_wrapper(thread_cls, "run", _wrap_thread_run)

    __mark_patched(thread_cls)
    return thread_cls


def __is_patched(obj: Any) -> bool:
    """Check if an object has already been patched."""
    return getattr(obj, "_braintrust_patched", False)


def __mark_patched(obj: Any) -> None:
    setattr(obj, "_braintrust_patched", True)


P = TypeVar("P", bound=type[futures.ThreadPoolExecutor])


def patch_thread_pool_executor(executor_cls: P) -> P:
    if __is_patched(executor_cls):
        return executor_cls

    def _wrap_executor_submit(wrapped: Any, instance: Any, args: Any, kwargs: Any) -> Any:
        try:
            if not args:
                return wrapped(*args, **kwargs)

            func = args[0]
            ctx = contextvars.copy_context()

            @functools.wraps(func)
            def context_wrapper(*func_args: Any, **func_kwargs: Any) -> Any:
                try:
                    return ctx.run(func, *func_args, **func_kwargs)
                except Exception as e:
                    # context.run() can fail if token is invalid
                    logger.debug(f"Failed to run in captured context: {e}")
                    return func(*func_args, **func_kwargs)

            new_args = (context_wrapper,) + args[1:]
            return wrapped(*new_args, **kwargs)
        except Exception as e:
            # Wrapping can fail - fall back to original
            logger.debug(f"Failed to wrap executor submit: {e}")
            return wrapped(*args, **kwargs)

    wrap_function_wrapper(executor_cls, "submit", _wrap_executor_submit)

    __mark_patched(executor_cls)
    return executor_cls
