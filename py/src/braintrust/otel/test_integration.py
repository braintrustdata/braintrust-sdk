"""
Unit tests for OTEL + Braintrust context integration using memory exporters.

Tests that OTEL and Braintrust spans are properly grouped in unified traces
when created in mixed contexts.
"""

import time

import pytest

# Check OTEL availability at module level
try:
    import importlib.util
    OTEL_AVAILABLE = importlib.util.find_spec("opentelemetry") is not None
except ImportError:
    OTEL_AVAILABLE = False


@pytest.mark.skipif(not OTEL_AVAILABLE, reason="OpenTelemetry not installed")
class TestOtelBraintrustIntegration:
    """Test OTEL and Braintrust span integration with memory exporters."""

    def setup_method(self):
        """Set up test environment with memory exporters."""
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        import braintrust

        # Set up OTEL with in-memory exporter
        self.otel_memory_exporter = InMemorySpanExporter()
        self.otel_provider = TracerProvider()
        otel_processor = SimpleSpanProcessor(self.otel_memory_exporter)
        self.otel_provider.add_span_processor(otel_processor)
        trace.set_tracer_provider(self.otel_provider)
        self.tracer = trace.get_tracer(__name__)

        # Initialize Braintrust logger for test project
        self.bt_logger = braintrust.init_logger(project="test-otel-integration")

        # Clear any previous spans
        self.otel_memory_exporter.clear()

    def _get_otel_spans(self):
        """Get OTEL spans from memory exporter."""
        spans = []
        for span in self.otel_memory_exporter.get_finished_spans():
            spans.append({
                'name': span.name,
                'span_id': format(span.context.span_id, '016x'),
                'trace_id': format(span.context.trace_id, '032x'),
                'parent_id': format(span.parent.span_id, '016x') if span.parent else None,
            })
        return spans

    def _flush_spans(self):
        """Flush any pending spans."""
        # Flush OTEL spans
        self.otel_provider.force_flush(1000)  # 1 second timeout

        # Small delay to ensure spans are processed
        time.sleep(0.1)

    def test_otel_context_detection(self):
        """Test OTEL context detection functions work correctly."""
        from braintrust.otel.context import get_active_otel_span, get_otel_span_info, should_use_otel_context

        # Test with no active OTEL span
        assert get_active_otel_span() is None
        assert get_otel_span_info() is None
        assert not should_use_otel_context()

        # Test with active OTEL span
        with self.tracer.start_as_current_span("test_context") as span:
            active_span = get_active_otel_span()
            assert active_span is not None
            assert active_span == span

            span_info = get_otel_span_info()
            assert span_info is not None
            assert 'trace_id' in span_info
            assert 'span_id' in span_info
            assert 'otel_span' in span_info

            # Verify format
            assert len(span_info['trace_id']) == 32  # 128-bit hex string
            assert len(span_info['span_id']) == 16   # 64-bit hex string

            assert should_use_otel_context()

    def test_otel_span_creation(self):
        """Test that OTEL spans are created and captured correctly."""
        # Create OTEL spans
        with self.tracer.start_as_current_span("otel_parent") as parent:
            parent_trace_id = format(parent.get_span_context().trace_id, '032x')

            with self.tracer.start_as_current_span("otel_child") as child:
                child_trace_id = format(child.get_span_context().trace_id, '032x')

                # Both spans should have same trace ID
                assert parent_trace_id == child_trace_id

        # Flush and get spans
        self._flush_spans()
        otel_spans = self._get_otel_spans()

        # Verify spans were captured
        assert len(otel_spans) >= 2

        parent_span = next((s for s in otel_spans if s['name'] == 'otel_parent'), None)
        child_span = next((s for s in otel_spans if s['name'] == 'otel_child'), None)

        assert parent_span is not None
        assert child_span is not None

        # Verify same trace ID
        assert parent_span['trace_id'] == child_span['trace_id']

    def test_braintrust_otel_wrapper(self):
        """Test the BraintrustOtelSpanWrapper functionality."""
        from unittest.mock import MagicMock

        from braintrust.otel.context import BraintrustOtelSpanWrapper

        # Mock BT span
        mock_bt_span = MagicMock()
        mock_bt_span.span_id = "12345678-1234-5678-9abc-123456789abc"
        mock_bt_span.root_span_id = "87654321-4321-8765-cba9-210987654321"

        # Create wrapper
        wrapper = BraintrustOtelSpanWrapper(mock_bt_span)

        # Test span context creation
        span_context = wrapper.get_span_context()
        assert span_context is not None

        # Test other wrapper methods
        assert wrapper.is_recording() is True

        # Test method forwarding
        wrapper.add_event("test_event", {"key": "value"})
        wrapper.set_attribute("test_key", "test_value")

    def test_integration_with_real_bt_logger(self):
        """Test integration using real Braintrust logger (but with test project)."""
        # This test verifies the integration works by creating spans and checking
        # that the OTEL context is properly detected and used

        from braintrust.otel.context import get_otel_span_info

        trace_ids_collected = []

        # Create OTEL span with BT span inside
        with self.tracer.start_as_current_span("integration_test") as otel_span:
            otel_trace_id = format(otel_span.get_span_context().trace_id, '032x')
            trace_ids_collected.append(otel_trace_id)

            # Verify OTEL context is detected inside the span
            otel_info = get_otel_span_info()
            assert otel_info is not None
            assert otel_info['trace_id'] == otel_trace_id

            with self.bt_logger.start_span(name="bt_span_in_otel") as bt_span:
                inner_otel_info = get_otel_span_info()
                assert inner_otel_info is not None
                assert inner_otel_info['trace_id'] == otel_trace_id
                assert bt_span.root_span_id == otel_trace_id

        # Flush spans
        self._flush_spans()

        # Verify OTEL spans were created
        otel_spans = self._get_otel_spans()
        integration_span = next((s for s in otel_spans if s['name'] == 'integration_test'), None)
        assert integration_span is not None
        assert integration_span['trace_id'] == otel_trace_id

    def test_mixed_nesting_context_detection(self):
        """Test that OTEL context is properly detected in mixed nesting scenarios."""
        from braintrust.otel.context import get_otel_span_info, should_use_otel_context

        # Start with no OTEL context
        assert not should_use_otel_context()

        with self.tracer.start_as_current_span("outer_otel") as outer:
            outer_trace_id = format(outer.get_span_context().trace_id, '032x')

            # Should detect OTEL context
            assert should_use_otel_context()
            otel_info = get_otel_span_info()
            assert otel_info['trace_id'] == outer_trace_id

            with self.bt_logger.start_span(name="bt_middle") as bt_middle:
                # Still should detect OTEL context
                assert should_use_otel_context()
                otel_info = get_otel_span_info()
                assert otel_info['trace_id'] == outer_trace_id

                with self.tracer.start_as_current_span("inner_otel") as inner:
                    inner_trace_id = format(inner.get_span_context().trace_id, '032x')

                    # Should still be same trace
                    assert inner_trace_id == outer_trace_id

                    # Context detection should work
                    assert should_use_otel_context()
                    otel_info = get_otel_span_info()
                    assert otel_info['trace_id'] == outer_trace_id

                    with self.bt_logger.start_span(name="bt_final") as bt_final:
                        assert should_use_otel_context()
                        final_otel_info = get_otel_span_info()
                        assert final_otel_info['trace_id'] == outer_trace_id
                        assert bt_middle.root_span_id == outer_trace_id
                        assert bt_final.root_span_id == outer_trace_id

        # After exiting all spans, no OTEL context
        assert not should_use_otel_context()

    def test_standalone_bt_spans_no_otel_context(self):
        """Test that standalone BT spans don't interfere with OTEL context detection."""
        from braintrust.otel.context import get_otel_span_info, should_use_otel_context

        # Create standalone BT span
        with self.bt_logger.start_span(name="standalone") as bt_span:
            # Should not have OTEL context
            assert not should_use_otel_context()
            assert get_otel_span_info() is None

        # Create nested BT spans
        with self.bt_logger.start_span(name="bt_outer") as bt_outer:
            assert not should_use_otel_context()

            with self.bt_logger.start_span(name="bt_inner") as bt_inner:
                assert not should_use_otel_context()
                assert get_otel_span_info() is None

    def test_bt_root_otel_child_bt_child_pattern(self):
        """Test BT root → OTEL child → BT child pattern (like the working example)."""
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

        from braintrust.otel import BraintrustSpanProcessor

        # Setup OTEL with BraintrustSpanProcessor (like working example)
        console_processor = BatchSpanProcessor(ConsoleSpanExporter())
        self.otel_provider.add_span_processor(console_processor)

        bt_processor = BraintrustSpanProcessor(parent="project_name:test-bt-root")
        self.otel_provider.add_span_processor(bt_processor)

        # Pattern: BT root → OTEL child → BT child
        with self.bt_logger.start_span(name="bt_root") as bt_root:
            bt_root_span_id = bt_root.root_span_id

            with self.tracer.start_as_current_span("otel_child") as otel_child:
                otel_trace_id = format(otel_child.get_span_context().trace_id, '032x')

                with bt_root.start_span(name="bt_grandchild") as bt_grandchild:
                    # All spans should share the same trace ID
                    assert bt_root.root_span_id == bt_root_span_id
                    assert bt_grandchild.root_span_id == bt_root_span_id
                    # OTEL span should use BT root span ID as trace ID
                    assert otel_trace_id == bt_root_span_id

        self._flush_spans()

    def test_otel_root_bt_child_pattern(self):
        """Test OTEL root → BT child pattern (should also work)."""
        # Pattern: OTEL root → BT child
        with self.tracer.start_as_current_span("otel_root") as otel_root:
            otel_trace_id = format(otel_root.get_span_context().trace_id, '032x')

            with self.bt_logger.start_span(name="bt_child") as bt_child:
                # BT child should use OTEL trace ID as root_span_id
                assert bt_child.root_span_id == otel_trace_id

                # Nested BT span should also use same root
                with bt_child.start_span(name="bt_grandchild") as bt_grandchild:
                    assert bt_grandchild.root_span_id == otel_trace_id

        self._flush_spans()

    def test_mixed_nesting_both_directions(self):
        """Test complex mixed nesting in both directions."""
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

        from braintrust.otel import BraintrustSpanProcessor

        # Setup OTEL with BraintrustSpanProcessor
        console_processor = BatchSpanProcessor(ConsoleSpanExporter())
        self.otel_provider.add_span_processor(console_processor)

        bt_processor = BraintrustSpanProcessor(parent="project_name:test-mixed")
        self.otel_provider.add_span_processor(bt_processor)

        collected_trace_ids = []

        # Pattern 1: BT → OTEL → BT
        with self.bt_logger.start_span(name="bt_outer") as bt_outer:
            bt_trace_id = bt_outer.root_span_id
            collected_trace_ids.append(bt_trace_id)

            with self.tracer.start_as_current_span("otel_middle") as otel_middle:
                otel_trace_id = format(otel_middle.get_span_context().trace_id, '032x')
                collected_trace_ids.append(otel_trace_id)

                with bt_outer.start_span(name="bt_inner1") as bt_inner1:
                    collected_trace_ids.append(bt_inner1.root_span_id)

                    # Pattern 2: OTEL → BT (nested)
                    with self.tracer.start_as_current_span("otel_inner") as otel_inner:
                        otel_inner_trace_id = format(otel_inner.get_span_context().trace_id, '032x')
                        collected_trace_ids.append(otel_inner_trace_id)

                        with self.bt_logger.start_span(name="bt_final") as bt_final:
                            collected_trace_ids.append(bt_final.root_span_id)

        # All trace IDs should be the same (unified trace)
        unique_trace_ids = set(collected_trace_ids)
        assert len(unique_trace_ids) == 1, f"Expected 1 unified trace ID, got {len(unique_trace_ids)}: {unique_trace_ids}"

        self._flush_spans()


@pytest.mark.skipif(OTEL_AVAILABLE, reason="Testing OTEL unavailable case")
class TestOtelUnavailable:
    """Test behavior when OTEL is not available."""

    def test_graceful_degradation(self):
        """Test that BT spans work normally when OTEL is unavailable."""
        from braintrust.otel.context import get_active_otel_span, get_otel_span_info, should_use_otel_context

        # Should return None/False gracefully
        assert get_active_otel_span() is None
        assert get_otel_span_info() is None
        assert not should_use_otel_context()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
