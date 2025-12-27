"""
Comprehensive tests for SpanComponents versions V3 and V4.
Tests serialization, deserialization, OTEL compatibility, and backward compatibility.
"""

from uuid import uuid4

import pytest
from braintrust.id_gen import OTELIDGenerator
from braintrust.span_identifier_v3 import SpanComponentsV3, SpanObjectTypeV3
from braintrust.span_identifier_v4 import SpanComponentsV4


class TestSpanComponentsV3:
    """Test SpanComponentsV3 functionality."""

    def test_basic_serialization(self):
        """Test basic V3 serialization/deserialization with UUIDs."""
        components = SpanComponentsV3(
            object_type=SpanObjectTypeV3.PROJECT_LOGS,
            object_id=str(uuid4()),
            row_id=str(uuid4()),
            span_id=str(uuid4()),
            root_span_id=str(uuid4()),
        )

        exported = components.to_str()
        imported = SpanComponentsV3.from_str(exported)

        assert imported.object_type == components.object_type
        assert imported.object_id == components.object_id
        assert imported.row_id == components.row_id
        assert imported.span_id == components.span_id
        assert imported.root_span_id == components.root_span_id

    def test_with_metadata(self):
        """Test V3 with additional metadata."""
        components = SpanComponentsV3(
            object_type=SpanObjectTypeV3.EXPERIMENT,
            object_id=str(uuid4()),
            propagated_event={"key": "value", "nested": {"a": 1}},
        )

        exported = components.to_str()
        imported = SpanComponentsV3.from_str(exported)

        assert imported.object_type == components.object_type
        assert imported.object_id == components.object_id
        assert imported.propagated_event == components.propagated_event

    def test_otel_ids_fail_roundtrip(self):
        """Test that V3 fails to preserve OTEL hex strings for 16-byte IDs (converts to UUID format)."""
        otel_gen = OTELIDGenerator()
        trace_id = otel_gen.get_trace_id()  # 32-char hex (16 bytes)
        span_id = otel_gen.get_span_id()  # 16-char hex (8 bytes)

        # Use 16-byte hex strings for object_id and root_span_id to see UUID conversion
        components = SpanComponentsV3(
            object_type=SpanObjectTypeV3.PROJECT_LOGS,
            object_id=trace_id,  # 16-byte hex should get converted to UUID format
            row_id="test-row-id",
            span_id=span_id,  # 8-byte hex might be preserved
            root_span_id=trace_id,  # 16-byte hex should get converted to UUID format
        )

        exported = components.to_str()
        imported = SpanComponentsV3.from_str(exported)

        # V3 should convert 16-byte hex strings to UUID format (with dashes)
        # Note: span_id (8 bytes) may or may not be converted depending on whether UUID parsing succeeds
        assert imported.root_span_id != trace_id  # 16-byte should have dashes added


class TestSpanComponentsV4:
    """Test SpanComponentsV4 functionality and OTEL compatibility."""

    def test_otel_hex_strings_preserved(self):
        """Test that V4 preserves OTEL hex strings exactly."""
        otel_gen = OTELIDGenerator()
        trace_id = otel_gen.get_trace_id()  # 32-char hex
        span_id = otel_gen.get_span_id()  # 16-char hex

        components = SpanComponentsV4(
            object_type=SpanObjectTypeV3.PROJECT_LOGS,
            object_id="test-project-id",
            row_id="test-row-id",
            span_id=span_id,
            root_span_id=trace_id,
        )

        exported = components.to_str()
        imported = SpanComponentsV4.from_str(exported)

        # V4 should preserve hex strings exactly
        assert imported.span_id == span_id
        assert imported.root_span_id == trace_id
        assert imported.object_type == components.object_type
        assert imported.object_id == components.object_id
        assert imported.row_id == components.row_id

    def test_uuid_strings_stored_in_json(self):
        """Test that V4 stores UUID strings in JSON (not converted to binary)."""
        uuid_object_id = str(uuid4())
        uuid_span_id = str(uuid4())
        uuid_root_span_id = str(uuid4())

        components = SpanComponentsV4(
            object_type=SpanObjectTypeV3.PROJECT_LOGS,
            object_id=uuid_object_id,
            row_id="test-row-id",
            span_id=uuid_span_id,
            root_span_id=uuid_root_span_id,
        )

        exported = components.to_str()
        imported = SpanComponentsV4.from_str(exported)

        # V4 should preserve UUID strings exactly (stored in JSON, not converted)
        assert imported.object_type == components.object_type
        assert imported.object_id == uuid_object_id
        assert imported.row_id == components.row_id
        assert imported.span_id == uuid_span_id
        assert imported.root_span_id == uuid_root_span_id

    def test_mixed_formats(self):
        """Test V4 with mixed UUID and hex string formats."""
        uuid_object_id = str(uuid4())  # UUID format
        otel_gen = OTELIDGenerator()
        hex_span_id = otel_gen.get_span_id()  # Hex format
        hex_trace_id = otel_gen.get_trace_id()  # Hex format

        components = SpanComponentsV4(
            object_type=SpanObjectTypeV3.EXPERIMENT,
            object_id=uuid_object_id,
            row_id="test-row-id",
            span_id=hex_span_id,
            root_span_id=hex_trace_id,
        )

        exported = components.to_str()
        imported = SpanComponentsV4.from_str(exported)

        # V4 preserves all strings exactly as provided (no conversion)
        assert imported.object_id == uuid_object_id
        assert imported.span_id == hex_span_id
        assert imported.root_span_id == hex_trace_id

    def test_parse_interop_with_js_slug(self):
        """Test that Python can parse slug generated by JavaScript."""
        # generated by this code in JS:
        # const components = new SpanComponentsV4({
        #   object_type: SpanObjectTypeV3.EXPERIMENT,
        #   object_id: 'js-test-experiment-id',
        #   row_id: 'js-test-row-id',
        #   span_id: 'abcdef1234567890',
        #   root_span_id: 'fedcba0987654321fedcba0987654321'
        # });
        # console.log(components.toStr());
        js_slug = "BAECA6vN7xI0VniQBP7cugmHZUMh/ty6CYdlQyF7Im9iamVjdF9pZCI6ImpzLXRlc3QtZXhwZXJpbWVudC1pZCIsInJvd19pZCI6ImpzLXRlc3Qtcm93LWlkIn0="

        # Create equivalent Python object
        py_components = SpanComponentsV4(
            object_type=SpanObjectTypeV3.EXPERIMENT,
            object_id="js-test-experiment-id",
            row_id="js-test-row-id",
            span_id="abcdef1234567890",
            root_span_id="fedcba0987654321fedcba0987654321",
        )

        # Python should generate the same slug
        py_serialized = py_components.to_str()
        assert py_serialized == js_slug

        # Python should be able to parse the JS-generated slug
        parsed_from_js = SpanComponentsV4.from_str(js_slug)
        assert parsed_from_js.object_type == py_components.object_type
        assert parsed_from_js.object_id == py_components.object_id
        assert parsed_from_js.row_id == py_components.row_id
        assert parsed_from_js.span_id == py_components.span_id
        assert parsed_from_js.root_span_id == py_components.root_span_id

    def test_with_metadata(self):
        """Test V4 with additional metadata."""
        components = SpanComponentsV4(
            object_type=SpanObjectTypeV3.PLAYGROUND_LOGS,
            object_id="test-session-id",
            propagated_event={"user": "test", "data": [1, 2, 3]},
        )

        exported = components.to_str()
        imported = SpanComponentsV4.from_str(exported)

        assert imported.object_type == components.object_type
        assert imported.object_id == components.object_id
        assert imported.propagated_event == components.propagated_event

    def test_non_serializable_ids_stored_in_json(self):
        """Test that non-UUID/hex strings are stored in JSON portion."""
        components = SpanComponentsV4(
            object_type=SpanObjectTypeV3.PROJECT_LOGS,
            object_id="not-a-uuid-or-hex",  # Will be stored in JSON
            # Don't test row_id alone - if present, span_id and root_span_id must also be present
        )

        exported = components.to_str()
        imported = SpanComponentsV4.from_str(exported)

        assert imported.object_id == "not-a-uuid-or-hex"


class TestBackwardCompatibility:
    """Test backward compatibility between V3 and V4."""

    def test_v4_can_read_v3_data(self):
        """Test that V4 can read data serialized by V3."""
        # Create V3 component
        v3_components = SpanComponentsV3(
            object_type=SpanObjectTypeV3.PROJECT_LOGS,
            object_id=str(uuid4()),
            row_id=str(uuid4()),
            span_id=str(uuid4()),
            root_span_id=str(uuid4()),
            propagated_event={"version": "v3"},
        )

        # Serialize with V3
        v3_exported = v3_components.to_str()

        # Deserialize with V4
        v4_imported = SpanComponentsV4.from_str(v3_exported)

        assert v4_imported.object_type == v3_components.object_type
        assert v4_imported.object_id == v3_components.object_id
        assert v4_imported.row_id == v3_components.row_id
        assert v4_imported.span_id == v3_components.span_id
        assert v4_imported.root_span_id == v3_components.root_span_id
        assert v4_imported.propagated_event == v3_components.propagated_event


class TestErrorHandling:
    """Test error handling and edge cases."""

    def test_invalid_object_type(self):
        """Test that invalid object types raise errors."""
        with pytest.raises(AssertionError):
            SpanComponentsV4(
                object_type="invalid_type",  # Should be SpanObjectTypeV3 enum
                object_id="test-id",
            )

    def test_missing_required_fields(self):
        """Test that missing required fields raise errors."""
        with pytest.raises(AssertionError):
            SpanComponentsV4(
                object_type=SpanObjectTypeV3.PROJECT_LOGS,
                # Missing object_id or compute_object_metadata_args
            )

    def test_partial_span_ids(self):
        """Test that partial span ID fields raise errors."""
        with pytest.raises(AssertionError):
            SpanComponentsV4(
                object_type=SpanObjectTypeV3.PROJECT_LOGS,
                object_id="test-id",
                row_id="test-row",
                # Missing span_id and root_span_id
            )

    def test_invalid_base64(self):
        """Test that invalid base64 strings raise errors."""
        with pytest.raises(Exception) as exc_info:
            SpanComponentsV4.from_str("invalid-base64!")

        assert "not properly encoded" in str(exc_info.value)

    def test_corrupted_data(self):
        """Test that corrupted serialized data raises errors."""
        import base64

        # Create valid data then corrupt it
        components = SpanComponentsV4(object_type=SpanObjectTypeV3.PROJECT_LOGS, object_id="test-id")
        valid_exported = components.to_str()

        # Decode, corrupt, re-encode
        decoded = base64.b64decode(valid_exported)
        corrupted = decoded[:-5] + b"XXXXX"  # Corrupt the end
        corrupted_encoded = base64.b64encode(corrupted).decode()

        with pytest.raises(Exception) as exc_info:
            SpanComponentsV4.from_str(corrupted_encoded)

        assert "not properly encoded" in str(exc_info.value)


class TestObjectIdFields:
    """Test object_id_fields method."""

    def test_experiment_object_id_fields(self):
        """Test object_id_fields for experiment type."""
        components = SpanComponentsV4(object_type=SpanObjectTypeV3.EXPERIMENT, object_id="test-experiment-id")

        fields = components.object_id_fields()
        assert fields == {"experiment_id": "test-experiment-id"}

    def test_project_logs_object_id_fields(self):
        """Test object_id_fields for project_logs type."""
        components = SpanComponentsV4(object_type=SpanObjectTypeV3.PROJECT_LOGS, object_id="test-project-id")

        fields = components.object_id_fields()
        assert fields == {"project_id": "test-project-id", "log_id": "g"}

    def test_playground_logs_object_id_fields(self):
        """Test object_id_fields for playground_logs type."""
        components = SpanComponentsV4(object_type=SpanObjectTypeV3.PLAYGROUND_LOGS, object_id="test-session-id")

        fields = components.object_id_fields()
        assert fields == {"prompt_session_id": "test-session-id", "log_id": "x"}

    def test_object_id_fields_without_object_id(self):
        """Test that object_id_fields raises error without object_id."""
        components = SpanComponentsV4(
            object_type=SpanObjectTypeV3.PROJECT_LOGS, compute_object_metadata_args={"key": "value"}
        )

        with pytest.raises(Exception) as exc_info:
            components.object_id_fields()

        assert "cannot invoke `object_id_fields`" in str(exc_info.value)


class TestExportFormatSelection:
    """Test that span export format is selected based on BRAINTRUST_OTEL_COMPAT environment variable."""

    def test_export_format_based_on_env_variable(self):
        """Test that export format changes based on BRAINTRUST_OTEL_COMPAT environment variable."""
        import os

        from braintrust.test_helpers import init_test_logger

        # Test with OTEL_COMPAT=false (should use V3)
        original_env = os.environ.get("BRAINTRUST_OTEL_COMPAT")
        try:
            os.environ["BRAINTRUST_OTEL_COMPAT"] = "false"

            # Initialize test logger and create a span
            l = init_test_logger("test_export_v3")
            with l.start_span(name="test_span") as span:
                export_v3_mode = span.export()

            # Verify it can be parsed by V3
            parsed_as_v3 = SpanComponentsV3.from_str(export_v3_mode)
            assert parsed_as_v3 is not None

            # Test with OTEL_COMPAT=true (should use V4)
            os.environ["BRAINTRUST_OTEL_COMPAT"] = "true"

            # Initialize test logger and create a span
            l = init_test_logger("test_export_v4")
            with l.start_span(name="test_span") as span:
                export_v4_mode = span.export()

            # Verify it can be parsed by V4
            parsed_as_v4 = SpanComponentsV4.from_str(export_v4_mode)
            assert parsed_as_v4 is not None

            # Both should be parseable by V4 (backward compatibility)
            v4_from_v3 = SpanComponentsV4.from_str(export_v3_mode)
            v4_from_v4 = SpanComponentsV4.from_str(export_v4_mode)
            assert v4_from_v3 is not None
            assert v4_from_v4 is not None

        finally:
            # Clean up environment
            if original_env is not None:
                os.environ["BRAINTRUST_OTEL_COMPAT"] = original_env
            elif "BRAINTRUST_OTEL_COMPAT" in os.environ:
                del os.environ["BRAINTRUST_OTEL_COMPAT"]

    def test_export_uses_v3_by_default(self):
        """Test that export uses V3 format by default when BRAINTRUST_OTEL_COMPAT is not set."""
        import os

        from braintrust.test_helpers import init_test_logger

        # Ensure environment variable is not set
        original_env = os.environ.get("BRAINTRUST_OTEL_COMPAT")
        try:
            if "BRAINTRUST_OTEL_COMPAT" in os.environ:
                del os.environ["BRAINTRUST_OTEL_COMPAT"]

            # Initialize test logger and create a span
            l = init_test_logger("test_default_v3")
            with l.start_span(name="test_span") as span:
                export_default = span.export()

            # Should be parseable by V3 since V3 is the default
            parsed_as_v3 = SpanComponentsV3.from_str(export_default)
            assert parsed_as_v3 is not None
            assert parsed_as_v3.object_type is not None

        finally:
            # Restore environment
            if original_env is not None:
                os.environ["BRAINTRUST_OTEL_COMPAT"] = original_env
