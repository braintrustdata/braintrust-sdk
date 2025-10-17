#!/usr/bin/env python3
"""
Example: Distributed Tracing between Braintrust and OpenTelemetry

This example demonstrates how to propagate trace context across service boundaries
using Braintrust span.export() and OpenTelemetry. This enables unified distributed
tracing where a Braintrust span in one service can be the parent of an OTEL span
in another service.

Key concepts:
- Service A creates a Braintrust span and exports the context
- The exported context is passed to Service B (simulated as function call)
- Service B uses context_from_span_export() to create child OTEL spans
- All spans share the same trace_id and maintain proper parent relationships
"""

import os

# Enable OTEL compatibility mode
os.environ['BRAINTRUST_OTEL_COMPAT'] = 'true'

import braintrust
from braintrust.otel import add_braintrust_span_processor, context_from_span_export
from opentelemetry import context as otel_context
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

PROJECT_NAME = "distributed-tracing-demo"


def setup_otel():
    """Setup OTEL instrumentation with Braintrust processor."""
    provider = TracerProvider()
    add_braintrust_span_processor(provider,
                                  parent=f"project_name:different-project")
    trace.set_tracer_provider(provider)
    return trace.get_tracer(__name__, "1.0.0")


def service_b_process_request(exported_context: str, tracer):
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
    finally:
        otel_context.detach(token)


def main():
    print("Distributed Tracing Example: Braintrust → OpenTelemetry\n")
    print("This example simulates a distributed system with 2 services:")
    print("  1. Service A (Braintrust span)")
    print("  2. Service B (OTEL span)\n")

    # Setup
    braintrust.login()
    tracer = setup_otel()
    project = braintrust.init_logger(project=PROJECT_NAME)

    print("=== Service A===")
    with project.start_span(name="service_a.root") as gateway_span:
        trace_id = gateway_span.root_span_id
        span_id = gateway_span.span_id
        print(f"  Created span (trace_id: {trace_id}, span_id: {span_id}) - {gateway_span.link()}")

        # Export context for distributed tracing
        # In a real system, this would be sent as HTTP headers like:
        #   X-Braintrust-Context: <exported_context>
        exported_context = gateway_span.export()
        print(f"\n  → Sending request to Service B with exported context")

        # Call Service B with the exported context
        service_b_process_request(exported_context, tracer)

    # Flush all data
    project.flush()
    if hasattr(trace.get_tracer_provider(), 'force_flush'):
        trace.get_tracer_provider().force_flush(timeout_millis=5000)

    print(f"\n✓ Trace complete! Both services share trace_id: {trace_id}")
    print(f"  View in Braintrust: {gateway_span.link()}")


if __name__ == "__main__":
    main()
