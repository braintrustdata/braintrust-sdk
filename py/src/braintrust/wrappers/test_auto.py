"""Tests for auto-instrumentation.

These tests use subprocess isolation to ensure clean module state.
Module patching tests require isolation because:
1. Python caches imports in sys.modules
2. Patching in one test affects others
3. Import order sensitivity (patch before vs after import)
"""

import pytest
from braintrust.wrappers.test_utils import run_in_subprocess

# Skip all tests in this module if openai is not installed
pytest.importorskip("openai")


class TestAutoInstrument:
    """Tests for auto_instrument()."""

    def test_auto_instrument_returns_dict(self):
        """auto_instrument() should return dict of instrumented libraries."""
        result = run_in_subprocess("""
            from braintrust.auto import auto_instrument

            results = auto_instrument()

            assert isinstance(results, dict)
            assert "openai" in results
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_auto_instrument_patches_openai(self):
        """auto_instrument() should patch OpenAI."""
        result = run_in_subprocess("""
            from braintrust.auto import auto_instrument
            import openai

            results = auto_instrument()

            assert results.get("openai") == True
            assert hasattr(openai, "_braintrust_wrapped")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_auto_instrument_selective_disable(self):
        """auto_instrument(openai=False) should not patch OpenAI."""
        result = run_in_subprocess("""
            from braintrust.auto import auto_instrument
            import openai

            results = auto_instrument(openai=False)

            assert "openai" not in results
            assert not hasattr(openai, "_braintrust_wrapped")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_auto_instrument_idempotent(self):
        """Multiple auto_instrument() calls should be safe."""
        result = run_in_subprocess("""
            from braintrust.auto import auto_instrument
            import openai

            results1 = auto_instrument()
            results2 = auto_instrument()

            assert results1.get("openai") == True
            assert results2.get("openai") == True
            assert hasattr(openai, "_braintrust_wrapped")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout


class TestAutoUninstrument:
    """Tests for auto_uninstrument()."""

    def test_auto_uninstrument_returns_dict(self):
        """auto_uninstrument() should return dict of uninstrumented libraries."""
        result = run_in_subprocess("""
            from braintrust.auto import auto_uninstrument

            results = auto_uninstrument()

            assert isinstance(results, dict)
            assert "openai" in results
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_auto_uninstrument_removes_openai_patch(self):
        """auto_uninstrument() should remove OpenAI patch."""
        result = run_in_subprocess("""
            from braintrust.auto import auto_instrument, auto_uninstrument
            import openai

            original_class = openai.OpenAI

            auto_instrument()
            assert hasattr(openai, "_braintrust_wrapped")

            auto_uninstrument()
            assert not hasattr(openai, "_braintrust_wrapped")
            assert openai.OpenAI is original_class
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_auto_uninstrument_selective(self):
        """auto_uninstrument(openai=False) should not unpatch OpenAI."""
        result = run_in_subprocess("""
            from braintrust.auto import auto_instrument, auto_uninstrument
            import openai

            auto_instrument()
            assert hasattr(openai, "_braintrust_wrapped")

            results = auto_uninstrument(openai=False)
            assert "openai" not in results
            assert hasattr(openai, "_braintrust_wrapped")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout
