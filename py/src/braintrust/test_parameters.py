"""Tests for parameters module."""

import json
import pytest
from .parameters import parameters_to_json_schema


def test_parameters_to_json_schema_omits_null_description():
    """Test that description field is omitted when not set (not serialized as null).

    This is important because the frontend Zod schema uses .optional() which
    accepts undefined but rejects null values.

    Regression test for: Remote eval "Not connected" when description is missing
    """
    params = {
        "main": {
            "type": "prompt",
            "name": "Main prompt",
            # description intentionally omitted
            "default": {
                "prompt": {
                    "type": "chat",
                    "messages": [{"role": "user", "content": "{{input}}"}],
                },
                "options": {"model": "gpt-4o"},
            },
        }
    }

    result = parameters_to_json_schema(params)

    # Verify the structure is correct
    assert "main" in result
    assert result["main"]["type"] == "prompt"
    assert "default" in result["main"]

    # Critical: description should NOT be present (not even as None/null)
    assert "description" not in result["main"], \
        "description should be omitted when not set, not serialized as null"

    # Verify it serializes to JSON without null description
    json_str = json.dumps(result)
    assert '"description": null' not in json_str


def test_parameters_to_json_schema_includes_description_when_set():
    """Test that description field is included when explicitly set."""
    params = {
        "main": {
            "type": "prompt",
            "name": "Main prompt",
            "description": "This is the main prompt",
            "default": {
                "prompt": {
                    "type": "chat",
                    "messages": [{"role": "user", "content": "{{input}}"}],
                },
                "options": {"model": "gpt-4o"},
            },
        }
    }

    result = parameters_to_json_schema(params)

    assert result["main"]["description"] == "This is the main prompt"


def test_parameters_to_json_schema_omits_null_default():
    """Test that default field is omitted when not set."""
    params = {
        "main": {
            "type": "prompt",
            "name": "Main prompt",
            # default intentionally omitted
        }
    }

    result = parameters_to_json_schema(params)

    assert "main" in result
    assert result["main"]["type"] == "prompt"
    assert "default" not in result["main"], \
        "default should be omitted when not set, not serialized as null"


def test_parameters_to_json_schema_includes_both_when_set():
    """Test that both description and default are included when set."""
    params = {
        "scoring_prompt": {
            "type": "prompt",
            "name": "Scoring Prompt",
            "description": "The prompt used for scoring",
            "default": {
                "prompt": {
                    "type": "chat",
                    "messages": [
                        {"role": "system", "content": "You are a scorer."},
                        {"role": "user", "content": "Score this: {{input}}"},
                    ],
                },
                "options": {"model": "claude-opus-4-20250514"},
            },
        }
    }

    result = parameters_to_json_schema(params)

    assert result["scoring_prompt"]["type"] == "prompt"
    assert result["scoring_prompt"]["description"] == "The prompt used for scoring"
    assert result["scoring_prompt"]["default"]["prompt"]["type"] == "chat"
