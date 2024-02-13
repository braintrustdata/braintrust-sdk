import dataclasses
import json
from typing import Any, Dict, Optional


class BraintrustJSONEncoder(json.JSONEncoder):
    def default(self, o):
        if dataclasses.is_dataclass(o) and not isinstance(o, type):
            return dataclasses.asdict(o)

        # Attempt to dump a Pydantic v2 `BaseModel`.
        try:
            return o.model_dump()
        except (AttributeError, TypeError):
            pass

        # Attempt to dump a Pydantic v1 `BaseModel`.
        try:
            return obj.dict()
        except (AttributeError, TypeError):
            pass

        return json.JSONEncoder().default(self, o)


# def dump(obj, **kwargs) -> str:
#     return json.dump(obj, cls=BraintrustJSONEncoder, **kwargs)


# def dumps(obj, **kwargs) -> str:
#     return json.dumps(obj, cls=BraintrustJSONEncoder, **kwargs)


# def check_json_serializable(obj: Any) -> None:
#     try:
#         _ = json.dumps(obj)
#     except Exception as e:
#         raise JSONSerializationError from e


# def is_json_serializable(obj: Any) -> bool:
#     try:
#         check_json_serializable(obj)
#         return True
#     except JSONSerializationError:
#         return False


# class JSONSerializationError(Exception):
#     pass


# def make_json_serializable(obj: Any) -> Any:
#     if isinstance(obj, (list, tuple)):
#         return [make_json_serializable(item) for item in obj]
#     if isinstance(obj, dict):
#         return {
#             make_json_serializable(k): make_json_serializable(v)
#             for k, v in obj.items()
#         }
#     obj = dump_object(obj)
#     check_json_serializable(obj)
#     return obj




# def dump_object(obj: Any) -> Any:
#     """Convert an object to a JSON-serializable object if it is an instance of `dataclasses.dataclass` or `pydantic.BaseModel`."""
#     if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
#         return dataclasses.asdict(obj)

#     # Attempt to dump a Pydantic v2 `BaseModel`.
#     try:
#         return obj.model_dump()
#     except (AttributeError, TypeError):
#         pass

#     # Attempt to dump a Pydantic v1 `BaseModel`.
#     try:
#         return obj.dict()
#     except (AttributeError, TypeError):
#         pass

#     return obj


# def make_dict_values_json_serializable(obj: Dict[str, Any]) -> Dict[str, Any]:
#     """Convert an object to a JSON-serializable object assuming the keys are strings."""
#     if is_json_serializable(obj):
#         return obj
#     obj = {
#         k: make_json_serializable(v)
#         for k, v in obj.items()
#     }
#     check_json_serializable(obj)
#     return obj
