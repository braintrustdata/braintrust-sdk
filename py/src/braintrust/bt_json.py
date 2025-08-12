import dataclasses
import json
import logging
from typing import Any, List, cast

logger = logging.getLogger(__name__)


class BraintrustJSONEncoder(json.JSONEncoder):
    def default(self, o: Any):
        if dataclasses.is_dataclass(o) and not isinstance(o, type):
            return dataclasses.asdict(o)

        # Attempt to dump a Pydantic v2 `BaseModel`.
        try:
            return cast(Any, o).model_dump()
        except (AttributeError, TypeError):
            pass

        # Attempt to dump a Pydantic v1 `BaseModel`.
        try:
            return cast(Any, o).dict()
        except (AttributeError, TypeError):
            pass

        # When everything fails, just return the string representation of the object
        return str(o)


def to_bt_json(obj, **kwargs) -> str:
    return json.dumps(obj, cls=BraintrustJSONEncoder, allow_nan=False, **kwargs)


def iter_to_bt_json(items: List[Any], raise_on_error: bool = True) -> List[str]:
    """Serialize an iterator of objects to a list of strings."""
    result = []
    for item in items:
        try:
            result.append(to_bt_json(item))
        except Exception as e:
            # Skip items with NaN/inf values or other serialization errors
            if raise_on_error:
                raise
            else:
                logger.error(f"Failed to serialize item: {e}")
    return result


def bt_dumps(obj, **kwargs) -> str:
    # deprecated, use to_bt_json instead
    return to_bt_json(obj, **kwargs)
