import dataclasses
import json
from typing import Any, cast


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

        # When everything fails, try to return the string representation of the object
        try:
            return str(o)
        except Exception:
            # If str() fails, return an error placeholder
            return f"<non-serializable: {type(o).__name__}>"


def bt_dumps(obj, **kwargs) -> str:
    return json.dumps(obj, cls=BraintrustJSONEncoder, allow_nan=False, **kwargs)
