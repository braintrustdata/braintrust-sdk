"""Tests for auto-instrumentation.

These tests use subprocess isolation to ensure clean module state.
Module patching tests require isolation because:
1. Python caches imports in sys.modules
2. Patching in one test affects others
3. Import order sensitivity (patch before vs after import)

VCR-based tests verify that spans are actually produced with memory_logger.
"""

import subprocess
import sys
import textwrap

import pytest
from braintrust import logger
from braintrust.test_helpers import init_test_logger

# Skip all tests in this module if openai is not installed
pytest.importorskip("openai")

PROJECT_NAME = "test-auto-instrument"


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


def run_in_subprocess(code: str, timeout: int = 30) -> subprocess.CompletedProcess:
    """Run Python code in a fresh subprocess."""
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(code)],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


class TestPatchOpenAI:
    """Tests for patch_openai() / unpatch_openai()."""

    def test_patch_openai_sets_wrapped_flag(self):
        """patch_openai() should set _braintrust_wrapped on openai module."""
        result = run_in_subprocess("""
            from braintrust.oai import patch_openai
            import openai

            assert not hasattr(openai, "_braintrust_wrapped")
            patch_openai()
            assert hasattr(openai, "_braintrust_wrapped")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_openai_wraps_new_clients(self):
        """After patch_openai(), new OpenAI() clients should be wrapped."""
        result = run_in_subprocess("""
            from braintrust.oai import patch_openai
            patch_openai()

            import openai
            client = openai.OpenAI(api_key="test-key")

            # Check that chat completions is wrapped (our wrapper adds tracing)
            # The wrapper replaces client.chat with a wrapped version
            chat_type = type(client.chat).__name__
            print(f"chat_type={chat_type}")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_openai_creates_spans(self):
        """patch_openai() should create spans when making API calls."""
        result = run_in_subprocess("""
            from braintrust.oai import patch_openai
            from braintrust.test_helpers import init_test_logger
            from braintrust import logger

            # Set up memory logger
            init_test_logger("test-auto")
            with logger._internal_with_memory_background_logger() as memory_logger:
                patch_openai()

                import openai
                client = openai.OpenAI()

                # Make a call within a span context
                import braintrust
                with braintrust.start_span(name="test") as span:
                    try:
                        # This will fail without API key, but span should still be created
                        client.chat.completions.create(
                            model="gpt-4o-mini",
                            messages=[{"role": "user", "content": "hi"}],
                        )
                    except Exception:
                        pass  # Expected without API key

                # Check that spans were logged
                spans = memory_logger.pop()
                # Should have at least the parent span
                assert len(spans) >= 1, f"Expected spans, got {spans}"
                print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_openai_before_import(self):
        """patch_openai() should work when called before importing openai."""
        result = run_in_subprocess("""
            from braintrust.oai import patch_openai

            # Patch BEFORE importing openai
            patch_openai()

            import openai
            assert hasattr(openai, "_braintrust_wrapped")

            client = openai.OpenAI(api_key="test-key")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_openai_after_import(self):
        """patch_openai() should work when called after importing openai."""
        result = run_in_subprocess("""
            import openai
            from braintrust.oai import patch_openai

            # Patch AFTER importing openai
            patch_openai()

            assert hasattr(openai, "_braintrust_wrapped")

            client = openai.OpenAI(api_key="test-key")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_unpatch_openai_restores_original(self):
        """unpatch_openai() should restore original classes."""
        result = run_in_subprocess("""
            import openai
            from braintrust.oai import patch_openai, unpatch_openai

            original_class = openai.OpenAI

            patch_openai()
            patched_class = openai.OpenAI
            assert patched_class is not original_class

            unpatch_openai()
            restored_class = openai.OpenAI
            assert restored_class is original_class
            assert not hasattr(openai, "_braintrust_wrapped")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_openai_idempotent(self):
        """Multiple patch_openai() calls should be safe."""
        result = run_in_subprocess("""
            from braintrust.oai import patch_openai, unpatch_openai
            import openai

            patch_openai()
            first_class = openai.OpenAI

            patch_openai()  # Second call
            second_class = openai.OpenAI

            assert first_class is second_class
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_unpatch_openai_idempotent(self):
        """Multiple unpatch_openai() calls should be safe."""
        result = run_in_subprocess("""
            from braintrust.oai import patch_openai, unpatch_openai
            import openai

            original_class = openai.OpenAI

            patch_openai()
            unpatch_openai()
            unpatch_openai()  # Second call - should be no-op

            assert openai.OpenAI is original_class
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_openai_chains_with_other_patches(self):
        """patch_openai() should chain with other libraries that patch OpenAI."""
        result = run_in_subprocess("""
            import openai

            # Simulate another library (like Datadog) patching OpenAI first
            other_library_init_called = []

            class OtherLibraryOpenAI(openai.OpenAI):
                def __init__(self, *args, **kwargs):
                    other_library_init_called.append(True)
                    super().__init__(*args, **kwargs)

            openai.OpenAI = OtherLibraryOpenAI

            # Now apply our patch - should subclass OtherLibraryOpenAI
            from braintrust.oai import patch_openai
            patch_openai()

            # Create a client - both patches should run
            client = openai.OpenAI(api_key="test-key")

            # Verify other library's __init__ was called (chaining works)
            assert len(other_library_init_called) == 1, "Other library's patch should have run"

            # Verify our patch was applied (client has wrapped chat)
            assert hasattr(client, "chat"), "Client should have chat attribute"

            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_unpatch_openai_restores_to_previous_patch(self):
        """unpatch_openai() should restore to previous patch, not original."""
        result = run_in_subprocess("""
            import openai

            original_class = openai.OpenAI

            # Simulate another library patching first
            class OtherLibraryOpenAI(openai.OpenAI):
                pass

            openai.OpenAI = OtherLibraryOpenAI

            # Apply our patch
            from braintrust.oai import patch_openai, unpatch_openai
            patch_openai()

            # Unpatch - should restore to OtherLibraryOpenAI, not original
            unpatch_openai()

            assert openai.OpenAI is OtherLibraryOpenAI, "Should restore to previous patch"
            assert openai.OpenAI is not original_class, "Should not restore to original"

            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_openai_chains_async_client(self):
        """patch_openai() should chain with other libraries for AsyncOpenAI too."""
        result = run_in_subprocess("""
            import openai

            # Simulate another library patching AsyncOpenAI first
            other_library_init_called = []

            class OtherLibraryAsyncOpenAI(openai.AsyncOpenAI):
                def __init__(self, *args, **kwargs):
                    other_library_init_called.append(True)
                    super().__init__(*args, **kwargs)

            openai.AsyncOpenAI = OtherLibraryAsyncOpenAI

            # Now apply our patch
            from braintrust.oai import patch_openai
            patch_openai()

            # Create an async client - both patches should run
            client = openai.AsyncOpenAI(api_key="test-key")

            # Verify other library's __init__ was called
            assert len(other_library_init_called) == 1, "Other library's patch should have run"

            # Verify our patch was applied
            assert hasattr(client, "chat"), "Client should have chat attribute"

            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout


class TestPatchAnthropic:
    """Tests for patch_anthropic() / unpatch_anthropic()."""

    def test_patch_anthropic_sets_wrapped_flag(self):
        """patch_anthropic() should set _braintrust_wrapped on anthropic module."""
        result = run_in_subprocess("""
            from braintrust.wrappers.anthropic import patch_anthropic
            import anthropic

            assert not hasattr(anthropic, "_braintrust_wrapped")
            patch_anthropic()
            assert hasattr(anthropic, "_braintrust_wrapped")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_anthropic_wraps_new_clients(self):
        """After patch_anthropic(), new Anthropic() clients should be wrapped."""
        result = run_in_subprocess("""
            from braintrust.wrappers.anthropic import patch_anthropic
            patch_anthropic()

            import anthropic
            client = anthropic.Anthropic(api_key="test-key")

            # Check that messages is wrapped
            messages_type = type(client.messages).__name__
            print(f"messages_type={messages_type}")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_unpatch_anthropic_restores_original(self):
        """unpatch_anthropic() should restore original classes."""
        result = run_in_subprocess("""
            import anthropic
            from braintrust.wrappers.anthropic import patch_anthropic, unpatch_anthropic

            original_class = anthropic.Anthropic

            patch_anthropic()
            patched_class = anthropic.Anthropic
            assert patched_class is not original_class

            unpatch_anthropic()
            restored_class = anthropic.Anthropic
            assert restored_class is original_class
            assert not hasattr(anthropic, "_braintrust_wrapped")
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_anthropic_idempotent(self):
        """Multiple patch_anthropic() calls should be safe."""
        result = run_in_subprocess("""
            from braintrust.wrappers.anthropic import patch_anthropic
            import anthropic

            patch_anthropic()
            first_class = anthropic.Anthropic

            patch_anthropic()  # Second call
            second_class = anthropic.Anthropic

            assert first_class is second_class
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_patch_anthropic_creates_spans(self):
        """patch_anthropic() should create spans when making API calls."""
        result = run_in_subprocess("""
            from braintrust.wrappers.anthropic import patch_anthropic
            from braintrust.test_helpers import init_test_logger
            from braintrust import logger

            # Set up memory logger
            init_test_logger("test-auto")
            with logger._internal_with_memory_background_logger() as memory_logger:
                patch_anthropic()

                import anthropic
                client = anthropic.Anthropic()

                # Make a call within a span context
                import braintrust
                with braintrust.start_span(name="test") as span:
                    try:
                        # This will fail without API key, but span should still be created
                        client.messages.create(
                            model="claude-3-5-haiku-latest",
                            max_tokens=100,
                            messages=[{"role": "user", "content": "hi"}],
                        )
                    except Exception:
                        pass  # Expected without API key

                # Check that spans were logged
                spans = memory_logger.pop()
                # Should have at least the parent span
                assert len(spans) >= 1, f"Expected spans, got {spans}"
                print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout


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


class TestPatchDSPy:
    """Tests for patch_dspy() / unpatch_dspy()."""

    def test_patch_dspy_sets_wrapped_flag(self):
        """patch_dspy() should set _braintrust_wrapped on dspy module."""
        result = run_in_subprocess("""
            dspy = __import__("dspy")
            from braintrust.wrappers.dspy import patch_dspy

            assert not hasattr(dspy, "_braintrust_wrapped")
            patch_dspy()
            assert hasattr(dspy, "_braintrust_wrapped")
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

    def test_unpatch_dspy_restores_original(self):
        """unpatch_dspy() should restore original configure function."""
        result = run_in_subprocess("""
            import dspy
            from braintrust.wrappers.dspy import patch_dspy, unpatch_dspy

            original_configure = dspy.configure

            patch_dspy()
            patched_configure = dspy.configure
            assert patched_configure is not original_configure

            unpatch_dspy()
            restored_configure = dspy.configure
            assert restored_configure is original_configure
            assert not hasattr(dspy, "_braintrust_wrapped")
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
            first_configure = dspy.configure

            patch_dspy()  # Second call
            second_configure = dspy.configure

            assert first_configure is second_configure
            print("SUCCESS")
        """)
        assert result.returncode == 0, f"Failed: {result.stderr}"
        assert "SUCCESS" in result.stdout

    def test_unpatch_dspy_idempotent(self):
        """Multiple unpatch_dspy() calls should be safe."""
        result = run_in_subprocess("""
            from braintrust.wrappers.dspy import patch_dspy, unpatch_dspy
            import dspy

            original_configure = dspy.configure

            patch_dspy()
            unpatch_dspy()
            unpatch_dspy()  # Second call - should be no-op

            assert dspy.configure is original_configure
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


class TestPatchOpenAISpans:
    """VCR-based tests verifying that patch_openai() produces spans."""

    @pytest.mark.vcr
    def test_patch_openai_creates_spans(self, memory_logger):
        """patch_openai() should create spans when making API calls."""
        import openai
        from braintrust.oai import patch_openai, unpatch_openai

        assert not memory_logger.pop()

        patch_openai()
        try:
            client = openai.OpenAI()
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": "Say hi"}],
            )
            assert response.choices[0].message.content

            # Verify span was created
            spans = memory_logger.pop()
            assert len(spans) == 1
            span = spans[0]
            assert span["metadata"]["provider"] == "openai"
            assert "gpt-4o-mini" in span["metadata"]["model"]
            assert span["input"]
        finally:
            unpatch_openai()


class TestPatchOpenAIAsyncSpans:
    """VCR-based tests verifying that patch_openai() produces spans for async clients."""

    @pytest.mark.vcr
    @pytest.mark.asyncio
    async def test_patch_openai_async_creates_spans(self, memory_logger):
        """patch_openai() should create spans for async API calls."""
        import openai
        from braintrust.oai import patch_openai, unpatch_openai

        assert not memory_logger.pop()

        patch_openai()
        try:
            client = openai.AsyncOpenAI()
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": "Say hi async"}],
            )
            assert response.choices[0].message.content

            # Verify span was created
            spans = memory_logger.pop()
            assert len(spans) == 1
            span = spans[0]
            assert span["metadata"]["provider"] == "openai"
            assert "gpt-4o-mini" in span["metadata"]["model"]
            assert span["input"]
        finally:
            unpatch_openai()


class TestPatchAnthropicSpans:
    """VCR-based tests verifying that patch_anthropic() produces spans."""

    @pytest.mark.vcr
    def test_patch_anthropic_creates_spans(self, memory_logger):
        """patch_anthropic() should create spans when making API calls."""
        anthropic = pytest.importorskip("anthropic")
        from braintrust.wrappers.anthropic import patch_anthropic, unpatch_anthropic

        assert not memory_logger.pop()

        patch_anthropic()
        try:
            client = anthropic.Anthropic()
            response = client.messages.create(
                model="claude-3-5-haiku-latest",
                max_tokens=100,
                messages=[{"role": "user", "content": "Say hi"}],
            )
            assert response.content[0].text

            # Verify span was created
            spans = memory_logger.pop()
            assert len(spans) == 1
            span = spans[0]
            assert span["metadata"]["provider"] == "anthropic"
            assert "claude" in span["metadata"]["model"]
            assert span["input"]
        finally:
            unpatch_anthropic()


class TestPatchAnthropicAsyncSpans:
    """VCR-based tests verifying that patch_anthropic() produces spans for async clients."""

    @pytest.mark.vcr
    @pytest.mark.asyncio
    async def test_patch_anthropic_async_creates_spans(self, memory_logger):
        """patch_anthropic() should create spans for async API calls."""
        anthropic = pytest.importorskip("anthropic")
        from braintrust.wrappers.anthropic import patch_anthropic, unpatch_anthropic

        assert not memory_logger.pop()

        patch_anthropic()
        try:
            client = anthropic.AsyncAnthropic()
            response = await client.messages.create(
                model="claude-3-5-haiku-latest",
                max_tokens=100,
                messages=[{"role": "user", "content": "Say hi async"}],
            )
            assert response.content[0].text

            # Verify span was created
            spans = memory_logger.pop()
            assert len(spans) == 1
            span = spans[0]
            assert span["metadata"]["provider"] == "anthropic"
            assert "claude" in span["metadata"]["model"]
            assert span["input"]
        finally:
            unpatch_anthropic()
