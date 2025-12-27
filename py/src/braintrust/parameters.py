"""Evaluation parameters support for Python SDK."""

from typing import Any, TypedDict

from typing_extensions import NotRequired

from .logger import Prompt
from .prompt import PromptData


class PromptParameter(TypedDict):
    """A prompt parameter specification."""

    type: str  # Literal["prompt"] but using str for flexibility
    default: NotRequired[PromptData | None]
    description: NotRequired[str | None]


# EvalParameters is a dict where values can be either:
# - A PromptParameter (dict with type="prompt")
# - A pydantic model class (typed as Any for now)
EvalParameters = dict[str, PromptParameter | Any]


def _pydantic_to_json_schema(model: Any) -> dict[str, Any]:
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
    parameters: dict[str, Any],
    parameter_schema: EvalParameters,
) -> dict[str, Any]:
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
                prompt_data = None
                if value is not None:
                    # TODO: Validate that value is a valid PromptData
                    prompt_data = value
                elif schema.get("default") is not None:
                    prompt_data = schema["default"]
                else:
                    raise ValueError(f"Parameter '{name}' is required")
                result[name] = Prompt.from_prompt_data(schema.get("name"), PromptData.from_dict_deep(prompt_data))
            elif schema is None:
                # No schema defined, pass through the value
                result[name] = value
            else:
                # Check if it's a pydantic model
                if hasattr(schema, "parse_obj") or hasattr(schema, "model_validate"):
                    # Check if this is a single-field validator model
                    # Support both Pydantic v1 (__fields__) and v2 (model_fields)
                    fields = getattr(schema, "__fields__", None) or getattr(schema, "model_fields", {})
                    if len(fields) == 1 and "value" in fields:
                        # This is a single-field validator, validate the value directly
                        if value is None:
                            # Try to get default value
                            try:
                                if hasattr(schema, "__call__"):
                                    default_instance = schema()
                                    result[name] = default_instance.value
                                else:
                                    raise ValueError(f"Parameter '{name}' is required")
                            except Exception:
                                raise ValueError(f"Parameter '{name}' is required")
                        else:
                            # Validate by creating a model instance with the value
                            if hasattr(schema, "parse_obj"):
                                validated = schema.parse_obj({"value": value})
                            else:
                                validated = schema.model_validate({"value": value})
                            result[name] = validated.value
                    else:
                        # Regular pydantic model
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


def parameters_to_json_schema(parameters: EvalParameters) -> dict[str, Any]:
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
