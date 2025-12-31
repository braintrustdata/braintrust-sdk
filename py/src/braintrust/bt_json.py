import dataclasses
import json
import math
from typing import Any, Callable, Mapping, cast

# Try to import orjson for better performance
# If not available, we'll use standard json
try:
    import orjson

    _HAS_ORJSON = True
except ImportError:
    _HAS_ORJSON = False



def _sanitize_object(v: Any) -> Any:
    """
    Replaces references to user objects
    with placeholder strings to ensure serializability, except for `Attachment`
    and `ExternalAttachment` objects, which are preserved and not deep-copied.

    Handles circular references and excessive nesting depth to prevent
    RecursionError during serialization.
    """
    # avoid circular imports
    from braintrust.logger import BaseAttachment, Dataset, Experiment, Logger, ReadonlyAttachment, Span

    if isinstance(v, Span):
        return "<span>"

    if isinstance(v, Experiment):
        return "<experiment>"

    if isinstance(v, Dataset):
        return "<dataset>"

    if isinstance(v, Logger):
        return "<logger>"

    if isinstance(v, BaseAttachment):
        return v

    if isinstance(v, ReadonlyAttachment):
        return v.reference

    if dataclasses.is_dataclass(v) and not isinstance(v, type):
        return dataclasses.asdict(v)

    # Pydantic model classes (not instances) with model_json_schema
    if isinstance(v, type) and hasattr(v, "model_json_schema") and callable(cast(Any, v).model_json_schema):
        try:
            return cast(Any, v).model_json_schema()
        except Exception:
            pass

    # Attempt to dump a Pydantic v2 `BaseModel`.
    try:
        return cast(Any, v).model_dump()
    except (AttributeError, TypeError):
        pass

    # Attempt to dump a Pydantic v1 `BaseModel`.
    try:
        return cast(Any, v).dict()
    except (AttributeError, TypeError):
        pass

    if isinstance(v, float):
        # Handle NaN and Infinity for JSON compatibility
        if math.isnan(v):
            return "NaN"

        if math.isinf(v):
            return "Infinity" if v > 0 else "-Infinity"

        return v

    if isinstance(v, (int, str, bool)) or v is None:
        # Skip roundtrip for primitive types.
        return v

    # Note: we avoid using copy.deepcopy, because it's difficult to
    # guarantee the independence of such copied types from their origin.
    # E.g. the original type could have a `__del__` method that alters
    # some shared internal state, and we need this deep copy to be
    # fully-independent from the original.
    return bt_loads(bt_dumps(v))

def deep_copy_and_sanitize_dict(dikt: Mapping[str, Any], sanitize_func: Callable[[Any], Any] | None = None) -> dict[str, Any]:
    """
    Creates a deep copy of the given object.
    """
    # Maximum depth to prevent hitting Python's recursion limit
    # Python's default limit is ~1000, we use a conservative limit
    # to account for existing call stack usage from pytest, application code, etc.
    MAX_DEPTH = 200

    # Track visited objects to detect circular references
    visited: set[int] = set()

    if sanitize_func is None:
        sanitize_func = _sanitize_object

    def _deep_copy_object(v: Any, depth: int = 0) -> Any:
        # Check depth limit - use >= to stop before exceeding
        if depth >= MAX_DEPTH:
            return "<max depth exceeded>"

        # Check for circular references in mutable containers
        # Use id() to track object identity
        if isinstance(v, (Mapping, list, tuple, set)):
            obj_id = id(v)
            if obj_id in visited:
                return "<circular reference>"
            visited.add(obj_id)
            try:
                if isinstance(v, Mapping):
                    # Prevent dict keys from holding references to user data. Note that
                    # `bt_json` already coerces keys to string, a behavior that comes from
                    # `json.dumps`. However, that runs at log upload time, while we want to
                    # cut out all the references to user objects synchronously in this
                    # function.
                    result = {}
                    for k in v:
                        try:
                            key_str = str(k)
                        except Exception:
                            # If str() fails on the key, use a fallback representation
                            key_str = f"<non-stringifiable-key: {type(k).__name__}>"
                        result[key_str] = _deep_copy_object(v[k], depth + 1)
                    return result
                elif isinstance(v, (list, tuple, set)):
                    return [_deep_copy_object(x, depth + 1) for x in v]
            finally:
                # Remove from visited set after processing to allow the same object
                # to appear in different branches of the tree
                visited.discard(obj_id)

        try:
            return sanitize_func(v)
        except Exception:
            return f"<non-sanitizable: {type(v).__name__}>"

    return _deep_copy_object(dikt)


def _to_dict(obj: Any) -> Any:
    """
    Handler for non-JSON-serializable objects. Returns a string representation of the object.
    If you need to handle more complex objects, you can pass a custom sanitize function to deep_copy_and_sanitize_dict.
    """
    # When everything fails, try to return the string representation of the object
    try:
        return str(obj)
    except Exception:
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
