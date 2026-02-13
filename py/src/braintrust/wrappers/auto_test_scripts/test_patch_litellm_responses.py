"""Test that patch_litellm() patches responses."""

import litellm
from braintrust.wrappers.litellm import patch_litellm
from braintrust.wrappers.test_utils import autoinstrument_test_context

patch_litellm()

with autoinstrument_test_context("test_patch_litellm_responses") as memory_logger:
    response = litellm.responses(
        model="gpt-4o-mini",
        input="What's 12 + 12?",
        instructions="Just the number please",
    )
    assert response
    assert response.output
    assert len(response.output) > 0
    content = response.output[0].content[0].text
    assert "24" in content or "twenty-four" in content.lower()

    spans = memory_logger.pop()
    assert len(spans) == 1, f"Expected 1 span, got {len(spans)}"
    span = spans[0]
    assert span["metrics"]
    for key, value in span["metrics"].items():
        assert isinstance(value, (int, float)) and not isinstance(value, bool)
    assert span["metadata"]["model"] == "gpt-4o-mini"
    assert span["metadata"]["provider"] == "litellm"
    assert "What's 12 + 12?" in str(span["input"])

print("SUCCESS")
