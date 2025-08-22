import pytest
from braintrust_adk import setup_braintrust
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor

from tests.helpers import (
    force_tracer_provider,
    run_weather_agent,
)


@pytest.mark.vcr()
@pytest.mark.asyncio
async def test_unset_provider():
    assert isinstance(trace.get_tracer_provider(), trace.ProxyTracerProvider)

    force_tracer_provider(TracerProvider())

    setup_result = setup_braintrust(SpanProcessor=SimpleSpanProcessor)
    assert setup_result, "setup_braintrust() should succeed"

    assert isinstance(trace.get_tracer_provider(), trace.TracerProvider)

    result = await run_weather_agent()
    assert result is not None, "Weather agent should produce a result"


@pytest.mark.vcr()
@pytest.mark.asyncio
async def test_set_provider():
    assert isinstance(trace.get_tracer_provider(), trace.ProxyTracerProvider)

    force_tracer_provider(TracerProvider())

    setup_result = setup_braintrust(SpanProcessor=SimpleSpanProcessor)
    assert setup_result, "setup_braintrust() should succeed"

    assert isinstance(trace.get_tracer_provider(), TracerProvider)

    result = await run_weather_agent()
    assert result is not None, "Weather agent should produce a result"
