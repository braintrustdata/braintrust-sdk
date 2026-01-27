"""Test auto_instrument for Google GenAI (no uninstrument available)."""

from braintrust.auto import auto_instrument
from braintrust.wrappers.test_utils import autoinstrument_test_context

# 1. Instrument
results = auto_instrument()
assert results.get("google_genai") == True

# 2. Idempotent
results2 = auto_instrument()
assert results2.get("google_genai") == True

# 3. Make API call and verify span
with autoinstrument_test_context("test_auto_google_genai") as memory_logger:
    from google.genai import types
    from google.genai.client import Client

    client = Client()
    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="Say hi",
        config=types.GenerateContentConfig(max_output_tokens=100),
    )
    assert response.text

    spans = memory_logger.pop()
    assert len(spans) == 1, f"Expected 1 span, got {len(spans)}"
    span = spans[0]
    assert "gemini" in span["metadata"]["model"]

print("SUCCESS")
