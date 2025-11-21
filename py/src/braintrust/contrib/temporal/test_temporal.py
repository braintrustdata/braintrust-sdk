"""Unit tests for Braintrust Temporal interceptor."""

from typing import Any, Dict

import pytest

pytest.importorskip("temporalio")

import temporalio.api.common.v1
import temporalio.converter
from braintrust.contrib.temporal import BraintrustInterceptor


class TestHeaderSerialization:
    """Unit tests for header serialization/deserialization."""

    def test_span_context_to_headers_with_valid_context(self):
        interceptor = BraintrustInterceptor()
        span_context = {"trace_id": "test-trace-id", "span_id": "test-span-id"}
        headers: Dict[str, temporalio.api.common.v1.Payload] = {}

        result_headers = interceptor._span_context_to_headers(span_context, headers)

        assert "_braintrust-span" in result_headers
        assert len(result_headers) == 1

    def test_span_context_to_headers_with_empty_context(self):
        interceptor = BraintrustInterceptor()
        span_context: Dict[str, Any] = {}
        headers: Dict[str, temporalio.api.common.v1.Payload] = {}

        result_headers = interceptor._span_context_to_headers(span_context, headers)

        assert "_braintrust-span" not in result_headers
        assert len(result_headers) == 0

    def test_span_context_to_headers_preserves_existing_headers(self):
        interceptor = BraintrustInterceptor()
        span_context = {"trace_id": "test-trace-id"}

        # Create a payload for existing header
        existing_payload = interceptor.payload_converter.to_payloads(["existing_value"])[0]
        headers = {"existing_header": existing_payload}

        result_headers = interceptor._span_context_to_headers(span_context, headers)

        assert "existing_header" in result_headers
        assert "_braintrust-span" in result_headers
        assert len(result_headers) == 2

    def test_span_context_from_headers_with_valid_header(self):
        interceptor = BraintrustInterceptor()
        span_context = {"trace_id": "test-trace-id", "span_id": "test-span-id"}

        # Serialize span context to header
        payloads = interceptor.payload_converter.to_payloads([span_context])
        headers = {"_braintrust-span": payloads[0]}

        result = interceptor._span_context_from_headers(headers)

        assert result is not None
        assert result["trace_id"] == "test-trace-id"
        assert result["span_id"] == "test-span-id"

    def test_span_context_from_headers_with_missing_header(self):
        interceptor = BraintrustInterceptor()
        headers: Dict[str, temporalio.api.common.v1.Payload] = {}

        result = interceptor._span_context_from_headers(headers)

        assert result is None

    def test_span_context_roundtrip(self):
        interceptor = BraintrustInterceptor()
        original_context = {
            "trace_id": "test-trace-id",
            "span_id": "test-span-id",
            "root_span_id": "test-root-span-id",
        }

        # Serialize
        headers = interceptor._span_context_to_headers(original_context, {})

        # Deserialize
        result_context = interceptor._span_context_from_headers(headers)

        assert result_context == original_context
