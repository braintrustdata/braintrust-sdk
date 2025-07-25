from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional, TypeVar, Union, cast

from braintrust_core.serializable_data_class import SerializableDataClass
from jsonschema.exceptions import SchemaError, ValidationError
from jsonschema.validators import validate
from referencing.jsonschema import Schema

from braintrust.logger import Prompt
from braintrust.prompt import PromptData, prompt_definition_to_prompt_data
from braintrust.types import PromptDefinitionWithTools
from braintrust.util import get_any


@dataclass
class EvalParameterPrompt(SerializableDataClass):
    type: Literal["prompt"]
    default: Optional[PromptDefinitionWithTools] = None
    description: Optional[str] = None


EvalParameters = Dict[str, Union[EvalParameterPrompt, Any]]

Parameters = TypeVar("Parameters", bound=EvalParameters)


def validate_parameters(parameters: Dict[str, Any], parameters_schema: EvalParameters) -> EvalParameters:
    validated = {}

    for name, schema in parameters_schema.items():
        value = parameters.get(name)
        type_ = get_any(schema, "type")
        if type_ == "prompt":
            prompt_data = None
            if value is not None:
                prompt_data = PromptData.from_dict(value)
            else:
                default = get_any(schema, "default")
                if default:
                    prompt_data = prompt_definition_to_prompt_data(default)

            if prompt_data is None:
                raise ValueError(f"Parameter '{name}' is required")

            validated[name] = Prompt.from_prompt_data(name=name, prompt_data=prompt_data)
        else:
            if value is None and isinstance(schema, dict) and "default" in schema:
                value: Any = schema["default"]

            try:
                validate(value, cast(Schema, schema))
            except SchemaError as e:
                raise ValueError(f"Invalid schema in evaluator: {e}")
            except ValidationError as e:
                raise ValueError(f"Invalid parameter '{name}': {e}")

            validated[name] = value

    return validated
