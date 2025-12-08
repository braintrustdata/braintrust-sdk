import dataclasses
import json
from typing import Any, cast

# Try to import orjson for better performance
# If not available, we'll use standard json
try:
    import orjson

    _HAS_ORJSON = True
except ImportError:
    _HAS_ORJSON = False


def _to_dict(obj: Any) -> Any:
    """
    Function-based default handler for non-JSON-serializable objects.

    Handles:
    - dataclasses
    - Pydantic v2 BaseModel
    - Pydantic v1 BaseModel
    - Falls back to str() for unknown types
    """
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return dataclasses.asdict(obj)

    # Attempt to dump a Pydantic v2 `BaseModel`.
    try:
        return cast(Any, obj).model_dump()
    except (AttributeError, TypeError):
        pass

    # Attempt to dump a Pydantic v1 `BaseModel`.
    try:
        return cast(Any, obj).dict()
    except (AttributeError, TypeError):
        pass

    # When everything fails, try to return the string representation of the object
    try:
        return str(obj)
    except Exception:
        # If str() fails, return an error placeholder
        return f"<non-serializable: {type(obj).__name__}>"


class BraintrustJSONEncoder(json.JSONEncoder):
    """
    Custom JSON encoder for standard json library.

    This is used as a fallback when orjson is not available or fails.
    """

    def default(self, o: Any):
        return _to_dict(o)


def bt_dumps(obj, **kwargs) -> str:
    """
    Serialize obj to a JSON-formatted string.

    Automatically uses orjson if available for better performance (3-5x faster),
    with fallback to standard json library if orjson is not installed or fails.

    Args:
        obj: Object to serialize
        **kwargs: Additional arguments (passed to json.dumps in fallback path)

    Returns:
        JSON string representation of obj
    """
    if _HAS_ORJSON:
        # Try orjson first for better performance
        try:
            # pylint: disable=no-member  # orjson is a C extension, pylint can't introspect it
            return orjson.dumps(  # type: ignore[possibly-unbound]
                obj,
                default=_to_dict,
                # options match json.dumps behavior for bc
                option=orjson.OPT_SORT_KEYS | orjson.OPT_SERIALIZE_NUMPY | orjson.OPT_NON_STR_KEYS,  # type: ignore[possibly-unbound]
            ).decode("utf-8")
        except Exception:
            # If orjson fails, fall back to standard json
            pass

    # Use standard json (either orjson not available or it failed)
    # Use sort_keys=True for deterministic output (matches orjson OPT_SORT_KEYS)
    return json.dumps(obj, cls=BraintrustJSONEncoder, allow_nan=False, sort_keys=True, **kwargs)


def bt_loads(s: str, **kwargs) -> Any:
    """
    Deserialize s (a str containing a JSON document) to a Python object.

    Automatically uses orjson if available for better performance (2-3x faster),
    with fallback to standard json library if orjson is not installed or fails.

    Args:
        s: JSON string to deserialize
        **kwargs: Additional arguments (passed to json.loads in fallback path)

    Returns:
        Python object representation of JSON string
    """
    if _HAS_ORJSON:
        # Try orjson first for better performance
        try:
            # pylint: disable=no-member  # orjson is a C extension, pylint can't introspect it
            return orjson.loads(s)  # type: ignore[possibly-unbound]
        except Exception:
            # If orjson fails, fall back to standard json
            pass

    # Use standard json (either orjson not available or it failed)
    return json.loads(s, **kwargs)
