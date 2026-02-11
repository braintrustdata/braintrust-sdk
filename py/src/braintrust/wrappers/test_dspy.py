"""
Tests for DSPy integration with Braintrust.
"""

import dspy
import pytest
from braintrust import logger
from braintrust.test_helpers import init_test_logger
from braintrust.wrappers.dspy import BraintrustDSpyCallback
from braintrust.wrappers.test_utils import run_in_subprocess, verify_autoinstrument_script

PROJECT_NAME = "test-dspy-app"
MODEL = "openai/gpt-4o-mini"


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


class TestPatchDSPy:
    """Tests for patch_dspy() / unpatch_dspy()."""

    def test_patch_dspy_sets_wrapped_flag(self):
        """patch_dspy() should set __braintrust_wrapped__ on dspy module."""
        result = run_in_subprocess("""
            dspy = __import__("dspy")
            from braintrust.wrappers.dspy import patch_dspy

            assert not hasattr(dspy, "__braintrust_wrapped__")
            patch_dspy()
            assert hasattr(dspy, "__braintrust_wrapped__")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_dspy_wraps_configure(self):
        """After patch_dspy(), dspy.configure() should auto-add BraintrustDSpyCallback."""
        result = run_in_subprocess("""
            from braintrust.wrappers.dspy import patch_dspy, BraintrustDSpyCallback
            patch_dspy()

            import dspy

            # Configure without explicitly adding callback
            dspy.configure(lm=None)

            # Check that BraintrustDSpyCallback was auto-added
            from dspy.dsp.utils.settings import settings
            callbacks = settings.callbacks
            has_bt_callback = any(isinstance(cb, BraintrustDSpyCallback) for cb in callbacks)
            assert has_bt_callback, f"Expected BraintrustDSpyCallback in {callbacks}"
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_dspy_preserves_existing_callbacks(self):
        """patch_dspy() should preserve user-provided callbacks."""
        result = run_in_subprocess("""
            from braintrust.wrappers.dspy import patch_dspy, BraintrustDSpyCallback
            patch_dspy()

            import dspy
            from dspy.utils.callback import BaseCallback

            class MyCallback(BaseCallback):
                pass

            my_callback = MyCallback()
            dspy.configure(lm=None, callbacks=[my_callback])

            from dspy.dsp.utils.settings import settings
            callbacks = settings.callbacks

            # Should have both callbacks
            has_my_callback = any(cb is my_callback for cb in callbacks)
            has_bt_callback = any(isinstance(cb, BraintrustDSpyCallback) for cb in callbacks)

            assert has_my_callback, "User callback should be preserved"
            assert has_bt_callback, "BraintrustDSpyCallback should be added"
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_dspy_does_not_duplicate_callback(self):
        """patch_dspy() should not add duplicate BraintrustDSpyCallback."""
        result = run_in_subprocess("""
            from braintrust.wrappers.dspy import patch_dspy, BraintrustDSpyCallback
            patch_dspy()

            import dspy

            # User explicitly adds BraintrustDSpyCallback
            bt_callback = BraintrustDSpyCallback()
            dspy.configure(lm=None, callbacks=[bt_callback])

            from dspy.dsp.utils.settings import settings
            callbacks = settings.callbacks

            # Should only have one BraintrustDSpyCallback
            bt_callbacks = [cb for cb in callbacks if isinstance(cb, BraintrustDSpyCallback)]
            assert len(bt_callbacks) == 1, f"Expected 1 BraintrustDSpyCallback, got {len(bt_callbacks)}"
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_dspy_idempotent(self):
        """Multiple patch_dspy() calls should be safe."""
        result = run_in_subprocess("""
            from braintrust.wrappers.dspy import patch_dspy
            import dspy

            patch_dspy()
            patch_dspy()  # Second call - should be no-op, not double-wrap

            # Verify configure still works
            lm = dspy.LM("openai/gpt-4o-mini")
            dspy.configure(lm=lm)
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout


class TestAutoInstrumentDSPy:
    """Tests for auto_instrument() with DSPy."""

    def test_auto_instrument_dspy(self):
        """Test auto_instrument patches DSPy, creates spans, and uninstrument works."""
        verify_autoinstrument_script("test_auto_dspy.py")
