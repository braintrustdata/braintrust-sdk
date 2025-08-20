"""Evaluation parameters support for Python SDK."""

from typing import Any, Dict, Optional, TypedDict, Union

from typing_extensions import NotRequired

from .prompt import PromptData


class PromptParameter(TypedDict):
    """A prompt parameter specification."""

    type: str  # Literal["prompt"] but using str for flexibility
    default: NotRequired[Optional[PromptData]]
    description: NotRequired[Optional[str]]


# EvalParameters is a dict where values can be either:
# - A PromptParameter (dict with type="prompt")
# - A pydantic model class (typed as Any for now)
EvalParameters = Dict[str, Union[PromptParameter, Any]]


def _pydantic_to_json_schema(model: Any) -> Dict[str, Any]:
    """Convert a pydantic model to JSON schema."""
    if hasattr(model, "model_json_schema"):
        # pydantic 2
        return model.model_json_schema()
    elif hasattr(model, "schema"):
        # pydantic 1
        return model.schema()
    else:
        raise ValueError(f"Cannot convert {model} to JSON schema - not a pydantic model")


def validate_parameters(
    parameters: Dict[str, Any],
    parameter_schema: EvalParameters,
) -> Dict[str, Any]:
    """
    Validate parameters against the schema.

    Args:
        parameters: The parameters to validate
        parameter_schema: The schema to validate against

    Returns:
        Validated parameters

    Raises:
        ValueError: If validation fails
    """
    result = {}

    for name, schema in parameter_schema.items():
        value = parameters.get(name)

        try:
            if isinstance(schema, dict) and schema.get("type") == "prompt":
                # Handle prompt parameter
                if value is not None:
                    # TODO: Validate that value is a valid PromptData
                    result[name] = value
                elif schema.get("default") is not None:
                    result[name] = schema["default"]
                else:
                    raise ValueError(f"Parameter '{name}' is required")
            else:
                # Assume it's a pydantic model
                if value is None:
                    # No value provided, try to create default instance
                    if hasattr(schema, "__call__"):
                        result[name] = schema()
                    else:
                        raise ValueError(f"Parameter '{name}' is required")
                elif hasattr(schema, "parse_obj"):
                    # pydantic v1
                    result[name] = schema.parse_obj(value)
                elif hasattr(schema, "model_validate"):
                    # pydantic v2
                    result[name] = schema.model_validate(value)
                else:
                    # Not a pydantic model, just pass through
                    result[name] = value

        except Exception as e:
            raise ValueError(f"Invalid parameter '{name}': {str(e)}")

    return result


def parameters_to_json_schema(parameters: EvalParameters) -> Dict[str, Any]:
    """
    Convert EvalParameters to JSON schema format for serialization.

    Args:
        parameters: The parameters to convert

    Returns:
        JSON schema representation
    """
    result = {}

    for name, schema in parameters.items():
        if isinstance(schema, dict) and schema.get("type") == "prompt":
            # Prompt parameter
            result[name] = {
                "type": "prompt",
                "default": schema.get("default"),
                "description": schema.get("description"),
            }
        else:
            # Pydantic model
            try:
                result[name] = {
                    "type": "data",
                    "schema": _pydantic_to_json_schema(schema),
                    # TODO: Extract default and description from pydantic model
                }
            except ValueError:
                # Not a pydantic model, skip
                pass

    return result
