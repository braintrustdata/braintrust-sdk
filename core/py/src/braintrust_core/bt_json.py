import dataclasses
import json


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
            return o.dict()
        except (AttributeError, TypeError):
            pass

        return json.JSONEncoder().default(self, o)


def bt_dumps(obj, **kwargs) -> str:
    return json.dumps(obj, cls=BraintrustJSONEncoder, **kwargs)
