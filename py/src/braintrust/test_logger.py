import asyncio
import logging
import os
import time
from typing import AsyncGenerator, List
from unittest import TestCase

import pytest

import braintrust
from braintrust import Attachment, BaseAttachment, ExternalAttachment, LazyValue, Prompt, init_logger, logger
from braintrust.logger import _deep_copy_event, _extract_attachments, parent_context
from braintrust.prompt import PromptChatBlock, PromptData, PromptMessage, PromptSchema
from braintrust.test_helpers import (
    assert_dict_matches,
    assert_logged_out,
    init_test_logger,
    simulate_login,  # noqa: F401 # type: ignore[reportUnusedImport]
    simulate_logout,
    with_memory_logger,  # noqa: F401 # type: ignore[reportUnusedImport]
    with_simulate_login,  # noqa: F401 # type: ignore[reportUnusedImport]
)


class TestInit(TestCase):
    def test_init_validation(self):
        with self.assertRaises(ValueError) as cm:
            braintrust.init()

        assert str(cm.exception) == "Must specify at least one of project or project_id"

        with self.assertRaises(ValueError) as cm:
            braintrust.init(project="project", open=True, update=True)

        assert str(cm.exception) == "Cannot open and update an experiment at the same time"

        with self.assertRaises(ValueError) as cm:
            braintrust.init(project="project", open=True)

        assert str(cm.exception) == "Cannot open an experiment without specifying its name"


class TestLogger(TestCase):
    def test_extract_attachments_no_op(self):
        attachments: List[BaseAttachment] = []

        _extract_attachments({}, attachments)
        self.assertEqual(len(attachments), 0)

        event = {"foo": "foo", "bar": None, "baz": [1, 2, 3]}
        _extract_attachments(event, attachments)
        self.assertEqual(len(attachments), 0)
        # Same instance
        self.assertIs(event["baz"], event["baz"])
        # Same content
        self.assertEqual(event, {"foo": "foo", "bar": None, "baz": [1, 2, 3]})

    def test_extract_attachments_with_attachments(self):
        attachment1 = Attachment(
            data=b"data",
            filename="filename",
            content_type="text/plain",
        )
        attachment2 = Attachment(
            data=b"data2",
            filename="filename2",
            content_type="text/plain",
        )
        attachment3 = ExternalAttachment(
            url="s3://bucket/path/to/key.pdf",
            filename="filename3",
            content_type="application/pdf",
        )
        date = "2024-10-23T05:02:48.796Z"
        event = {
            "foo": "bar",
            "baz": [1, 2],
            "attachment1": attachment1,
            "attachment3": attachment3,
            "nested": {
                "attachment2": attachment2,
                "attachment3": attachment3,
                "info": "another string",
                "anArray": [
                    attachment1,
                    None,
                    "string",
                    attachment2,
                    attachment1,
                    attachment3,
                    attachment3,
                ],
            },
            "null": None,
            "undefined": None,
            "date": date,
            "f": "Math.max",
            "empty": {},
        }
        saved_nested = event["nested"]

        attachments: List[BaseAttachment] = []
        _extract_attachments(event, attachments)

        self.assertEqual(
            attachments,
            [
                attachment1,
                attachment3,
                attachment2,
                attachment3,
                attachment1,
                attachment2,
                attachment1,
                attachment3,
                attachment3,
            ],
        )
        self.assertIs(attachments[0], attachment1)
        self.assertIs(attachments[1], attachment3)
        self.assertIs(attachments[2], attachment2)
        self.assertIs(attachments[3], attachment3)
        self.assertIs(attachments[4], attachment1)
        self.assertIs(attachments[5], attachment2)
        self.assertIs(attachments[6], attachment1)
        self.assertIs(attachments[7], attachment3)
        self.assertIs(attachments[8], attachment3)

        self.assertIs(event["nested"], saved_nested)

        self.assertEqual(
            event,
            {
                "foo": "bar",
                "baz": [1, 2],
                "attachment1": attachment1.reference,
                "attachment3": attachment3.reference,
                "nested": {
                    "attachment2": attachment2.reference,
                    "attachment3": attachment3.reference,
                    "info": "another string",
                    "anArray": [
                        attachment1.reference,
                        None,
                        "string",
                        attachment2.reference,
                        attachment1.reference,
                        attachment3.reference,
                        attachment3.reference,
                    ],
                },
                "null": None,
                "undefined": None,
                "date": date,
                "f": "Math.max",
                "empty": {},
            },
        )

    def test_deep_copy_event_basic(self):
        original = {
            "input": {"foo": "bar", "null": None, "empty": {}},
            "output": [1, 2, "3", None, {}],
        }
        copy = _deep_copy_event(original)
        self.assertEqual(copy, original)
        self.assertIsNot(copy, original)
        self.assertIsNot(copy["input"], original["input"])
        self.assertIsNot(copy["output"], original["output"])

    def test_deep_copy_event_with_attachments(self):
        attachment1 = Attachment(
            data=b"data",
            filename="filename",
            content_type="text/plain",
        )
        attachment2 = Attachment(
            data=b"data2",
            filename="filename2",
            content_type="text/plain",
        )
        attachment3 = ExternalAttachment(
            url="s3://bucket/path/to/key.pdf",
            filename="filename3",
            content_type="application/pdf",
        )
        date = "2024-10-23T05:02:48.796Z"

        original = {
            "input": "Testing",
            "output": {
                "span": "<span>",
                "myIllegalObjects": ["<experiment>", "<dataset>", "<logger>"],
                "myOtherWeirdObjects": [None, date, None, None],
                "attachment": attachment1,
                "another_attachment": attachment3,
                "attachmentList": [attachment1, attachment2, "string", attachment3],
                "nestedAttachment": {
                    "attachment": attachment2,
                    "another_attachment": attachment3,
                },
                "fake": {
                    "_bt_internal_saved_attachment": "not a number",
                },
            },
        }

        copy = _deep_copy_event(original)

        self.assertEqual(
            copy,
            {
                "input": "Testing",
                "output": {
                    "span": "<span>",
                    "myIllegalObjects": ["<experiment>", "<dataset>", "<logger>"],
                    "myOtherWeirdObjects": [None, date, None, None],
                    "attachment": attachment1,
                    "another_attachment": attachment3,
                    "attachmentList": [attachment1, attachment2, "string", attachment3],
                    "nestedAttachment": {
                        "attachment": attachment2,
                        "another_attachment": attachment3,
                    },
                    "fake": {
                        "_bt_internal_saved_attachment": "not a number",
                    },
                },
            },
        )

        self.assertIsNot(copy, original)

        self.assertIs(copy["output"]["attachment"], attachment1)
        self.assertIs(copy["output"]["another_attachment"], attachment3)
        self.assertIs(copy["output"]["nestedAttachment"]["attachment"], attachment2)
        self.assertIs(copy["output"]["nestedAttachment"]["another_attachment"], attachment3)
        self.assertIs(copy["output"]["attachmentList"][0], attachment1)
        self.assertIs(copy["output"]["attachmentList"][1], attachment2)
        self.assertIs(copy["output"]["attachmentList"][3], attachment3)

    def test_prompt_build_with_structured_output_templating(self):
        self.maxDiff = None
        prompt = Prompt(
            LazyValue(
                lambda: PromptSchema(
                    id="id",
                    project_id="project_id",
                    _xact_id="_xact_id",
                    name="name",
                    slug="slug",
                    description="description",
                    prompt_data=PromptData(
                        prompt=PromptChatBlock(
                            messages=[
                                PromptMessage(
                                    role="system",
                                    content="Please compute {{input.expression}} and return the result in JSON.",
                                ),
                            ],
                        ),
                        options={
                            "model": "gpt-4o",
                            "params": {
                                "response_format": {
                                    "type": "json_schema",
                                    "json_schema": {
                                        "name": "schema",
                                        "schema": "{{input.schema}}",
                                        "strict": True,
                                    },
                                },
                            },
                        },
                    ),
                    tags=None,
                ),
                use_mutex=True,
            ),
            {},
            False,
        )

        result = prompt.build(
            **{
                "input": {
                    "expression": "2 + 3",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "final_answer": {
                                "type": "string",
                            },
                        },
                        "required": ["final_answer"],
                        "additionalProperties": False,
                    },
                },
            }
        )

        self.assertEqual(
            result["response_format"],
            {
                "type": "json_schema",
                "json_schema": {
                    "name": "schema",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "final_answer": {"type": "string"},
                        },
                        "required": ["final_answer"],
                        "additionalProperties": False,
                    },
                    "strict": True,
                },
            },
        )


def test_noop_permalink_issue_1837():
    # fixes issue #BRA-1837
    span = braintrust.NOOP_SPAN
    assert span.permalink() == "https://www.braintrust.dev/noop-span"

    link = braintrust.permalink(span.export())
    assert link == "https://www.braintrust.dev/noop-span"

    assert span.link() == "https://www.braintrust.dev/noop-span"


def test_span_link_logged_out(with_memory_logger):
    simulate_logout()
    assert_logged_out()
    logger = init_logger(
        project="test-project",
        project_id="test-project-id",
    )
    span = logger.start_span(name="test-span")
    span.end()
    link = span.link()
    assert link == "https://www.braintrust.dev/error-generating-link?msg=login-or-provide-org-name"


def test_span_link_logged_out_org_name(with_memory_logger):
    simulate_logout()
    assert_logged_out()
    logger = init_logger(
        project_id="test-project-id",
        org_name="test-org-name",
    )
    span = logger.start_span(name="test-span")
    span.end()
    link = span.link()
    assert (
        link
        == f"https://www.braintrust.dev/app/test-org-name/object?object_type=project_logs&object_id=test-project-id&id={span._id}"
    )


def test_span_link_logged_out_org_name_env_vars(with_memory_logger):
    simulate_logout()
    assert_logged_out()
    keys = ["BRAINTRUST_APP_URL", "BRAINTRUST_ORG_NAME"]
    originals = {k: os.environ.get(k) for k in keys}
    try:
        os.environ["BRAINTRUST_APP_URL"] = "https://my-own-thing.ca/foo/bar"
        os.environ["BRAINTRUST_ORG_NAME"] = "my-own-thing"

        logger = init_logger(project_id="test-project-id")
        span = logger.start_span(name="test-span")
        span.end()
        link = span.link()
        assert (
            link
            == f"https://my-own-thing.ca/foo/bar/app/my-own-thing/object?object_type=project_logs&object_id=test-project-id&id={span._id}"
        )
    finally:
        for k, v in originals.items():
            os.environ.pop(k, None)
            if v:
                os.environ[k] = v


def test_span_project_id_logged_in(with_memory_logger, with_simulate_login):
    logger = init_logger(
        project="test-project",
        project_id="test-project-id",
    )

    span = logger.start_span(name="test-span")
    span.end()

    link = span.link()
    assert (
        link
        == f"https://www.braintrust.dev/app/test-org-name/object?object_type=project_logs&object_id=test-project-id&id={span._id}"
    )


def test_span_project_name_logged_in(with_simulate_login, with_memory_logger):
    init_logger(project="test-project")
    span = logger.start_span(name="test-span")
    span.end()

    link = span.link()
    assert link == f"https://www.braintrust.dev/app/test-org-name/p/test-project/logs?oid={span._id}"


def test_span_link_with_resolved_experiment(with_simulate_login, with_memory_logger):
    experiment = braintrust.init(
        project="test-project",
        experiment="test-experiment",
    )

    id_lazy_value = LazyValue(lambda: "test-experiment-id", use_mutex=False)
    eid = id_lazy_value.get()
    assert eid == "test-experiment-id"

    span = experiment.start_span(name="test-span")
    span.parent_object_id = id_lazy_value
    span.end()

    link = span.link()
    assert (
        link
        == f"https://www.braintrust.dev/app/test-org-name/object?object_type=experiment&object_id=test-experiment-id&id={span._id}"
    )


def test_span_link_with_unresolved_experiment(with_simulate_login, with_memory_logger):
    experiment = braintrust.init(
        project="test-project",
        experiment="test-experiment",
    )

    span = experiment.start_span(name="test-span")
    span.end()

    link = span.link()
    assert link == "https://www.braintrust.dev/error-generating-link?msg=resolve-experiment-id"


def test_permalink_with_valid_span_logged_in(with_simulate_login, with_memory_logger):
    logger = init_logger(
        project="test-project",
        project_id="test-project-id",
    )

    span = logger.start_span(name="test-span")
    span.end()

    span_export = span.export()

    link = braintrust.permalink(span_export, org_name="test-org-name", app_url="https://www.braintrust.dev")

    expected_link = f"https://www.braintrust.dev/app/test-org-name/object?object_type=project_logs&object_id=test-project-id&id={span._id}"
    assert link == expected_link


def test_span_set_current(with_memory_logger):
    """Test that span.set_current() makes the span accessible via current_span()."""
    init_test_logger(__name__)

    # Store initial current span
    initial_current = braintrust.current_span()

    # Start a span that can be set as current (default behavior)
    span1 = logger.start_span(name="test-span-1")

    # Initially, it should not be the current span
    assert braintrust.current_span() != span1

    # Call set_current() on the span
    span1.set_current()

    # Verify it's now the current span
    assert braintrust.current_span() == span1

    # Test that spans with set_current=False cannot be set as current
    span2 = logger.start_span(name="test-span-2", set_current=False)
    span2.set_current()  # This should not change the current span

    # Current span should still be span1
    assert braintrust.current_span() == span1

    span1.end()
    span2.end()


@pytest.mark.asyncio
async def test_traced_async_generator_with_exception(with_memory_logger):
    """Test tracing when async generator raises an exception."""
    init_test_logger(__name__)

    @logger.traced
    async def failing_async_generator() -> AsyncGenerator[int, None]:
        """An async generator that fails."""
        yield 1
        yield 2
        raise ValueError("Something went wrong")

    results = []
    start_time = time.time()
    with pytest.raises(ValueError, match="Something went wrong"):
        async for value in failing_async_generator():
            results.append(value)
    end_time = time.time()

    assert results == [1, 2]  # Should have yielded these before failing

    logs = with_memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]

    assert_dict_matches(
        log,
        {
            "metrics": {
                "start": lambda x: start_time <= x <= end_time,
                "end": lambda x: start_time <= x <= end_time,
            },
            "error": lambda e: "ValueError" in str(e),
        },
    )


@pytest.mark.asyncio
async def test_traced_async_generator_with_subtasks(with_memory_logger):
    """
    Test async generator with current_span().log() calls - similar to user's failing case.
    Set notrace_io so we do not automatically log output and clobber the manually logged
    output "testing"
    """

    init_test_logger(__name__)

    num_loops = 3

    @logger.traced(notrace_io=True)
    async def foo(i: int) -> int:
        """Simulate some async work."""
        await asyncio.sleep(0.001)  # Small delay to simulate work
        return i * 2

    @logger.traced("main", notrace_io=True)
    async def main():
        yield 1
        logger.current_span().log(metadata={"a": "b"})
        tasks = [asyncio.create_task(foo(i)) for i in range(num_loops)]
        done, _ = await asyncio.wait(tasks, return_when=asyncio.ALL_COMPLETED)
        total = sum(task.result() for task in done)
        logger.current_span().log(metadata=dict(total=total), output="testing")
        yield total

    # consume the generator
    results: list[int] = []
    start_time = time.time()
    async for value in main():
        results.append(value)
    end_time = time.time()

    assert results == [1, 6]

    # Check logs
    logs = with_memory_logger.pop()
    assert len(logs) == num_loops + 1

    # Find the main span
    main_spans = [l for l in logs if l["span_attributes"]["name"] == "main"]
    assert len(main_spans) == 1
    main_span = main_spans[0]

    assert_dict_matches(
        main_span,
        {
            # no input because notrace_io
            "output": "testing",
            "metadata": {"a": "b", "total": 6},  # Manual metadata logging
            "metrics": {
                "start": lambda x: start_time <= x <= end_time,
                "end": lambda x: start_time <= x <= end_time,
            },
        },
    )


@pytest.mark.asyncio
async def test_traced_async_function(with_memory_logger):
    """Test tracing async functions."""
    init_test_logger(__name__)

    @logger.traced
    async def async_multiply(x: int, y: int) -> int:
        """An async function that multiplies two numbers."""
        await asyncio.sleep(0.001)  # Small delay to simulate async work
        result = x * y
        logger.current_span().log(metadata={"operation": "multiply"})
        return result

    start_time = time.time()
    result = await async_multiply(3, 4)
    end_time = time.time()

    assert result == 12

    logs = with_memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]

    assert_dict_matches(
        log,
        {
            "input": {"x": 3, "y": 4},
            "output": 12,
            "metadata": {"operation": "multiply"},
            "metrics": {
                "start": lambda x: start_time <= x <= end_time,
                "end": lambda x: start_time <= x <= end_time,
            },
            "span_attributes": {
                "name": "async_multiply",
                "type": "function",
            },
        },
    )

    @logger.traced()
    async def async_multiply(x: int, y: int) -> int:  # pylint: disable=function-redefined
        """An async function that multiplies two numbers."""
        await asyncio.sleep(0.001)  # Small delay to simulate async work
        result = x * y
        logger.current_span().log(metadata={"operation": "multiply"})
        return result

    start_time = time.time()
    result = await async_multiply(3, 4)
    end_time = time.time()

    assert result == 12

    logs = with_memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]

    assert_dict_matches(
        log,
        {
            "input": {"x": 3, "y": 4},
            "output": 12,
            "metadata": {"operation": "multiply"},
            "metrics": {
                "start": lambda x: start_time <= x <= end_time,
                "end": lambda x: start_time <= x <= end_time,
            },
            "span_attributes": {
                "name": "async_multiply",
                "type": "function",
            },
        },
    )

    @logger.traced(name="async_multiply_with_name")
    async def async_multiply(x: int, y: int) -> int:  # pylint: disable=function-redefined
        """An async function that multiplies two numbers."""
        await asyncio.sleep(0.001)  # Small delay to simulate async work
        result = x * y
        logger.current_span().log(metadata={"operation": "multiply"})
        return result

    start_time = time.time()
    result = await async_multiply(3, 4)
    end_time = time.time()

    assert result == 12

    logs = with_memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]

    assert_dict_matches(
        log,
        {
            "input": {"x": 3, "y": 4},
            "output": 12,
            "metadata": {"operation": "multiply"},
            "metrics": {
                "start": lambda x: start_time <= x <= end_time,
                "end": lambda x: start_time <= x <= end_time,
            },
            "span_attributes": {
                "name": "async_multiply_with_name",
                "type": "function",
            },
        },
    )


def test_traced_sync_function(with_memory_logger):
    """Test tracing synchronous functions."""
    init_test_logger(__name__)

    @logger.traced
    def sync_add(a: int, b: int) -> int:
        """A sync function that adds two numbers."""
        result = a + b
        logger.current_span().log(metadata={"operation": "add"})
        return result

    start_time = time.time()
    result = sync_add(5, 7)
    end_time = time.time()

    assert result == 12

    logs = with_memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]

    assert_dict_matches(
        log,
        {
            "input": {"a": 5, "b": 7},
            "output": 12,
            "metadata": {"operation": "add"},
            "metrics": {
                "start": lambda x: start_time <= x <= end_time,
                "end": lambda x: start_time <= x <= end_time,
            },
            "span_attributes": {
                "name": "sync_add",
                "type": "function",
            },
        },
    )


def test_traced_sync_generator(with_memory_logger):
    """Test tracing synchronous generators."""
    init_test_logger(__name__)

    @logger.traced
    def sync_number_generator(n: int):
        """A sync generator that yields numbers."""
        for i in range(n):
            yield i * 2

    results = []
    start_time = time.time()
    for value in sync_number_generator(3):
        results.append(value)
    end_time = time.time()

    assert results == [0, 2, 4]

    logs = with_memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]

    # Should log the complete output as a list
    assert log.get("output") == [0, 2, 4]
    assert log.get("input") == {"n": 3}
    assert_dict_matches(
        log,
        {
            "metrics": {
                "start": lambda x: start_time <= x <= end_time,
                "end": lambda x: start_time <= x <= end_time,
            },
            "span_attributes": {
                "name": "sync_number_generator",
                "type": "function",
            },
        },
    )


def test_traced_sync_generator_with_exception(with_memory_logger):
    """Test sync generator that raises an exception."""
    init_test_logger(__name__)

    @logger.traced
    def failing_generator():
        yield "first"
        yield "second"
        raise RuntimeError("Generator failed")

    results = []
    start_time = time.time()
    with pytest.raises(RuntimeError, match="Generator failed"):
        for value in failing_generator():
            results.append(value)
    end_time = time.time()

    assert results == ["first", "second"]

    logs = with_memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]

    # Should have partial output and error
    assert log.get("output") == ["first", "second"]
    assert "RuntimeError" in str(log.get("error", ""))
    assert_dict_matches(
        log,
        {
            "metrics": {
                "start": lambda x: start_time <= x <= end_time,
                "end": lambda x: start_time <= x <= end_time,
            },
        },
    )


def test_traced_sync_generator_with_subtasks(with_memory_logger):
    """
    Test sync generator with current_span().log() calls
    Set notrace_io so we do not automatically log output and clobber the manually logged
    output "testing"
    """

    init_test_logger(__name__)

    num_loops = 3

    @logger.traced(notrace_io=True)
    def foo(i: int) -> int:
        """Simulate some sync work."""
        time.sleep(0.001)
        return i * 2

    @logger.traced("main", notrace_io=True)
    def main():
        yield 1
        logger.current_span().log(metadata={"a": "b"})
        tasks = [foo(i) for i in range(num_loops)]
        total = sum(tasks)
        logger.current_span().log(metadata=dict(total=total), output="testing")
        yield total

    # consume the generator
    results: list[int] = []
    start_time = time.time()
    for value in main():
        results.append(value)
    end_time = time.time()

    assert results == [1, 6]

    # Check logs
    logs = with_memory_logger.pop()
    assert len(logs) == num_loops + 1

    # Find the main span
    main_spans = [l for l in logs if l["span_attributes"]["name"] == "main"]
    assert len(main_spans) == 1
    main_span = main_spans[0]

    assert_dict_matches(
        main_span,
        {
            # no input because notrace_io
            "output": "testing",
            "metadata": {"a": "b", "total": 6},  # Manual metadata logging
            "metrics": {
                "start": lambda x: start_time <= x <= end_time,
                "end": lambda x: start_time <= x <= end_time,
            },
        },
    )


@pytest.mark.asyncio
async def test_traced_async_generator(with_memory_logger):
    """Test async generator version of sync generator test."""
    init_test_logger(__name__)

    @logger.traced
    async def async_number_generator(n: int):
        """An async generator that yields numbers."""
        for i in range(n):
            await asyncio.sleep(0.001)
            yield i * 2

    results = []
    start_time = time.time()
    async for value in async_number_generator(3):
        results.append(value)
    end_time = time.time()

    assert results == [0, 2, 4]

    logs = with_memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]

    # Should log the complete output as a list
    assert log.get("output") == [0, 2, 4]
    assert log.get("input") == {"n": 3}
    assert_dict_matches(
        log,
        {
            "metrics": {
                "start": lambda x: start_time <= x <= end_time,
                "end": lambda x: start_time <= x <= end_time,
            },
            "span_attributes": {
                "name": "async_number_generator",
                "type": "function",
            },
        },
    )


def test_traced_sync_generator_truncation(with_memory_logger, caplog):
    """Test sync generator truncation behavior."""
    init_test_logger(__name__)

    original = os.environ.get("BRAINTRUST_MAX_GENERATOR_ITEMS")
    try:
        os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = "3"

        @logger.traced
        def large_generator():
            """A generator that yields more items than the limit."""
            for i in range(10):
                yield i

        results = []
        with caplog.at_level(logging.WARNING):
            for value in large_generator():
                results.append(value)

        # All values should still be yielded
        assert results == list(range(10))

        # Check warning was logged
        assert any("Generator output exceeded limit of 3 items" in record.message for record in caplog.records)

        logs = with_memory_logger.pop()
        assert len(logs) == 1
        log = logs[0]

        # Output should not be logged when truncated
        assert "output" not in log or log.get("output") is None
        assert log.get("input") == {}

    finally:
        os.environ.pop("BRAINTRUST_MAX_GENERATOR_ITEMS", None)
        if original:
            os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = original


@pytest.mark.asyncio
async def test_traced_async_generator_truncation(with_memory_logger, caplog):
    """Test async generator truncation behavior."""
    init_test_logger(__name__)

    original = os.environ.get("BRAINTRUST_MAX_GENERATOR_ITEMS")
    try:
        os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = "3"

        @logger.traced
        async def large_async_generator():
            """An async generator that yields more items than the limit."""
            for i in range(10):
                await asyncio.sleep(0.001)
                yield i

        results = []
        with caplog.at_level(logging.WARNING):
            async for value in large_async_generator():
                results.append(value)

        # All values should still be yielded
        assert results == list(range(10))

        # Check warning was logged
        assert any("Generator output exceeded limit of 3 items" in record.message for record in caplog.records)

        logs = with_memory_logger.pop()
        assert len(logs) == 1
        log = logs[0]

        # Output should not be logged when truncated
        assert "output" not in log or log.get("output") is None
        assert log.get("input") == {}

    finally:
        os.environ.pop("BRAINTRUST_MAX_GENERATOR_ITEMS", None)
        if original:
            os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = original


def test_traced_sync_generator_zero_limit_drops_output(with_memory_logger):
    """Test sync generator with limit=0 drops all output but still yields values."""
    init_test_logger(__name__)

    original = os.environ.get("BRAINTRUST_MAX_GENERATOR_ITEMS")
    try:
        os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = "0"

        @logger.traced
        def no_output_logged_generator():
            """Generator whose output won't be logged due to limit=0."""
            for i in range(10):
                yield i

        results = []
        for value in no_output_logged_generator():
            results.append(value)

        # Generator still yields all values
        assert results == list(range(10))

        logs = with_memory_logger.pop()
        assert len(logs) == 1
        log = logs[0]

        # Output is not logged when limit is 0
        assert "output" not in log or log.get("output") is None

    finally:
        os.environ.pop("BRAINTRUST_MAX_GENERATOR_ITEMS", None)
        if original:
            os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = original


def test_traced_sync_generator_unlimited_with_minus_one(with_memory_logger):
    """Test sync generator with limit=-1 buffers all output."""
    init_test_logger(__name__)

    original = os.environ.get("BRAINTRUST_MAX_GENERATOR_ITEMS")
    try:
        os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = "-1"

        @logger.traced
        def unlimited_buffer_generator():
            """Generator that buffers all output with limit=-1."""
            for i in range(3):
                yield i * 2

        results = []
        for value in unlimited_buffer_generator():
            results.append(value)

        assert results == [0, 2, 4]

        logs = with_memory_logger.pop()
        assert len(logs) == 1
        log = logs[0]

        # All output should be logged when limit is -1
        assert log.get("output") == [0, 2, 4]

    finally:
        os.environ.pop("BRAINTRUST_MAX_GENERATOR_ITEMS", None)
        if original:
            os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = original


@pytest.mark.asyncio
async def test_traced_async_generator_zero_limit_drops_output(with_memory_logger):
    """Test async generator with limit=0 drops all output but still yields values."""
    init_test_logger(__name__)

    original = os.environ.get("BRAINTRUST_MAX_GENERATOR_ITEMS")
    try:
        os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = "0"

        @logger.traced
        async def no_output_logged_async_generator():
            """Async generator whose output won't be logged due to limit=0."""
            for i in range(10):
                await asyncio.sleep(0.001)
                yield i

        results = []
        async for value in no_output_logged_async_generator():
            results.append(value)

        # Generator still yields all values
        assert results == list(range(10))

        logs = with_memory_logger.pop()
        assert len(logs) == 1
        log = logs[0]

        # Output is not logged when limit is 0
        assert "output" not in log or log.get("output") is None

    finally:
        os.environ.pop("BRAINTRUST_MAX_GENERATOR_ITEMS", None)
        if original:
            os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = original


@pytest.mark.asyncio
async def test_traced_async_generator_unlimited_with_minus_one(with_memory_logger):
    """Test async generator with limit=-1 buffers all output."""
    init_test_logger(__name__)

    original = os.environ.get("BRAINTRUST_MAX_GENERATOR_ITEMS")
    try:
        os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = "-1"

        @logger.traced
        async def unlimited_buffer_async_generator():
            """Async generator that buffers all output with limit=-1."""
            for i in range(3):
                await asyncio.sleep(0.001)
                yield i * 2

        results = []
        async for value in unlimited_buffer_async_generator():
            results.append(value)

        assert results == [0, 2, 4]

        logs = with_memory_logger.pop()
        assert len(logs) == 1
        log = logs[0]

        # All output should be logged when limit is -1
        assert log.get("output") == [0, 2, 4]

    finally:
        os.environ.pop("BRAINTRUST_MAX_GENERATOR_ITEMS", None)
        if original:
            os.environ["BRAINTRUST_MAX_GENERATOR_ITEMS"] = original


def test_masking_function_logger(with_memory_logger, with_simulate_login):
    """Test that masking function is applied to logged data in Logger."""

    def masking_function(data):
        """Replace any occurrence of 'sensitive' with 'REDACTED'"""
        if isinstance(data, str):
            return data.replace('sensitive', 'REDACTED')
        elif isinstance(data, dict):
            masked = {}
            for k, v in data.items():
                if isinstance(v, str) and 'sensitive' in v:
                    masked[k] = v.replace('sensitive', 'REDACTED')
                elif isinstance(v, dict):
                    masked[k] = masking_function(v)
                elif isinstance(v, list):
                    masked[k] = [masking_function(item) if isinstance(item, (dict, list)) else item for item in v]
                else:
                    masked[k] = v
            return masked
        elif isinstance(data, list):
            return [masking_function(item) if isinstance(item, (dict, list)) else item for item in data]
        return data

    # Set masking function globally
    braintrust.set_masking_function(masking_function)

    # Create test logger
    test_logger = init_test_logger("test_project")

    # Log some data with sensitive information
    test_logger.log(
        input="This is a sensitive input",
        output={"message": "This contains sensitive data", "count": 42},
        metadata={"user": "sensitive_user", "safe": "normal_data"},
    )

    # Check the logged data
    logs = with_memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]

    # Verify masking was applied
    assert log["input"] == "This is a REDACTED input"
    assert log["output"]["message"] == "This contains REDACTED data"
    assert log["output"]["count"] == 42
    assert log["metadata"]["user"] == "REDACTED_user"
    assert log["metadata"]["safe"] == "normal_data"

    # Clean up
    braintrust.set_masking_function(None)


def test_masking_function_experiment(with_memory_logger, with_simulate_login):
    """Test that masking function is applied to logged data in Experiment."""

    def masking_function(data):
        """Replace any occurrence of 'password' with 'XXX'"""
        if isinstance(data, str):
            return data.replace('password', 'XXX')
        elif isinstance(data, dict):
            masked = {}
            for k, v in data.items():
                if k == "password":
                    # Mask the value when the key is "password"
                    masked[k] = "XXX"
                elif isinstance(v, str) and 'password' in v:
                    masked[k] = v.replace('password', 'XXX')
                elif isinstance(v, dict):
                    masked[k] = masking_function(v)
                elif isinstance(v, list):
                    masked[k] = [masking_function(item) if isinstance(item, (dict, list)) else item for item in v]
                else:
                    masked[k] = v
            return masked
        elif isinstance(data, list):
            return [masking_function(item) if isinstance(item, (dict, list)) else item for item in data]
        return data

    # Set masking function globally
    braintrust.set_masking_function(masking_function)

    # Create test experiment
    from braintrust.logger import Experiment, ObjectMetadata, ProjectExperimentMetadata
    project_metadata = ObjectMetadata(id="test_project", name="test_project", full_info=dict())
    experiment_metadata = ObjectMetadata(id="test_experiment", name="test_experiment", full_info=dict())
    metadata = ProjectExperimentMetadata(project=project_metadata, experiment=experiment_metadata)
    lazy_metadata = LazyValue(lambda: metadata, use_mutex=False)
    experiment = Experiment(lazy_metadata=lazy_metadata)

    # Log some data with passwords
    experiment.log(
        input={"command": "login", "password": "secret123"},
        output="Login successful with password validation",
        scores={"accuracy": 0.95},
    )

    # Check the logged data
    logs = with_memory_logger.pop()
    assert len(logs) > 0  # Should have at least one log entry

    # Debug: Print all logs to see what's there
    print(f"Number of logs: {len(logs)}")
    for i, log in enumerate(logs):
        print(f"Log {i}: {log}")

    # Find the main log entry (not the end span)
    main_log = None
    for log in logs:
        if log.get("input") is not None:
            main_log = log
            break

    assert main_log is not None, "Could not find main log entry"

    # Verify masking was applied
    assert main_log["input"]["command"] == "login"
    assert main_log["input"]["password"] == "XXX"
    assert main_log["output"] == "Login successful with XXX validation"
    assert main_log["scores"]["accuracy"] == 0.95

    # Clean up
    braintrust.set_masking_function(None)


def test_masking_function_propagates_to_spans(with_memory_logger, with_simulate_login):
    """Test that masking function propagates from parent to child spans."""

    def masking_function(data):
        """Replace any 'api_key' field with 'HIDDEN'"""
        if isinstance(data, dict):
            masked = {}
            for k, v in data.items():
                if k == "api_key":
                    masked[k] = "HIDDEN"
                elif isinstance(v, dict):
                    masked[k] = masking_function(v)
                elif isinstance(v, list):
                    masked[k] = [masking_function(item) if isinstance(item, (dict, list)) else item for item in v]
                else:
                    masked[k] = v
            return masked
        elif isinstance(data, list):
            return [masking_function(item) if isinstance(item, (dict, list)) else item for item in data]
        return data

    # Set masking function globally
    braintrust.set_masking_function(masking_function)

    # Create test logger
    test_logger = init_test_logger("test_project")

    # Create parent span
    with test_logger.start_span(name="parent_span") as parent:
        parent.log(input={"api_key": "sk-12345", "query": "test"})

        # Create child span
        with parent.start_span(name="child_span") as child:
            child.log(output={"response": "data", "api_key": "sk-67890"})

    # Check the logged data
    logs = with_memory_logger.pop()

    # Find parent and child logs
    parent_log = next((log for log in logs if log.get("span_attributes", {}).get("name") == "parent_span"), None)
    child_log = next((log for log in logs if log.get("span_attributes", {}).get("name") == "child_span"), None)

    assert parent_log is not None
    assert child_log is not None

    # Verify masking was applied to both spans
    assert parent_log["input"]["api_key"] == "HIDDEN"
    assert parent_log["input"]["query"] == "test"
    assert child_log["output"]["api_key"] == "HIDDEN"
    assert child_log["output"]["response"] == "data"


def test_masking_function_dataset(with_memory_logger, with_simulate_login):
    """Test that masking function is applied to dataset operations."""

    def masking_function(data):
        """Replace email addresses with 'EMAIL_REDACTED'"""
        if isinstance(data, dict):
            masked = {}
            for k, v in data.items():
                if isinstance(v, str) and '@' in v and '.' in v:
                    # Simple email detection
                    masked[k] = "EMAIL_REDACTED"
                elif isinstance(v, dict):
                    masked[k] = masking_function(v)
                elif isinstance(v, list):
                    masked[k] = [masking_function(item) if isinstance(item, (dict, list)) else item for item in v]
                else:
                    masked[k] = v
            return masked
        elif isinstance(data, list):
            return [masking_function(item) if isinstance(item, (dict, list)) else item for item in data]
        return data

    # Set masking function globally
    braintrust.set_masking_function(masking_function)

    # Create test dataset
    from braintrust.logger import Dataset, ObjectMetadata, ProjectDatasetMetadata
    project_metadata = ObjectMetadata(id="test_project", name="test_project", full_info=dict())
    dataset_metadata = ObjectMetadata(id="test_dataset", name="test_dataset", full_info=dict())
    metadata = ProjectDatasetMetadata(project=project_metadata, dataset=dataset_metadata)
    lazy_metadata = LazyValue(lambda: metadata, use_mutex=False)
    dataset = Dataset(lazy_metadata=lazy_metadata)

    # Insert data with email addresses
    dataset.insert(
        input={"user": "john@example.com", "action": "login"},
        expected={"status": "success", "email": "john@example.com"},
        metadata={"admin_email": "admin@example.com"},
    )

    # Check the logged data
    logs = with_memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]

    # Verify masking was applied
    assert log["input"]["user"] == "EMAIL_REDACTED"
    assert log["input"]["action"] == "login"
    assert log["expected"]["status"] == "success"
    assert log["expected"]["email"] == "EMAIL_REDACTED"
    assert log["metadata"]["admin_email"] == "EMAIL_REDACTED"

    # Clean up
    braintrust.set_masking_function(None)



def test_masking_function_with_error(with_memory_logger, with_simulate_login):
    """Test that masking errors are handled gracefully and stack traces are captured."""

    def broken_masking_function(data):
        """A masking function that throws errors for certain data types."""
        if isinstance(data, dict):
            # This will throw an error when trying to iterate
            for key in data:
                if key == "password":
                    # Simulate a complex error
                    raise ValueError(f"Cannot mask sensitive field '{key}' - internal masking error")
                elif key == "accuracy":
                    # Trigger error for scores field
                    raise TypeError("Cannot process numeric score")
            return data
        elif isinstance(data, str):
            if "secret" in data.lower():
                # Another type of error
                result = 1 / 0  # ZeroDivisionError
            return data
        elif isinstance(data, list):
            # Try to access non-existent index
            if len(data) > 0:
                _ = data[100]  # IndexError
            return data
        return data

    # Set the broken masking function
    braintrust.set_masking_function(broken_masking_function)

    # Create test experiment
    from braintrust.logger import Experiment, ObjectMetadata, ProjectExperimentMetadata
    project_metadata = ObjectMetadata(id="test_project", name="test_project", full_info=dict())
    experiment_metadata = ObjectMetadata(id="test_experiment", name="test_experiment", full_info=dict())
    metadata = ProjectExperimentMetadata(project=project_metadata, experiment=experiment_metadata)
    lazy_metadata = LazyValue(lambda: metadata, use_mutex=False)
    experiment = Experiment(lazy_metadata=lazy_metadata)

    # Log data that will trigger various errors
    experiment.log(
        input={"password": "my-password", "user": "test"},
        output="This contains SECRET information",
        expected=["item1", "item2"],
        metadata={"safe": "data"},
        scores={"score": 1.0}  # Add a safe score that won't trigger error
    )

    experiment.flush()

    # Check the logged data
    logs = with_memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]

    # Verify error handling
    # The input should have an error message because of the password field
    assert log["input"] == "ERROR: Failed to mask field 'input' - ValueError"

    # The output should have an error message because of division by zero
    assert log["output"] == "ERROR: Failed to mask field 'output' - ZeroDivisionError"

    # The expected should have an error message because of index error
    assert log["expected"] == "ERROR: Failed to mask field 'expected' - IndexError"

    # Metadata should be fine since it doesn't trigger any errors
    assert log["metadata"] == {"safe": "data"}

    # Test with scores that triggers an error
    experiment.log(
        input={"data": "test"},
        output="result",
        scores={"accuracy": 0.95},  # This will trigger an error
    )

    logs2 = with_memory_logger.pop()
    assert len(logs2) == 1
    log2 = logs2[0]

    # Scores should be dropped and error should be logged
    assert "scores" not in log2
    assert "error" in log2
    assert log2["error"] == "ERROR: Failed to mask field 'scores' - TypeError"

    # Test with metrics that triggers an error
    experiment.log(
        input={"data": "test2"},
        output="result2",
        scores={"score": 1.0},  # Safe score
        metrics={"accuracy": 0.95},  # This will trigger an error
    )

    logs3 = with_memory_logger.pop()
    assert len(logs3) == 1
    log3 = logs3[0]

    # Metrics should be dropped and error should be logged
    assert "metrics" not in log3
    assert "error" in log3
    assert log3["error"] == "ERROR: Failed to mask field 'metrics' - TypeError"

    # Test with both scores and metrics failing
    experiment.log(
        input={"data": "test3"},
        output="result3",
        scores={"accuracy": 0.85},  # This will trigger an error
        metrics={"accuracy": 0.95},  # This will also trigger an error
    )

    logs4 = with_memory_logger.pop()
    assert len(logs4) == 1
    log4 = logs4[0]

    # Both should be dropped and errors should be concatenated
    assert "scores" not in log4
    assert "metrics" not in log4
    assert "error" in log4
    assert "ERROR: Failed to mask field 'scores' - TypeError" in log4["error"]
    assert "ERROR: Failed to mask field 'metrics' - TypeError" in log4["error"]
    assert "; " in log4["error"]  # Check that errors are joined with semicolon

    # Test with logger and nested spans
    test_logger = init_test_logger("test_masking_errors_logger")

    with test_logger.start_span("parent") as parent:
        parent.log(
            input={"api_key": "key123", "password": "secret"},
            metadata={"request_id": "req-123"}
        )

        with parent.start_span("child") as child:
            child.log(
                output="Result with secret data",
                expected=[1, 2, 3]
            )

    test_logger.flush()

    # Check nested span logs
    logs = with_memory_logger.pop()
    assert len(logs) == 2  # parent and child

    # Find parent and child by span_attributes
    parent_log = next(log for log in logs if log.get("span_attributes", {}).get("name") == "parent")
    child_log = next(log for log in logs if log.get("span_attributes", {}).get("name") == "child")

    # Parent should have error in input
    assert parent_log["input"] == "ERROR: Failed to mask field 'input' - ValueError"

    # Child should have errors in output and expected
    assert child_log["output"] == "ERROR: Failed to mask field 'output' - ZeroDivisionError"
    assert child_log["expected"] == "ERROR: Failed to mask field 'expected' - IndexError"

    # Clean up
    braintrust.set_masking_function(None)

def test_attachment_unreadable_path_logs_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="braintrust"):
        Attachment(
            data="unreadable.txt",
            filename="unreadable.txt",
            content_type="text/plain",
        )

    assert len(caplog.records) == 1
    assert caplog.records[0].levelname == "WARNING"
    assert "Failed to read file" in caplog.records[0].message


def test_attachment_readable_path_returns_data(tmp_path):
    file_path = tmp_path / "attachments" / "hello.txt"
    file_path.parent.mkdir(parents=True)
    file_path.write_bytes(b"hello world")

    a = Attachment(data=str(file_path), filename="hello.txt", content_type="text/plain")
    assert a.data == b"hello world"


def test_parent_precedence_with_parent_context_and_traced(with_memory_logger, with_simulate_login):
    """Test that with parent_context + traced, child spans attach to current span (not directly to parent context)."""
    init_test_logger(__name__)

    # Create exported parent context
    with logger.start_span(name="outer") as outer:
        outer_export = outer.export()

    @logger.traced("inner", notrace_io=True)
    def inner():
        s = logger.start_span(name="child")
        s.end()

    with parent_context(outer_export):
        inner()

    logs = with_memory_logger.pop()
    outer_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "outer")
    inner_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "inner")
    child_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "child")

    # child should have inner as a parent
    assert inner_log["span_id"] in (child_log.get("span_parents") or [])
    # child and outer should share the same root
    assert child_log["root_span_id"] == outer_log["root_span_id"]


def test_parent_precedence_traced_baseline(with_memory_logger, with_simulate_login):
    """Test that traced baseline nests child under current span."""
    init_test_logger(__name__)

    @logger.traced("top", notrace_io=True)
    def top():
        s = logger.start_span(name="child")
        s.end()

    top()
    logs = with_memory_logger.pop()
    top_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "top")
    child_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "child")

    assert top_log["span_id"] in (child_log.get("span_parents") or [])


def test_parent_precedence_explicit_parent_overrides(with_memory_logger, with_simulate_login):
    """Test that explicit parent overrides current span."""
    init_test_logger(__name__)

    with logger.start_span(name="outer") as outer:
        outer_export = outer.export()

    @logger.traced("inner", notrace_io=True)
    def inner():
        s = braintrust.start_span(name="forced", parent=outer_export)
        s.end()

    inner()
    logs = with_memory_logger.pop()
    outer_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "outer")
    inner_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "inner")
    forced_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "forced")

    parents = forced_log.get("span_parents") or []
    assert outer_log["span_id"] in parents
    assert inner_log["span_id"] not in parents
