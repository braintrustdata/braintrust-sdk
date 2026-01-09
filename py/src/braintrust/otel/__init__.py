import logging
import os
import warnings
from urllib.parse import urljoin

INSTALL_ERR_MSG = (
    "OpenTelemetry packages are not installed. "
    "Install optional OpenTelemetry dependencies with: pip install braintrust[otel]"
)

try:
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    OTEL_AVAILABLE = True
except ImportError:
    # Don't warn in tests, it's annoying.
    if not os.environ.get("PYTEST_VERSION"):
        warnings.warn(
            INSTALL_ERR_MSG,
            UserWarning,
            stacklevel=2,
        )

    # Create stub classes if OpenTelemetry is not available
    class OTLPSpanExporter:
        def __init__(self, *args, **kwargs):
            raise ImportError(INSTALL_ERR_MSG)

    class BatchSpanProcessor:
        def __init__(self, *args, **kwargs):
            raise ImportError(INSTALL_ERR_MSG)

    class trace:
        @staticmethod
        def get_tracer_provider():
            raise ImportError(INSTALL_ERR_MSG)

    OTEL_AVAILABLE = False


FILTER_PREFIXES = ("gen_ai.", "braintrust.", "llm.", "ai.", "traceloop.")


class AISpanProcessor:
    """
    A span processor that filters spans to only export filtered telemetry.

    Only filtered spans and root spans will be forwarded to the inner processor.
    This dramatically reduces telemetry volume while preserving important observability.

    Example:
        > processor = AISpanProcessor(BatchSpanProcessor(OTLPSpanExporter()))
        > provider = TracerProvider()
        > provider.add_span_processor(processor)
    """

    def __init__(self, processor, custom_filter=None):
        """
        Initialize the filter span processor.

        Args:
            processor: The wrapped span processor that will receive filtered spans
                      (e.g., BatchSpanProcessor, SimpleSpanProcessor)
            custom_filter: Optional callable that takes a span and returns:
                          True to keep, False to drop,
                          None to not influence the decision
        """
        self._processor = processor
        self._custom_filter = custom_filter

    def on_start(self, span, parent_context=None):
        """Forward span start events to the inner processor."""
        self._processor.on_start(span, parent_context)

    def on_end(self, span):
        """Apply filtering logic and conditionally forward span end events."""
        if self._should_keep_filtered_span(span):
            self._processor.on_end(span)

    def shutdown(self):
        """Shutdown the inner processor."""
        self._processor.shutdown()

    def force_flush(self, timeout_millis=30000):
        """Force flush the inner processor."""
        return self._processor.force_flush(timeout_millis)

    def _should_keep_filtered_span(self, span):
        """
        Keep spans if:
        1. Custom filter returns True/False (if provided)
        2. Span name starts with 'gen_ai.', 'braintrust.', 'llm.', 'ai.', or 'traceloop.'
        3. Any attribute name starts with those prefixes
        """
        if not span:
            return False

        # Apply custom filter if provided
        if self._custom_filter:
            custom_result = self._custom_filter(span)
            if custom_result is True:
                return True
            elif custom_result is False:
                return False
            # custom_result is None - continue with default logic

        if span.name.startswith(FILTER_PREFIXES):
            return True

        if span.attributes:
            for attr_name in span.attributes.keys():
                if attr_name.startswith(FILTER_PREFIXES):
                    return True

        return False


class OtelExporter(OTLPSpanExporter):
    """
    A subclass of OTLPSpanExporter configured for Braintrust.

    For most use cases, consider using the Processor class instead, which provides
    a more convenient all-in-one interface.

    Environment Variables:
    - BRAINTRUST_API_KEY: Your Braintrust API key.
    - BRAINTRUST_PARENT: Parent identifier (e.g., "project_name:test").
    - BRAINTRUST_API_URL: Base URL for Braintrust API (defaults to https://api.braintrust.dev).
    """

    def __init__(
        self,
        url: str | None = None,
        api_key: str | None = None,
        parent: str | None = None,
        headers: dict[str, str] | None = None,
        **kwargs,
    ):
        """
        Initialize the OtelExporter.

        Args:
            url: OTLP endpoint URL. Defaults to {BRAINTRUST_API_URL}/otel/v1/traces.
            api_key: Braintrust API key. Defaults to BRAINTRUST_API_KEY env var.
            parent: Parent identifier (e.g., "project_name:test"). Defaults to BRAINTRUST_PARENT env var.
            headers: Additional headers to include in requests.
            **kwargs: Additional arguments passed to OTLPSpanExporter.
        """
        base_url = os.environ.get("BRAINTRUST_API_URL", "https://api.braintrust.dev")
        # Ensure base_url ends with / for proper joining
        if not base_url.endswith("/"):
            base_url += "/"
        endpoint = url or urljoin(base_url, "otel/v1/traces")
        api_key = api_key or os.environ.get("BRAINTRUST_API_KEY")
        parent = parent or os.environ.get("BRAINTRUST_PARENT")
        headers = headers or {}

        if not api_key:
            raise ValueError(
                "API key is required. Provide it via api_key parameter or BRAINTRUST_API_KEY environment variable."
            )

        # Default parent if not provided
        if not parent:
            parent = "project_name:default-otel-project"
            logging.info(
                f"No parent specified, using default: {parent}. "
                "Configure with BRAINTRUST_PARENT environment variable or parent parameter."
            )

        exporter_headers = {
            "Authorization": f"Bearer {api_key}",
            **headers,
        }

        if parent:
            exporter_headers["x-bt-parent"] = parent

        self.parent = parent

        super().__init__(endpoint=endpoint, headers=exporter_headers, **kwargs)


def add_braintrust_span_processor(
    tracer_provider,
    api_key: str | None = None,
    parent: str | None = None,
    api_url: str | None = None,
    filter_ai_spans: bool = False,
    custom_filter=None,
    headers: dict[str, str] | None = None,
):
    processor = BraintrustSpanProcessor(
        api_key=api_key,
        parent=parent,
        api_url=api_url,
        filter_ai_spans=filter_ai_spans,
        custom_filter=custom_filter,
        headers=headers,
    )
    tracer_provider.add_span_processor(processor)


class BraintrustSpanProcessor:
    """
    A convenient all-in-one span processor for Braintrust OpenTelemetry integration.

    This class combines the OtelExporter, BatchSpanProcessor, and optionally AISpanProcessor
    into a single easy-to-use processor that can be directly added to a TracerProvider.

    Example:
        > processor = BraintrustSpanProcessor()
        > provider.add_span_processor(processor)

        > processor = BraintrustSpanProcessor(filter_ai_spans=True)
        > provider.add_span_processor(processor)
    """

    def __init__(
        self,
        api_key: str | None = None,
        parent: str | None = None,
        api_url: str | None = None,
        filter_ai_spans: bool = False,
        custom_filter=None,
        headers: dict[str, str] | None = None,
        SpanProcessor: type | None = None,
    ):
        """
        Initialize the BraintrustSpanProcessor.

        Args:
            api_key: Braintrust API key. Defaults to BRAINTRUST_API_KEY env var.
            parent: Parent identifier (e.g., "project_name:test"). Defaults to BRAINTRUST_PARENT env var.
            api_url: Base URL for Braintrust API. Defaults to BRAINTRUST_API_URL env var or https://api.braintrust.dev.
            filter_ai_spans: Whether to enable AI span filtering. Defaults to False.
            custom_filter: Optional custom filter function for filtering.
            headers: Additional headers to include in requests.
            SpanProcessor: Optional span processor class (BatchSpanProcessor or SimpleSpanProcessor). Defaults to BatchSpanProcessor.
        """
        # Create the exporter
        # Convert api_url to the full endpoint URL that OtelExporter expects
        exporter_url = None
        if api_url:
            exporter_url = f"{api_url.rstrip('/')}/otel/v1/traces"

        self._exporter = OtelExporter(url=exporter_url, api_key=api_key, parent=parent, headers=headers)

        # Create the processor chain
        if not OTEL_AVAILABLE:
            raise ImportError(
                "OpenTelemetry packages are not installed. "
                "Install optional OpenTelemetry dependencies with: pip install braintrust[otel]"
            )

        if SpanProcessor is None:
            SpanProcessor = BatchSpanProcessor

        # Always create a BatchSpanProcessor first
        processor = SpanProcessor(self._exporter)

        if filter_ai_spans:
            # Wrap the BatchSpanProcessor with filtering
            self._processor = AISpanProcessor(processor, custom_filter=custom_filter)
        else:
            # Use BatchSpanProcessor directly
            self._processor = processor

    def on_start(self, span, parent_context=None):
        try:
            parent_value = None

            # Priority 1: Check if braintrust.parent is in current OTEL context
            from opentelemetry import baggage, context

            current_context = context.get_current()
            parent_value = context.get_value("braintrust.parent", current_context)

            # Priority 2: Check OTEL baggage (propagates automatically across contexts)
            if not parent_value:
                parent_value = baggage.get_baggage("braintrust.parent", context=current_context)

            # Priority 3: Check if parent_context has braintrust.parent (backup)
            if not parent_value and parent_context:
                parent_value = context.get_value("braintrust.parent", parent_context)

            # Priority 4: Check if parent OTEL span has braintrust.parent attribute
            if not parent_value and parent_context:
                parent_value = self._get_parent_otel_braintrust_parent(parent_context)

            # Set the attribute if we found a parent value
            if parent_value:
                span.set_attribute("braintrust.parent", parent_value)

        except Exception as e:
            # If there's an exception, just don't set braintrust.parent
            pass

        self._processor.on_start(span, parent_context)

    def _get_parent_otel_braintrust_parent(self, parent_context):
        """Get braintrust.parent attribute from parent OTEL span if it exists."""
        try:
            from opentelemetry import trace

            # Get the current span from the parent context
            current_span = trace.get_current_span(parent_context)

            if current_span and hasattr(current_span, "attributes") and current_span.attributes:
                # Check if parent span has braintrust.parent attribute
                attributes = dict(current_span.attributes)
                return attributes.get("braintrust.parent")

            return None

        except Exception:
            return None

    def on_end(self, span):
        """Forward span end events to the inner processor."""
        self._processor.on_end(span)

    def shutdown(self):
        """Shutdown the inner processor."""
        self._processor.shutdown()

    def force_flush(self, timeout_millis=30000):
        """Force flush the inner processor."""
        return self._processor.force_flush(timeout_millis)

    @property
    def exporter(self):
        """Access to the underlying OtelExporter."""
        return self._exporter

    @property
    def processor(self):
        """Access to the underlying span processor."""
        return self._processor


def _get_braintrust_parent(object_type, object_id: str | None = None, compute_args: dict | None = None) -> str | None:
    """
    Construct a braintrust.parent identifier string from span components.

    Args:
        object_type: Type of parent object (PROJECT_LOGS or EXPERIMENT)
        object_id: Resolved object ID (project_id or experiment_id)
        compute_args: Optional dict with project_name/project_id for unresolved cases

    Returns:
        String like "project_id:abc", "project_name:my-proj", "experiment_id:exp-123", or None
    """
    from braintrust.span_identifier_v3 import SpanObjectTypeV3

    if not object_type:
        return None

    if object_type == SpanObjectTypeV3.PROJECT_LOGS:
        if object_id:
            return f"project_id:{object_id}"
        elif compute_args:
            # Check compute args for project_id or project_name
            _id = compute_args.get("project_id")
            _name = compute_args.get("project_name")
            if _id:
                return f"project_id:{_id}"
            elif _name:
                return f"project_name:{_name}"
    elif object_type == SpanObjectTypeV3.EXPERIMENT:
        if object_id:
            return f"experiment_id:{object_id}"
        elif compute_args:
            _id = compute_args.get("experiment_id")
            if _id:
                return f"experiment_id:{_id}"

    return None

def is_root_span(span) -> bool:
    """Returns True if the span is a root span (no parent span)."""
    return getattr(span, "parent", None) is None

def context_from_span_export(export_str: str):
    """
    Create an OTEL context from a Braintrust span export string.

    Used for distributed tracing scenarios where a Braintrust span in one service
    needs to be the parent of an OTEL span in another service.

    Args:
        export_str: The string returned from span.export()

    Returns:
        OTEL context that can be used when creating child spans
    """
    if not OTEL_AVAILABLE:
        raise ImportError(INSTALL_ERR_MSG)

    from braintrust.span_identifier_v4 import SpanComponentsV4
    from opentelemetry import baggage, trace
    from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags

    # Parse the export string (handles V3/V4 automatically)
    components = SpanComponentsV4.from_str(export_str)

    # Construct braintrust.parent from object_type and object_id
    braintrust_parent = _get_braintrust_parent(
        object_type=components.object_type,
        object_id=components.object_id,
        compute_args=components.compute_object_metadata_args,
    )

    # Convert hex strings to OTEL integers
    trace_id_int = int(components.root_span_id, 16)
    span_id_int = int(components.span_id, 16)

    # Create OTEL SpanContext marked as remote
    span_context = SpanContext(
        trace_id=trace_id_int,
        span_id=span_id_int,
        is_remote=True,  # Critical: mark as remote for distributed tracing
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )

    # Create NonRecordingSpan and set in context
    non_recording_span = NonRecordingSpan(span_context)
    ctx = trace.set_span_in_context(non_recording_span)

    # Set braintrust.parent in OTEL baggage so it propagates automatically
    if braintrust_parent:
        ctx = baggage.set_baggage("braintrust.parent", braintrust_parent, context=ctx)

    return ctx


def add_parent_to_baggage(parent: str, ctx=None):
    """
    Add braintrust.parent to OTEL baggage.

    This ensures that when using inject() for distributed tracing, the braintrust.parent
    will be propagated via baggage to downstream services.

    Args:
        parent: Braintrust parent identifier (e.g., "project_name:my-project",
                "project_id:abc123", "experiment_id:exp-456")
        ctx: Optional OTEL context to use. If None, uses current context.

    Returns:
        Context token that can be used to detach later (optional)

    Example:
        >>> from braintrust.otel import add_parent_to_baggage
        >>> from opentelemetry.propagate import inject
        >>>
        >>> # Set braintrust.parent in baggage
        >>> add_parent_to_baggage("project_name:my-project")
        >>>
        >>> # Export headers (will include braintrust.parent in baggage)
        >>> headers = {}
        >>> inject(headers)
    """
    if not OTEL_AVAILABLE:
        raise ImportError(INSTALL_ERR_MSG)

    from opentelemetry import baggage, context

    # Set in baggage so it propagates via inject()
    new_ctx = baggage.set_baggage("braintrust.parent", parent, context=ctx)
    token = context.attach(new_ctx)
    return token


def add_span_parent_to_baggage(span, ctx=None):
    """
    Copy braintrust.parent from span attribute to OTEL baggage.

    BraintrustSpanProcessor automatically sets braintrust.parent as a span attribute
    when OTEL spans are created within Braintrust contexts. This function copies that
    attribute to OTEL baggage so it propagates when using inject() for distributed tracing.

    Args:
        span: OTEL span that has braintrust.parent attribute set
        ctx: Optional OTEL context to use. If None, uses current context.

    Returns:
        Context token that can be used to detach later (optional)

    Example:
        >>> from braintrust.otel import add_span_parent_to_baggage
        >>> from opentelemetry.propagate import inject
        >>>
        >>> with tracer.start_as_current_span("service_b") as span:
        >>>     # Copy braintrust.parent from span attribute to baggage
        >>>     add_span_parent_to_baggage(span)
        >>>
        >>>     # Export headers (will include braintrust.parent in baggage)
        >>>     headers = {}
        >>>     inject(headers)
    """
    if not OTEL_AVAILABLE:
        raise ImportError(INSTALL_ERR_MSG)

    # Get braintrust.parent from span attributes
    if not span or not hasattr(span, "attributes") or not span.attributes:
        logging.warning("add_span_parent_to_baggage: span has no attributes")
        return None

    parent_value = span.attributes.get("braintrust.parent")
    if not parent_value:
        logging.warning(
            "add_span_parent_to_baggage: braintrust.parent attribute not found. "
            "Ensure BraintrustSpanProcessor is configured or span is created within Braintrust context."
        )
        return None

    # Use add_parent_to_baggage to set in baggage
    return add_parent_to_baggage(parent_value, ctx=ctx)


def parent_from_headers(headers: dict[str, str], propagator=None) -> str | None:
    """
    Extract a Braintrust-compatible parent string from trace context headers.

    This converts OTEL trace context headers into a format that can be passed
    as the 'parent' parameter to Braintrust's start_span() method.

    Args:
        headers: Dictionary with trace context headers (e.g., 'traceparent'/'baggage' for W3C)
        propagator: Optional custom TextMapPropagator. If not provided, uses the
                   globally registered propagator (W3C TraceContext by default).

    Returns:
        Braintrust V4 export string that can be used as parent parameter,
        or None if no valid span context is found or braintrust.parent is missing.

        When None is returned due to missing braintrust.parent, a warning is logged.
        The OTEL span should set braintrust.parent in baggage to specify the target project.

    Example:
        >>> # Service C receives headers from Service B
        >>> headers = {'traceparent': '00-trace_id-span_id-01', 'baggage': '...'}
        >>> parent = parent_from_headers(headers)
        >>> with project.start_span(name="service_c", parent=parent) as span:
        >>>     span.log(input="BT span as child of OTEL parent")

        >>> # Using a custom propagator (e.g., B3 format)
        >>> from opentelemetry.propagators.b3 import B3MultiFormat
        >>> propagator = B3MultiFormat()
        >>> headers = {'X-B3-TraceId': '...', 'X-B3-SpanId': '...', 'baggage': '...'}
        >>> parent = parent_from_headers(headers, propagator=propagator)
    """
    if not OTEL_AVAILABLE:
        raise ImportError(INSTALL_ERR_MSG)

    from braintrust.span_identifier_v4 import SpanComponentsV4
    from opentelemetry import baggage, trace
    from opentelemetry.propagate import extract

    # Extract context from headers using provided propagator or global propagator
    if propagator is not None:
        ctx = propagator.extract(headers)
    else:
        ctx = extract(headers)

    # Get span from context
    span = trace.get_current_span(ctx)
    if not span or not hasattr(span, "get_span_context"):
        logging.error("parent_from_headers: No valid span found in headers")
        return None

    span_context = span.get_span_context()
    if not span_context or span_context.span_id == 0:
        logging.error("parent_from_headers: Invalid span context (span_id is 0)")
        return None

    # Convert OTEL IDs to hex strings
    trace_id_hex = format(span_context.trace_id, "032x")
    span_id_hex = format(span_context.span_id, "016x")

    # Validate trace_id and span_id are not all zeros
    if trace_id_hex == "00000000000000000000000000000000":
        logging.error("parent_from_headers: Invalid trace_id (all zeros)")
        return None
    if span_id_hex == "0000000000000000":
        logging.error("parent_from_headers: Invalid span_id (all zeros)")
        return None

    # Get braintrust.parent from baggage if present
    braintrust_parent = baggage.get_baggage("braintrust.parent", context=ctx)

    # Parse braintrust.parent to extract object_type and object_id
    object_type = None
    object_id = None
    compute_args = None

    if not braintrust_parent:
        logging.warning(
            "braintrust.parent not found in OTEL baggage. "
            "Cannot create Braintrust parent without project information. "
            "Ensure the OTEL span sets braintrust.parent in baggage before exporting headers."
        )
        return None

    if braintrust_parent:
        from braintrust.span_identifier_v3 import SpanObjectTypeV3

        # Parse braintrust.parent format: "project_id:abc", "project_name:xyz", or "experiment_id:123"
        if braintrust_parent.startswith("project_id:"):
            object_type = SpanObjectTypeV3.PROJECT_LOGS
            object_id = braintrust_parent[len("project_id:") :]
            if not object_id:
                logging.error(
                    f"parent_from_headers: Invalid braintrust.parent format (empty project_id): {braintrust_parent}"
                )
                return None
        elif braintrust_parent.startswith("project_name:"):
            object_type = SpanObjectTypeV3.PROJECT_LOGS
            project_name = braintrust_parent[len("project_name:") :]
            if not project_name:
                logging.error(
                    f"parent_from_headers: Invalid braintrust.parent format (empty project_name): {braintrust_parent}"
                )
                return None
            compute_args = {"project_name": project_name}
        elif braintrust_parent.startswith("experiment_id:"):
            object_type = SpanObjectTypeV3.EXPERIMENT
            object_id = braintrust_parent[len("experiment_id:") :]
            if not object_id:
                logging.error(
                    f"parent_from_headers: Invalid braintrust.parent format (empty experiment_id): {braintrust_parent}"
                )
                return None
        else:
            logging.error(
                f"parent_from_headers: Invalid braintrust.parent format: {braintrust_parent}. "
                "Expected format: 'project_id:ID', 'project_name:NAME', or 'experiment_id:ID'"
            )
            return None

    # Create SpanComponentsV4 and export as string
    # Set row_id to enable span_id/root_span_id (required for parent linking)
    components = SpanComponentsV4(
        object_type=object_type,
        object_id=object_id,
        compute_object_metadata_args=compute_args,
        row_id="otel",  # Dummy row_id to enable span_id/root_span_id fields
        span_id=span_id_hex,
        root_span_id=trace_id_hex,
    )

    return components.to_str()
