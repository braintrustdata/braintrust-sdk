import json
from collections.abc import Sequence
from typing import Any, Union, get_args, get_origin, get_type_hints

from typing_extensions import TypedDict

# This is not beautiful code, but it saves us from introducing Pydantic as a dependency, and it is fairly
# straightforward for an LLM to keep it up to date with runEvalBodySchema in JS.


class ValidationError(Exception):
    """Raised when validation fails."""

    pass


class ParsedFunctionId(TypedDict, total=False):
    """Parsed function identifier."""

    function_id: str | None
    version: str | None
    name: str | None
    prompt_session_id: str | None
    inline_code: str | None
    global_function: str | None


class ParsedParent(TypedDict):
    """Parsed parent reference."""

    object_type: str
    object_id: str


class ParsedEvalBody(TypedDict, total=False):
    """Type for parsed eval request body."""

    name: str  # Required
    parameters: dict[str, Any]
    data: Any
    scores: list[ParsedFunctionId]
    experiment_name: str
    project_id: str
    parent: str | ParsedParent
    stream: bool


def validate_typed_dict(data: Any, typed_dict_class: type, path: str = "") -> dict[str, Any]:
    """Validate data against a TypedDict definition."""
    if not isinstance(data, dict):
        raise ValidationError(f"{path or 'Root'} must be a dictionary, got {type(data).__name__}")

    # Get type hints for the TypedDict
    hints = get_type_hints(typed_dict_class, include_extras=True)
    required_fields = getattr(typed_dict_class, "__required_keys__", set())

    validated = {}

    # Check required fields
    for field in required_fields:
        if field not in data:
            raise ValidationError(f"{path}.{field} is required" if path else f"{field} is required")

    # Validate each field
    for field_name, field_type in hints.items():
        if field_name not in data:
            continue

        value = data[field_name]
        field_path = f"{path}.{field_name}" if path else field_name

        try:
            validated[field_name] = validate_value(value, field_type, field_path)
        except ValidationError:
            raise
        except Exception as e:
            raise ValidationError(f"Error validating {field_path}: {e}")

    return validated


def validate_value(value: Any, expected_type: type, path: str) -> Any:
    """Validate a value against a type annotation."""
    # Handle None
    if value is None:
        if type(None) in get_args(expected_type):
            return None
        raise ValidationError(f"{path} cannot be None")

    # Get the origin type (e.g., Union, List, Dict)
    origin = get_origin(expected_type)

    # Handle Union types
    if origin is Union:
        # Try each type in the union
        for arg_type in get_args(expected_type):
            try:
                return validate_value(value, arg_type, path)
            except ValidationError:
                continue
        raise ValidationError(f"{path} does not match any of the expected types")

    # Handle Optional (which is Union[T, None])
    if origin is Union and type(None) in get_args(expected_type):  # Check for Optional[T] which is Union[T, None]
        inner_type = get_args(expected_type)[0]
        if value is None:
            return None
        return validate_value(value, inner_type, path)

    # Handle List/Sequence
    if origin in (list, list, Sequence):
        if not isinstance(value, list):
            raise ValidationError(f"{path} must be a list, got {type(value).__name__}")

        item_type = get_args(expected_type)[0] if get_args(expected_type) else Any
        return [validate_value(item, item_type, f"{path}[{i}]") for i, item in enumerate(value)]

    # Handle Dict/Mapping
    if origin in (dict, dict):
        if not isinstance(value, dict):
            raise ValidationError(f"{path} must be a dict, got {type(value).__name__}")

        if get_args(expected_type):
            key_type, value_type = get_args(expected_type)
            validated_dict = {}
            for k, v in value.items():
                validated_key = validate_value(k, key_type, f"{path}.{k} (key)")
                validated_value = validate_value(v, value_type, f"{path}.{k}")
                validated_dict[validated_key] = validated_value
            return validated_dict
        return value

    # Handle TypedDict
    if hasattr(expected_type, "__annotations__"):
        return validate_typed_dict(value, expected_type, path)

    # Handle basic types
    if expected_type in (str, int, float, bool):
        if not isinstance(value, expected_type):
            raise ValidationError(f"{path} must be {expected_type.__name__}, got {type(value).__name__}")
        return value

    # Handle Any
    if expected_type is Any:
        return value

    # For complex types we can't validate, just return the value
    return value


def parse_function_id(data: Any, path: str = "function") -> ParsedFunctionId:
    """Parse a FunctionId from various formats."""
    if isinstance(data, dict):
        result: ParsedFunctionId = {}
        # Accept various function specifications
        if "function_id" in data:
            result["function_id"] = data["function_id"]
            if "version" in data:
                result["version"] = data["version"]
            return result
        elif "name" in data:
            result["name"] = data["name"]
            return result
        elif "prompt_session_id" in data:
            result["prompt_session_id"] = data["prompt_session_id"]
            return result
        elif "inline_code" in data:
            result["inline_code"] = data["inline_code"]
            return result
        elif "global_function" in data:
            result["global_function"] = data["global_function"]
            return result
    raise ValidationError(f"{path} must specify function_id, name, prompt_session_id, or inline_code")


def parse_eval_body(request_data: str | bytes | dict) -> ParsedEvalBody:
    """
    Parse request body for eval execution.

    This validates against a subset of the RunEval schema that makes sense
    for the dev server use case.
    """
    # Handle different input types
    if isinstance(request_data, (str, bytes)):
        try:
            data = json.loads(request_data)
        except json.JSONDecodeError as e:
            raise ValidationError(f"Invalid JSON: {e}")
    else:
        data = request_data

    if not isinstance(data, dict):
        raise ValidationError("Request body must be a JSON object")

    # Required fields
    if "name" not in data:
        raise ValidationError("name is required")

    name = data["name"]
    if not isinstance(name, str):
        raise ValidationError(f"name must be a string, got {type(name).__name__}")

    # Build the parsed body
    parsed: ParsedEvalBody = {"name": name}

    # Optional fields with validation
    if "parameters" in data:
        if not isinstance(data["parameters"], dict):
            raise ValidationError("parameters must be a dictionary")
        parsed["parameters"] = data["parameters"]

    if "data" in data:
        # For dev server, we accept inline data arrays or dataset references
        parsed["data"] = data["data"]

    if "scores" in data:
        scores_data = data["scores"]
        if not isinstance(scores_data, list):
            raise ValidationError("scores must be an array")

        # Parse each score function
        parsed_scores = []
        for i, score in enumerate(scores_data):
            try:
                parsed_scores.append(
                    {
                        "name": score["name"],
                        "function_id": parse_function_id(score["function_id"], f"scores[{i}]"),
                    }
                )
            except ValidationError as e:
                raise ValidationError(f"Invalid score at index {i}: {e}")

        parsed["scores"] = parsed_scores

    if "experiment_name" in data:
        if not isinstance(data["experiment_name"], str):
            raise ValidationError("experiment_name must be a string")
        parsed["experiment_name"] = data["experiment_name"]

    if "project_id" in data:
        if not isinstance(data["project_id"], str):
            raise ValidationError("project_id must be a string")
        parsed["project_id"] = data["project_id"]

    if "parent" in data:
        parent = data["parent"]
        # InvokeParent can be a string or a complex object
        if isinstance(parent, str):
            parsed["parent"] = parent
        elif isinstance(parent, dict):
            # Validate it has the right structure
            if "object_type" not in parent or "object_id" not in parent:
                raise ValidationError("parent object must have object_type and object_id")
            parsed["parent"] = parent
        else:
            raise ValidationError("parent must be a string or object")

    if "stream" in data:
        if not isinstance(data["stream"], bool):
            raise ValidationError("stream must be a boolean")
        parsed["stream"] = data["stream"]

    return parsed
