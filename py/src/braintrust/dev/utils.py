from typing import Any, Optional


def get_any(obj: Any, key: str, default: Optional[Any] = None):
    for accessor in [lambda: getattr(obj, key), lambda: obj[key]]:
        try:
            return accessor()
        except (AttributeError, KeyError, TypeError):
            continue
    return default
