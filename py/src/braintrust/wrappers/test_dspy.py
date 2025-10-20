"""
Tests for DSPy integration with Braintrust.
"""

import dspy
import pytest

from braintrust import logger
from braintrust.test_helpers import init_test_logger
from braintrust.wrappers.dspy import BraintrustDSpyCallback

PROJECT_NAME = "test-dspy-app"
MODEL = "openai/gpt-4o-mini"


@pytest.fixture(scope="module")
def vcr_config():
    return {
        "filter_headers": [
            "authorization",
            "x-api-key",
            "openai-api-key",
        ]
    }


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


@pytest.mark.vcr
def test_dspy_callback(memory_logger):
    """Test DSPy callback logs spans correctly."""
    assert not memory_logger.pop()

    # Configure DSPy with Braintrust callback
    lm = dspy.LM(MODEL)
    dspy.configure(lm=lm, callbacks=[BraintrustDSpyCallback()])

    # Use ChainOfThought for a more interesting test
    cot = dspy.ChainOfThought("question -> answer")
    result = cot(question="What is 2+2?")

    assert result.answer  # Verify we got a response

    # Check logged spans
    spans = memory_logger.pop()
    assert len(spans) >= 2  # Should have module span and LM span

    # Find LM span by checking span_attributes
    lm_spans = [s for s in spans if s.get("span_attributes", {}).get("name") == "dspy.lm"]
    assert len(lm_spans) >= 1

    lm_span = lm_spans[0]
    # Verify metadata
    assert "metadata" in lm_span
    assert "model" in lm_span["metadata"]
    assert MODEL in lm_span["metadata"]["model"]

    # Verify input/output
    assert "input" in lm_span
    assert "output" in lm_span

    # Find module span
    module_spans = [s for s in spans if "module" in s.get("span_attributes", {}).get("name", "")]
    assert len(module_spans) >= 1

    # Verify span parenting (LM span should have parent)
    assert lm_span.get("span_parents")  # LM span should have parent
