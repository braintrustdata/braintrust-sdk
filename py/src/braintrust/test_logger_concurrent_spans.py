"""Test that logger.log() creates root-level spans even when called inside a span context.

This test would have caught the bug where logger.log() incorrectly used the context
manager to find a parent span, causing it to create child spans instead of root spans.
"""

import braintrust


def test_logger_log_creates_root_span_inside_span_context(with_memory_logger):
    """Test that logger.log() creates a root span even when called inside another span's context.

    This reproduces the pagination test bug where logger.log() with allow_concurrent_with_spans=True
    was called while inside a span context and incorrectly inherited that span as a parent.
    """
    logger = braintrust.init_logger("test_concurrent")

    # Start a span
    with logger.start_span(id="root_span") as root_span:
        root_span.log(input="span_input")

        # Call logger.log() while inside the span context
        # This should create a NEW root span, not a child of root_span
        logger.log(id="concurrent_log", input="log_input", output="log_output", scores={}, allow_concurrent_with_spans=True)

    # Check the logged events
    logs = with_memory_logger.pop()
    assert len(logs) == 2, f"Expected 2 logs, got {len(logs)}"

    # Find each log entry
    root_span_log = next(l for l in logs if l["id"] == "root_span")
    concurrent_log_entry = next(l for l in logs if l["id"] == "concurrent_log")

    # The concurrent log should be a root span (no parents)
    assert concurrent_log_entry.get("span_parents") is None, \
        f"concurrent_log should have no parents, but has: {concurrent_log_entry.get('span_parents')}"

    # The concurrent log should have its own root_span_id (not inherited from root_span)
    assert concurrent_log_entry["root_span_id"] != root_span_log["root_span_id"], \
        "concurrent_log should have a different root_span_id than root_span"

    # The concurrent log's root_span_id should be its own span_id (it's a root)
    assert concurrent_log_entry["root_span_id"] == concurrent_log_entry["span_id"], \
        "concurrent_log should be its own root (root_span_id == span_id)"


def test_experiment_log_creates_root_span_inside_span_context(with_memory_logger):
    """Test that experiment.log() creates a root span even when called inside another span's context."""
    experiment = braintrust.init("test_concurrent_exp")

    # Start a span
    with experiment.start_span(id="root_span") as root_span:
        root_span.log(input="span_input")

        # Call experiment.log() while inside the span context with allow_concurrent_with_spans=True
        # This should create a NEW root span, not a child of root_span
        experiment.log(
            id="concurrent_log",
            input="log_input",
            output="log_output",
            scores={},
            allow_concurrent_with_spans=True
        )

    # Check the logged events
    logs = with_memory_logger.pop()
    assert len(logs) == 2, f"Expected 2 logs, got {len(logs)}"

    # Find each log entry
    root_span_log = next(l for l in logs if l["id"] == "root_span")
    concurrent_log_entry = next(l for l in logs if l["id"] == "concurrent_log")

    # The concurrent log should be a root span (no parents)
    assert concurrent_log_entry.get("span_parents") is None, \
        f"concurrent_log should have no parents, but has: {concurrent_log_entry.get('span_parents')}"

    # The concurrent log should have its own root_span_id (not inherited from root_span)
    assert concurrent_log_entry["root_span_id"] != root_span_log["root_span_id"], \
        "concurrent_log should have a different root_span_id than root_span"

    # The concurrent log's root_span_id should be its own span_id (it's a root)
    assert concurrent_log_entry["root_span_id"] == concurrent_log_entry["span_id"], \
        "concurrent_log should be its own root (root_span_id == span_id)"


def test_logger_start_span_inherits_from_context_when_no_parent(with_memory_logger):
    """Test that logger.start_span() DOES use context when no explicit parent is provided.

    This is the correct behavior for OTEL integration - when inside an OTEL span,
    logger.start_span() should inherit from it.
    """
    logger = braintrust.init_logger("test_context_inheritance")

    # Start an outer span
    with logger.start_span(id="outer_span") as outer_span:
        outer_span.log(input="outer")

        # Start an inner span WITHOUT explicit parent
        # This SHOULD inherit from outer_span via context
        with logger.start_span(id="inner_span") as inner_span:
            inner_span.log(input="inner")

    # Check the logged events
    logs = with_memory_logger.pop()
    assert len(logs) == 2, f"Expected 2 logs, got {len(logs)}"

    outer_log = next(l for l in logs if l["id"] == "outer_span")
    inner_log = next(l for l in logs if l["id"] == "inner_span")

    # The inner span SHOULD inherit from outer span via context
    assert inner_log.get("span_parents") is not None, \
        "inner_span should have a parent (inherited from context)"

    assert outer_log["span_id"] in inner_log["span_parents"], \
        f"inner_span should have outer_span as parent, got parents: {inner_log.get('span_parents')}"

    # Both should share the same root_span_id
    assert inner_log["root_span_id"] == outer_log["root_span_id"], \
        "inner_span should share root_span_id with outer_span"
