
import os
import uuid

import pytest

from braintrust import id_gen


@pytest.fixture(autouse=True)
def reset_id_generator_state():
    """Reset ID generator state and environment variables before each test"""
    original_env = os.getenv("BRAINTRUST_OTEL_COMPAT")

    try:
        yield
    finally:
        if "BRAINTRUST_OTEL_COMPAT" in os.environ:
            del os.environ["BRAINTRUST_OTEL_COMPAT"]
        if original_env:
            os.environ["BRAINTRUST_OTEL_COMPAT"] = original_env


def test_uuid_generator():
    """Test that UUIDGenerator implements IDGenerator interface and generates valid UUIDs"""
    # Test interface implementation
    generator = id_gen.UUIDGenerator()

    # Test that UUID generators should share root_span_id for backwards compatibility
    assert generator.share_root_span_id() == True

    for gen_func in [generator.get_span_id, generator.get_trace_id]:
        ids = gen_func(), gen_func()
        assert ids[0] != ids[1]
        assert all(isinstance(id_val, str) for id_val in ids)
        assert all(uuid.UUID(id_val) for id_val in ids)


def test_otel_id_generator():
    generator = id_gen.OTELIDGenerator()

    # Test that OTEL generators should not share root_span_id
    assert generator.share_root_span_id() == False

    # Test ID generation with regular loops
    test_cases = [
        (generator.get_span_id, 16),
        (generator.get_trace_id, 32),
    ]
    for gen_func, expected_length in test_cases:
        id1 = gen_func()
        id2 = gen_func()
        # Test uniqueness, type, length, and hex format
        assert id1 != id2
        assert len(id1) == len(id2) == expected_length
        assert _is_hex(id1)
        assert _is_hex(id2)


def test_environment_variable_default():
    """Test that default behavior uses UUID generator when BRAINTRUST_OTEL_COMPAT is not set"""
    # Ensure environment variable is not set
    if "BRAINTRUST_OTEL_COMPAT" in os.environ:
        del os.environ["BRAINTRUST_OTEL_COMPAT"]

    # Test that we get UUID format IDs by default
    span_id = id_gen.get_span_id()
    trace_id = id_gen.get_trace_id()

    # Should be UUID format (36 characters)
    assert len(span_id) == 36
    assert len(trace_id) == 36
    uuid.UUID(span_id)  # Should not raise exception
    uuid.UUID(trace_id)  # Should not raise exception


def test_environment_variable_otel_false():
    """Test that UUID generator is used when BRAINTRUST_OTEL_COMPAT=false"""
    os.environ["BRAINTRUST_OTEL_COMPAT"] = "false"

    span_id = id_gen.get_span_id()
    trace_id = id_gen.get_trace_id()

    # Should be UUID format (36 characters)
    assert len(span_id) == 36
    assert len(trace_id) == 36
    uuid.UUID(span_id)  # Should not raise exception
    uuid.UUID(trace_id)  # Should not raise exception


def test_environment_variable_otel_true():
    """Test that OTEL generator is used when BRAINTRUST_OTEL_COMPAT=true"""
    os.environ["BRAINTRUST_OTEL_COMPAT"] = "true"

    span_id = id_gen.get_span_id()
    trace_id = id_gen.get_trace_id()

    # Should be OTEL format (16 and 32 hex characters)
    assert len(span_id) == 16
    assert len(trace_id) == 32
    assert _is_hex(span_id)
    assert _is_hex(trace_id)


def _is_hex(s):
    return all(c in '0123456789abcdef' for c in s.lower())
