from typing import Any


def omit(obj, keys):
    return {k: v for k, v in obj.items() if k not in keys}


def is_patched(obj: Any) -> bool:
    return getattr(obj, "_braintrust_patched", False)


def mark_patched(obj: Any):
    setattr(obj, "_braintrust_patched", True)
