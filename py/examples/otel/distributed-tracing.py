#!/usr/bin/env python3
"""
Example: Distributed Tracing between Braintrust and OpenTelemetry

This example demonstrates how to propagate trace context across service boundaries
using Braintrust span.export() and OpenTelemetry. This enables unified distributed
tracing where spans can be parents/children across different services and technologies.

Key concepts:
- Service A (BT) creates a Braintrust span and exports the context
- Service B (OTEL) uses context_from_span_export() to create child OTEL spans
- Service B exports OTEL context as W3C trace headers
- Service C (BT) uses parent_from_headers() to create BT child span
- All spans share the same trace_id and maintain proper parent relationships
"""

import os

# Enable OTEL compatibility mode
os.environ['BRAINTRUST_OTEL_COMPAT'] = 'true'

import braintrust
from braintrust.otel import (
    add_braintrust_span_processor,
    add_span_parent_to_baggage,
    context_from_span_export,
    parent_from_headers,
)
from opentelemetry import context as otel_context
from opentelemetry import trace
from opentelemetry.propagate import inject
from opentelemetry.sdk.trace import TracerProvider

PROJECT_NAME = "distributed-tracing-demo"


def setup_otel():
    """Setup OTEL instrumentation with Braintrust processor."""
    provider = TracerProvider()
    add_braintrust_span_processor(provider,
                                  parent=f"project_name:different-project")
    trace.set_tracer_provider(provider)
    return trace.get_tracer(__name__, "1.0.0")


def service_b_process_request(exported_context: str, tracer, project):
    """
    Service B: Receives exported context from Service A and creates child OTEL spans.

    In a real distributed system, exported_context would be received via HTTP headers,
    message queue metadata, or other inter-service communication mechanisms.
    """
    print("\n=== Service B: User Service ===")

    # Import the context from Service A
    ctx = context_from_span_export(exported_context)

    # Attach the context and create OTEL spans as children
    token = otel_context.attach(ctx)
    try:
        with tracer.start_as_current_span("service_b.root") as fetch_span:
            # Nested operation in Service B
            with tracer.start_as_current_span("service_b.child"):
                trace_id = format(fetch_span.get_span_context().trace_id, '032x')
                print(f"  Created OTEL child spans (trace_id: {trace_id})")


            # Ensure 'braintrust.parent' is set on the baggage.
            add_span_parent_to_baggage(fetch_span)

            # Export OTEL context as W3C trace headers for Service C
            headers = {}
            inject(headers)
            # Call Service C with the headers
            service_c_process_request(headers, project)
    finally:
        otel_context.detach(token)


def service_c_process_request(headers: dict, project):
    """
    Service C: Receives W3C trace headers from Service B and creates child BT span.

    In a real distributed system, headers would be received via HTTP request headers
    or message queue metadata.
    """
    print("\n=== Service C: Analytics Service ===")

    # Extract Braintrust-compatible parent string from W3C trace headers
    parent = parent_from_headers(headers)

    # Create BT span with OTEL parent
    with project.start_span(name="service_c.root", parent=parent) as analytics_span:
        span_id = analytics_span.span_id
        print(f"  Created BT span as child of OTEL parent (span_id: {span_id[:16]}...)")
        analytics_span.log(
            input="Analytics data from Service B",
            output="Processed analytics",
            metadata={"service": "analytics"}
        )


def main():
    print("Distributed Tracing Example: Braintrust → OpenTelemetry → Braintrust\n")
    print("This example simulates a distributed system with 3 services:")
    print("  1. Service A (Braintrust span)")
    print("  2. Service B (OTEL span)")
    print("  3. Service C (Braintrust span)\n")

    # Setup
    braintrust.login()
    tracer = setup_otel()
    project = braintrust.init_logger(project=PROJECT_NAME)

    print("=== Service A ===")
    with project.start_span(name="service_a.root") as gateway_span:
        trace_id = gateway_span.root_span_id
        span_id = gateway_span.span_id
        print(f"  Created span (trace_id: {trace_id[:16]}..., span_id: {span_id[:8]}...)")
        print(f"  Link: {gateway_span.link()}")

        # Export context for distributed tracing
        # In a real system, this would be sent as HTTP headers like:
        #   X-Braintrust-Context: <exported_context>
        exported_context = gateway_span.export()
        print(f"\n  → Sending request to Service B with exported context")

        # Call Service B with the exported context
        service_b_process_request(exported_context, tracer, project)

    # Flush all data
    project.flush()
    if hasattr(trace.get_tracer_provider(), 'force_flush'):
        trace.get_tracer_provider().force_flush(timeout_millis=5000)

    print(f"\n✓ Trace complete! All 3 services share trace_id: {trace_id[:16]}...")
    print(f"  View in Braintrust: {gateway_span.link()}")


if __name__ == "__main__":
    main()
