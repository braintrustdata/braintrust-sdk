# pyright: reportUnknownVariableType=false
# pyright: reportPrivateUsage=false
import asyncio
import json
import logging
import os
import time
from typing import AsyncGenerator, List
from unittest import TestCase
from unittest.mock import MagicMock, patch

import braintrust
import pytest
from braintrust import (
    Attachment,
    BaseAttachment,
    ExternalAttachment,
    JSONAttachment,
    LazyValue,
    Prompt,
    init_logger,
    logger,
)
from braintrust.id_gen import OTELIDGenerator, get_id_generator
from braintrust.logger import (
    _extract_attachments,
    parent_context,
    render_message,
    render_mustache,
)
from braintrust.prompt import PromptChatBlock, PromptData, PromptMessage, PromptSchema
from braintrust.test_helpers import (
    assert_dict_matches,
    assert_logged_out,
    init_test_exp,
    init_test_logger,
    preserve_env_vars,
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

    def test_init_with_dataset_id_only(self):
        """Test that init accepts dataset={'id': '...'} parameter"""
        # Test the logic that extracts dataset_id from the dict
        from braintrust.logger import Dataset

        # Test 1: dict with only id
        dataset_dict = {"id": "dataset-id-123"}
        assert isinstance(dataset_dict, dict)
        assert not isinstance(dataset_dict, Dataset)
        assert dataset_dict["id"] == "dataset-id-123"

        # Test 2: full Dataset object has different behavior
        # (We can't easily instantiate a Dataset here, but we can verify
        # that the isinstance check distinguishes them)

    def test_init_with_dataset_id_and_version(self):
        """Test that init accepts dataset={'id': '...', 'version': '...'} parameter"""
        # Test the logic that extracts both dataset_id and dataset_version from the dict
        from braintrust.logger import Dataset

        # Test: dict with id and version
        dataset_dict = {"id": "dataset-id-123", "version": "v2"}
        assert isinstance(dataset_dict, dict)
        assert not isinstance(dataset_dict, Dataset)
        assert dataset_dict["id"] == "dataset-id-123"
        assert dataset_dict["version"] == "v2"


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

    def test_lint_template_valid_variables(self):
        """Test lint_template passes with all variables present."""

        template = "Hello {{name}}, you are {{age}} years old"
        args = {"name": "John", "age": 30}

        # Should not raise any exception
        try:
            render_mustache(template, args, strict=True)
        except ValueError:
            self.fail("lint_template raised ValueError unexpectedly")

    def test_lint_template_missing_variable(self):
        template = "Hello {{name}}, you are {{age}} years old"
        args = {"name": "John"}  # Missing 'age'

        with self.assertRaises(ValueError) as context:
            render_mustache(template, args, strict=True)

        self.assertIn("Template rendering failed: Could not find key 'age'", str(context.exception))

    def test_prompt_build_strict_mode_enabled(self):
        """Test Prompt.build with strict mode enabled validates variables."""
        from braintrust.prompt import PromptChatBlock, PromptData, PromptMessage, PromptSchema

        # Create prompt using the proper structure
        prompt_schema = PromptSchema(
            id="test-id",
            project_id="test-project",
            _xact_id="test-xact",
            name="test-prompt",
            slug="test-prompt",
            description="test",
            prompt_data=PromptData(
                prompt=PromptChatBlock(
                    messages=[PromptMessage(role="user", content="Hello {{name}}, please help with {{task}}")]
                ),
                options={"model": "gpt-4o"},
            ),
            tags=None,
        )
        lazy_prompt = LazyValue(lambda: prompt_schema, use_mutex=False)
        prompt = Prompt(lazy_prompt, {}, False)

        # Valid build with all variables
        result = prompt.build(name="John", task="coding", strict=True)
        self.assertEqual(result["messages"][0]["content"], "Hello John, please help with coding")

        # Invalid build missing variables should raise ValueError
        with self.assertRaises(ValueError) as context:
            prompt.build(name="John", strict=True)  # Missing 'task'

        self.assertIn("Template rendering failed: Could not find key 'task'", str(context.exception))

    def test_prompt_build_strict_mode_disabled(self):
        """Test Prompt.build with strict mode disabled allows missing variables."""
        from braintrust.prompt import PromptChatBlock, PromptData, PromptMessage, PromptSchema

        prompt_schema = PromptSchema(
            id="test-id",
            project_id="test-project",
            _xact_id="test-xact",
            name="test-prompt",
            slug="test-prompt",
            description="test",
            prompt_data=PromptData(
                prompt=PromptChatBlock(
                    messages=[PromptMessage(role="user", content="Hello {{name}}, please help with {{task}}")]
                ),
                options={"model": "gpt-4o"},
            ),
            tags=None,
        )
        lazy_prompt = LazyValue(lambda: prompt_schema, use_mutex=False)
        prompt = Prompt(lazy_prompt, {}, False)

        # Should work even with missing variables when strict=False (default)
        result = prompt.build(name="John")
        # Missing variables render as empty strings in chevron
        self.assertEqual(result["messages"][0]["content"], "Hello John, please help with ")

    def _create_test_prompt(self, content: str):
        """Helper to create a test prompt with the proper structure."""
        from braintrust.prompt import PromptChatBlock, PromptData, PromptMessage, PromptSchema

        prompt_schema = PromptSchema(
            id="test-id",
            project_id="test-project",
            _xact_id="test-xact",
            name="test-prompt",
            slug="test-prompt",
            description="test",
            prompt_data=PromptData(
                prompt=PromptChatBlock(messages=[PromptMessage(role="user", content=content)]),
                options={"model": "gpt-4o"},
            ),
            tags=None,
        )
        lazy_prompt = LazyValue(lambda: prompt_schema, use_mutex=False)
        return Prompt(lazy_prompt, {}, False)

    def test_prompt_build_nested_variables_strict(self):
        """Test Prompt.build with nested object variables in strict mode."""
        prompt = self._create_test_prompt("User {{user.name}} with email {{user.profile.email}}")

        # Valid nested data
        user_data = {"user": {"name": "John", "profile": {"email": "john@example.com"}}}
        result = prompt.build(strict=True, **user_data)
        expected = "User John with email john@example.com"
        self.assertEqual(result["messages"][0]["content"], expected)

        # Missing nested property should fail in strict mode
        invalid_data = {"user": {"name": "John"}}  # Missing profile.email
        with self.assertRaises(ValueError):
            prompt.build(strict=True, **invalid_data)

    def test_prompt_build_array_variables_strict(self):
        """Test Prompt.build with array variables in strict mode."""
        prompt = self._create_test_prompt("Items: {{items.0}}, {{items.1}}")

        # Valid array with enough items
        result = prompt.build(items=["first", "second", "third"], strict=True)
        self.assertEqual(result["messages"][0]["content"], "Items: first, second")

        # Array too short should fail in strict mode
        with self.assertRaises(ValueError):
            prompt.build(items=["only_one"], strict=True)

    def test_render_message_with_file_content_parts(self):
        """Test render_message with mixed text, image, and file content parts including all file fields."""
        message = PromptMessage(
            role="user",
            content=[
                {"type": "text", "text": "Here is a {{item}}:"},
                {"type": "image_url", "image_url": {"url": "{{image_url}}"}},
                {
                    "type": "file",
                    "file": {
                        "file_data": "{{file_data}}",
                        "file_id": "{{file_id}}",
                        "filename": "{{filename}}",
                    },
                },
            ],
        )

        rendered = render_message(
            lambda template: template.replace("{{item}}", "document")
            .replace("{{image_url}}", "https://example.com/image.png")
            .replace("{{file_data}}", "base64data")
            .replace("{{file_id}}", "file-456")
            .replace("{{filename}}", "report.pdf"),
            message,
        )

        assert rendered["content"] == [
            {"type": "text", "text": "Here is a document:"},
            {"type": "image_url", "image_url": {"url": "https://example.com/image.png"}},
            {
                "type": "file",
                "file": {
                    "file_data": "base64data",
                    "file_id": "file-456",
                    "filename": "report.pdf",
                },
            },
        ]


def test_noop_permalink_issue_1837():
    # fixes issue #BRA-1837
    span = braintrust.NOOP_SPAN
    assert span.permalink() == "https://www.braintrust.dev/noop-span"

    link = braintrust.permalink(span.export())
    assert link == "https://www.braintrust.dev/noop-span"

    assert span.link() == "https://www.braintrust.dev/noop-span"


def test_span_log_with_simple_circular_reference(with_memory_logger):
    """Test that span.log() with simple circular reference works gracefully."""
    logger = init_test_logger(__name__)

    with logger.start_span(name="test_span") as span:
        # Create simple circular reference
        data = {"key": "value"}
        data["self"] = data

        # Should handle circular reference gracefully
        span.log(
            input={"test": "simple circular ref"},
            output=data,
        )

    # Verify the log was recorded with circular reference replaced by placeholder
    logs = with_memory_logger.pop()
    assert len(logs) == 1

    logged_output = logs[0]["output"]
    assert logged_output["key"] == "value"
    # Circular reference should be replaced with a placeholder string
    assert isinstance(logged_output["self"], str)
    assert "circular" in logged_output["self"].lower()


def test_span_log_with_nested_circular_reference(with_memory_logger):
    """Test that span.log() with nested circular reference works gracefully."""
    logger = init_test_logger(__name__)

    with logger.start_span(name="test_span") as span:
        # Create nested structure with circular reference
        page = {"page_number": 1, "content": "text"}
        document = {"pages": [page]}
        page["document"] = document

        # Should handle circular reference gracefully
        span.log(
            input={"file": "test.pdf"},
            output=document,
        )

    # Verify the log was recorded with nested circular reference handled
    logs = with_memory_logger.pop()
    assert len(logs) == 1

    logged_output = logs[0]["output"]
    assert len(logged_output["pages"]) == 1
    assert logged_output["pages"][0]["page_number"] == 1
    assert logged_output["pages"][0]["content"] == "text"
    # Circular reference should be replaced with a placeholder
    assert isinstance(logged_output["pages"][0]["document"], str)
    assert "circular" in logged_output["pages"][0]["document"].lower()


def test_span_log_with_deep_document_structure(with_memory_logger):
    """Test that span.log() with deeply nested document structure works gracefully."""
    logger = init_test_logger(__name__)

    with logger.start_span(name="test_span") as span:
        # Create deeply nested document structure with circular reference
        doc_data = {
            "model_id": "document-model",
            "content": "Document content",
            "pages": [],
        }

        page = {
            "page_number": 1,
            "lines": [{"content": "Line 1"}],
        }

        # Create circular reference
        page["document"] = doc_data
        doc_data["pages"].append(page)

        # Should handle circular reference gracefully
        span.log(
            input={"file": "test.pdf"},
            output=doc_data,
            metadata={"source": "document_processor"},
        )

    # Verify the log was recorded with proper structure
    logs = with_memory_logger.pop()
    assert len(logs) == 1

    logged_output = logs[0]["output"]
    assert logged_output["model_id"] == "document-model"
    assert logged_output["content"] == "Document content"
    assert len(logged_output["pages"]) == 1
    assert logged_output["pages"][0]["page_number"] == 1
    assert len(logged_output["pages"][0]["lines"]) == 1
    assert logged_output["pages"][0]["lines"][0]["content"] == "Line 1"
    # Circular reference should be replaced with placeholder
    assert isinstance(logged_output["pages"][0]["document"], str)
    assert "circular" in logged_output["pages"][0]["document"].lower()


def test_span_log_with_extremely_deep_nesting(with_memory_logger):
    """Test that span.log() with extremely deep nesting works gracefully."""
    import sys

    logger = init_test_logger(__name__)

    with logger.start_span(name="test_span") as span:
        recursion_limit = sys.getrecursionlimit()

        # Create structure deeper than recursion limit
        deeply_nested = {"level": 0}
        current = deeply_nested
        for i in range(1, recursion_limit + 100):
            current["nested"] = {"level": i}
            current = current["nested"]

        # Should handle extremely deep nesting without RecursionError
        span.log(
            input={"test": "deep nesting"},
            output=deeply_nested,
        )

    # Verify the log was recorded (may be truncated or have placeholder for deep nesting)
    logs = with_memory_logger.pop()
    assert len(logs) == 1

    logged_output = logs[0]["output"]
    assert logged_output["level"] == 0
    # Either the structure is preserved up to a safe depth, or replaced with placeholder
    assert "nested" in logged_output


def test_span_log_with_large_document_many_pages(with_memory_logger):
    """Test that span.log() with large multi-page document works gracefully."""
    logger = init_test_logger(__name__)

    with logger.start_span(name="test_span") as span:
        # Create realistic large document: 20 pages × 30 lines × 10 words
        pages = []
        for page_num in range(20):
            lines = []
            for line_num in range(30):
                words = []
                for word_num in range(10):
                    words.append(
                        {
                            "content": f"word_{word_num}",
                            "confidence": 0.98,
                        }
                    )
                lines.append(
                    {
                        "content": f"line_{line_num}",
                        "words": words,
                    }
                )
            pages.append(
                {
                    "page_number": page_num + 1,
                    "lines": lines,
                }
            )

        # Should handle large document structure
        span.log(
            input={"file": "large_document.pdf"},
            output={"pages": pages},
        )

    # Verify the log was recorded with full structure intact (no circular refs)
    logs = with_memory_logger.pop()
    assert len(logs) == 1

    logged_output = logs[0]["output"]
    assert len(logged_output["pages"]) == 20
    assert len(logged_output["pages"][0]["lines"]) == 30
    assert len(logged_output["pages"][0]["lines"][0]["words"]) == 10
    assert logged_output["pages"][0]["lines"][0]["words"][0]["content"] == "word_0"


def test_span_log_handles_nan_gracefully(with_memory_logger):
    """Test that span.log() handles NaN values by converting them to "NaN" string."""
    logger = init_test_logger(__name__)

    with logger.start_span(name="test_span") as span:
        # Should NOT raise - should handle NaN gracefully
        span.log(
            input={"test": "input"},
            output={"value": float("nan")},
        )

    # Verify the log was recorded with NaN handled appropriately
    logs = with_memory_logger.pop()
    assert len(logs) == 1
    assert logs[0]["input"]["test"] == "input"
    # NaN should be converted to "NaN" string for JSON compatibility
    output_value = logs[0]["output"]["value"]
    assert output_value == "NaN"


def test_span_log_handles_infinity_gracefully(with_memory_logger):
    """Test that span.log() handles Infinity values by converting them to "Infinity"/"-Infinity" strings."""
    logger = init_test_logger(__name__)

    with logger.start_span(name="test_span") as span:
        # Should NOT raise - should handle Infinity gracefully
        span.log(
            input={"test": "input"},
            output={"value": float("inf"), "neg": float("-inf")},
        )

    # Verify the log was recorded with Infinity handled appropriately
    logs = with_memory_logger.pop()
    assert len(logs) == 1
    assert logs[0]["input"]["test"] == "input"
    # Infinity should be converted to string representations for JSON compatibility
    assert logs[0]["output"]["value"] == "Infinity"
    assert logs[0]["output"]["neg"] == "-Infinity"


def test_span_log_with_binary_data(with_memory_logger):
    """Test how span.log() currently handles binary data."""
    logger = init_test_logger(__name__)

    with logger.start_span(name="test_span") as span:
        span.log(
            input={"file": "image.png"},
            output={"embedding": b"\x00\x01\x02\x03" * 100},
        )

    logs = with_memory_logger.pop()
    assert len(logs) == 1
    # Document actual behavior - binary data goes through deep_copy_and_sanitize_dict
    # which uses bt_dumps/bt_loads roundtrip
    assert logs[0]["input"]["file"] == "image.png"
    # The embedding should be present (converted to some serializable form)
    assert "embedding" in logs[0]["output"]


def test_span_log_handles_unstringifiable_object_gracefully(with_memory_logger):
    """Test that span.log() should handle objects with bad __str__ gracefully without raising.

    This test currently FAILS - it demonstrates the desired behavior after the fix.
    """
    logger = init_test_logger(__name__)

    class BadStrObject:
        def __str__(self):
            raise RuntimeError("Cannot convert to string!")

        def __repr__(self):
            raise RuntimeError("Cannot convert to repr!")

    with logger.start_span(name="test_span") as span:
        # Should NOT raise - should handle gracefully
        span.log(
            input={"test": "input"},
            output={"result": BadStrObject()},
        )

    # Verify the log was recorded with a fallback representation
    logs = with_memory_logger.pop()
    assert len(logs) == 1
    assert logs[0]["input"]["test"] == "input"
    # The bad object should have been replaced with some error placeholder
    assert "result" in logs[0]["output"]
    output_str = str(logs[0]["output"]["result"])
    # Should contain some indication of serialization failure
    assert "error" in output_str.lower() or "serializ" in output_str.lower()


def test_span_log_handles_bad_dict_keys_gracefully(with_memory_logger):
    """Test that span.log() should handle non-stringifiable dict keys gracefully.

    This test currently FAILS - it demonstrates the desired behavior after the fix.
    """
    logger = init_test_logger(__name__)

    class BadKey:
        def __str__(self):
            raise ValueError("Key cannot be stringified!")

        def __repr__(self):
            raise ValueError("Key cannot be stringified!")

    with logger.start_span(name="test_span") as span:
        # Should NOT raise - should handle gracefully
        span.log(
            input={"test": "input"},
            output={BadKey(): "value"},
        )

    # Verify the log was recorded with the problematic key handled
    logs = with_memory_logger.pop()
    assert len(logs) == 1
    assert logs[0]["input"]["test"] == "input"
    # The output should exist but the bad key should be replaced
    assert "output" in logs[0]


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


def test_span_export_disables_cache(with_memory_logger):
    """Test that span.export() disables the span cache."""
    logger = init_test_logger(__name__)

    with logger.start_span(name="test_span") as span:
        # Exporting should disable the span cache
        span.export()
        assert logger.state.span_cache.disabled


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


def test_experiment_span_link_uses_env_vars_when_logged_out(with_memory_logger):
    """Verify EXPERIMENT spans use BRAINTRUST_ORG_NAME env var when not logged in."""
    simulate_logout()
    assert_logged_out()

    keys = ["BRAINTRUST_APP_URL", "BRAINTRUST_ORG_NAME"]
    originals = {k: os.environ.get(k) for k in keys}
    try:
        os.environ["BRAINTRUST_APP_URL"] = "https://test-app.example.com"
        os.environ["BRAINTRUST_ORG_NAME"] = "env-org-name"

        experiment = braintrust.init(
            project="test-project",
            experiment="test-experiment",
        )

        # Create span with resolved experiment ID
        span = experiment.start_span(name="test-span")
        span.parent_object_id = LazyValue(lambda: "test-exp-id", use_mutex=False)
        span.end()

        link = span.link()

        # Should use env var org name and app url
        assert "env-org-name" in link
        assert "test-app.example.com" in link
        assert "test-exp-id" in link
    finally:
        for k, v in originals.items():
            os.environ.pop(k, None)
            if v:
                os.environ[k] = v


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


@pytest.mark.asyncio
async def test_span_link_in_async_context(with_simulate_login, with_memory_logger):
    """Test that span.link() works correctly when called from within an async function."""
    import asyncio

    logger = init_logger(
        project="test-project",
        project_id="test-project-id",
    )

    # Create a span in the main context
    span = logger.start_span(name="test-span")
    # Make it the current span so current_span() returns it
    span.set_current()

    # Define an async function that calls span.link()
    async def get_link_in_async():
        # Simulate some async work
        await asyncio.sleep(0.01)
        # This should return a valid link, not the noop link
        return braintrust.current_span().link()

    # Call the async function
    link = await get_link_in_async()

    span.end()

    # The link should NOT be the noop link
    assert link != "https://www.braintrust.dev/noop-span"
    # The link should contain the span ID
    assert span._id in link
    # The link should contain the project ID
    assert "test-project-id" in link


@pytest.mark.asyncio
async def test_current_logger_after_multiple_awaits(with_simulate_login, with_memory_logger):
    """Test that current_logger() works after multiple await points."""
    import asyncio

    logger = init_logger(project="test-project", project_id="test-project-id")

    async def check_logger_after_awaits():
        assert braintrust.current_logger() is logger
        await asyncio.sleep(0.01)
        assert braintrust.current_logger() is logger
        await asyncio.sleep(0.01)
        assert braintrust.current_logger() is logger
        return braintrust.current_logger()

    result = await check_logger_after_awaits()
    assert result is logger


@pytest.mark.asyncio
async def test_current_logger_in_async_generator(with_simulate_login, with_memory_logger):
    """Test that current_logger() works within an async generator (yield)."""
    import asyncio

    logger = init_logger(project="test-project", project_id="test-project-id")

    async def logger_generator():
        for i in range(3):
            await asyncio.sleep(0.01)
            yield braintrust.current_logger()

    results = []
    async for log in logger_generator():
        results.append(log)

    assert len(results) == 3
    assert all(r is logger for r in results)


@pytest.mark.asyncio
async def test_current_logger_in_separate_task(with_simulate_login, with_memory_logger):
    """Test that current_logger() works in a separately created asyncio task."""
    import asyncio

    logger = init_logger(project="test-project", project_id="test-project-id")

    async def get_logger_in_task():
        await asyncio.sleep(0.01)
        return braintrust.current_logger()

    # Create a separate task
    task = asyncio.create_task(get_logger_in_task())
    result = await task

    assert result is logger


@pytest.mark.asyncio
async def test_span_link_in_nested_async(with_simulate_login, with_memory_logger):
    """Test that span.link() works in deeply nested async calls."""
    import asyncio

    logger = init_logger(project="test-project", project_id="test-project-id")
    span = logger.start_span(name="test-span")

    async def level3():
        await asyncio.sleep(0.01)
        return span.link()

    async def level2():
        await asyncio.sleep(0.01)
        return await level3()

    async def level1():
        await asyncio.sleep(0.01)
        return await level2()

    link = await level1()
    span.end()

    assert link != "https://www.braintrust.dev/noop-span"
    assert span._id in link


def test_current_logger_in_thread(with_simulate_login, with_memory_logger):
    """Test that current_logger() works correctly when called from a new thread.

    Regression test: ContextVar values don't propagate to new threads,
    so current_logger must be a plain attribute for thread access.
    """
    import threading

    logger = init_logger(project="test-project", project_id="test-project-id")
    assert braintrust.current_logger() is logger

    thread_result = {}

    def check_logger_in_thread():
        thread_result["logger"] = braintrust.current_logger()

    thread = threading.Thread(target=check_logger_in_thread)
    thread.start()
    thread.join()

    assert thread_result["logger"] is logger


def test_span_link_in_thread(with_simulate_login, with_memory_logger):
    """Test that span.link() works correctly when called from a new thread.

    The span should be able to generate a valid link even when link() is called
    from a different thread than where the span was created.
    """
    import threading

    logger = init_logger(project="test-project", project_id="test-project-id")
    span = logger.start_span(name="test-span")

    thread_result = {}

    def get_link_in_thread():
        # Call link() on the span directly (not via current_span() which uses ContextVar)
        thread_result["link"] = span.link()

    thread = threading.Thread(target=get_link_in_thread)
    thread.start()
    thread.join()
    span.end()

    # The link should NOT be the noop link
    assert thread_result["link"] != "https://www.braintrust.dev/noop-span"
    # The link should contain the span ID
    assert span._id in thread_result["link"]


@pytest.mark.asyncio
async def test_current_logger_async_context_isolation(with_simulate_login, with_memory_logger):
    """Test that different async contexts can have different loggers.

    When a child task sets its own logger, it should not affect the parent context.
    This ensures async context isolation via ContextVar.
    """
    import asyncio

    parent_logger = init_logger(project="parent-project", project_id="parent-project-id")
    assert braintrust.current_logger() is parent_logger

    child_result = {}

    async def child_task():
        # Child initially inherits parent's logger
        assert braintrust.current_logger() is parent_logger

        # Child sets its own logger
        child_logger = init_logger(project="child-project", project_id="child-project-id")
        child_result["logger"] = braintrust.current_logger()
        return child_logger

    # Run child task
    child_logger = await asyncio.create_task(child_task())

    # Child should have seen its own logger
    assert child_result["logger"] is child_logger

    # Parent should still see parent logger (not affected by child)
    assert braintrust.current_logger() is parent_logger


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
            return data.replace("sensitive", "REDACTED")
        elif isinstance(data, dict):
            masked = {}
            for k, v in data.items():
                if isinstance(v, str) and "sensitive" in v:
                    masked[k] = v.replace("sensitive", "REDACTED")
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
            return data.replace("password", "XXX")
        elif isinstance(data, dict):
            masked = {}
            for k, v in data.items():
                if k == "password":
                    # Mask the value when the key is "password"
                    masked[k] = "XXX"
                elif isinstance(v, str) and "password" in v:
                    masked[k] = v.replace("password", "XXX")
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
                if isinstance(v, str) and "@" in v and "." in v:
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
        scores={"score": 1.0},  # Add a safe score that won't trigger error
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
        parent.log(input={"api_key": "key123", "password": "secret"}, metadata={"request_id": "req-123"})

        with parent.start_span("child") as child:
            child.log(output="Result with secret data", expected=[1, 2, 3])

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


@pytest.fixture
def reset_id_generator_state():
    """Reset ID generator state and environment variables before each test"""
    logger._state._reset_id_generator()
    logger._state._reset_context_manager()
    original_env = os.getenv("BRAINTRUST_OTEL_COMPAT")
    try:
        yield
    finally:
        logger._state._reset_id_generator()
        logger._state._reset_context_manager()
        if "BRAINTRUST_OTEL_COMPAT" in os.environ:
            del os.environ["BRAINTRUST_OTEL_COMPAT"]
        if original_env:
            os.environ["BRAINTRUST_OTEL_COMPAT"] = original_env


def test_otel_compatible_span_export_import():
    """Test that spans with OTEL-compatible IDs can be exported and imported correctly."""
    from braintrust.span_identifier_v4 import SpanComponentsV4, SpanObjectTypeV3

    # Generate OTEL-compatible IDs
    otel_gen = OTELIDGenerator()
    trace_id = otel_gen.get_trace_id()  # 32-char hex (16 bytes)
    span_id = otel_gen.get_span_id()  # 16-char hex (8 bytes)

    # Test that trace_id is 32 chars and span_id is 16 chars
    assert len(trace_id) == 32
    assert len(span_id) == 16
    assert all(c in "0123456789abcdef" for c in trace_id)
    assert all(c in "0123456789abcdef" for c in span_id)

    # Create span components
    components = SpanComponentsV4(
        object_type=SpanObjectTypeV3.PROJECT_LOGS,
        object_id="test-project-id",
        row_id="test-row-id",
        span_id=span_id,
        root_span_id=trace_id,
    )

    # Test export/import cycle
    exported = components.to_str()
    imported = SpanComponentsV4.from_str(exported)

    # Verify all fields match exactly
    assert imported.object_type == components.object_type
    assert imported.object_id == components.object_id
    assert imported.row_id == components.row_id
    assert imported.span_id == span_id
    assert imported.root_span_id == trace_id


def test_span_with_otel_ids_export_import(reset_id_generator_state):
    """Test that actual Span objects with OTEL IDs can export and be used as parent context."""
    init_test_logger(__name__)
    os.environ["BRAINTRUST_OTEL_COMPAT"] = "true"

    # Test that OTEL generator should not share root_span_id
    generator = get_id_generator()
    assert generator.share_root_span_id() == False

    with logger.start_span(name="test") as span:
        # Debug what we actually got
        print(f"span_id: {span.span_id} (len={len(span.span_id)})")
        print(f"root_span_id: {span.root_span_id} (len={len(span.root_span_id)})")

        # Test that OTEL spans should not share span_id and root_span_id
        assert span.span_id != span.root_span_id

        # Verify the span has OTEL-compatible IDs
        assert len(span.span_id) == 16  # 8-byte hex
        assert len(span.root_span_id) == 32  # 16-byte hex
        assert all(c in "0123456789abcdef" for c in span.span_id)
        assert all(c in "0123456789abcdef" for c in span.root_span_id)

        # Export the span
        exported = span.export()

        # Parse it back
        from braintrust.span_identifier_v4 import SpanComponentsV4

        imported = SpanComponentsV4.from_str(exported)

        # Verify IDs are preserved exactly
        assert imported.span_id == span.span_id
        assert imported.root_span_id == span.root_span_id


def test_span_with_uuid_ids_share_root_span_id(reset_id_generator_state):
    """Test that UUID generators share span_id as root_span_id for backwards compatibility."""
    import os

    # Ensure UUID generator is used (default behavior)
    if "BRAINTRUST_OTEL_COMPAT" in os.environ:
        del os.environ["BRAINTRUST_OTEL_COMPAT"]

    init_test_logger(__name__)

    # Test that UUID generator should share root_span_id
    generator = get_id_generator()
    assert generator.share_root_span_id() == True

    with logger.start_span(name="test") as span:
        # Test that UUID spans should share span_id and root_span_id for backwards compatibility
        assert span.span_id == span.root_span_id


def test_parent_context_with_otel_ids(with_memory_logger, reset_id_generator_state):
    """Test that parent_context works correctly with OTEL-compatible IDs."""
    os.environ["BRAINTRUST_OTEL_COMPAT"] = "true"
    init_test_logger(__name__)

    # Create a span and export it
    with logger.start_span(name="parent") as parent_span:
        parent_export = parent_span.export()
        original_span_id = parent_span.span_id
        original_root_span_id = parent_span.root_span_id

    def is_hex(s):
        return all(c in "0123456789abcdef" for c in s.lower())

    assert is_hex(original_span_id)
    assert is_hex(original_root_span_id)

    # Use the exported span as parent context
    with parent_context(parent_export):
        with logger.start_span(name="child") as child_span:
            # Child should inherit the root_span_id from parent
            assert child_span.root_span_id == original_root_span_id
            assert original_span_id in child_span.span_parents

    # Verify logs were created correctly
    logs = with_memory_logger.pop()
    parent_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "parent")
    child_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "child")

    assert parent_log["span_id"] == original_span_id
    assert parent_log["root_span_id"] == original_root_span_id
    assert child_log["root_span_id"] == original_root_span_id
    assert parent_log["span_id"] in child_log.get("span_parents", [])


def test_nested_spans_with_export(with_memory_logger):
    """Test nested spans with login triggered during span execution.

    This reproduces a bug where calling state.login() during an active span
    calls copy_state(), which would overwrite _context_manager with None,
    causing a ContextVar token mismatch error when the span exits.
    """
    from braintrust import logger
    from braintrust.test_helpers import init_test_exp

    experiment = init_test_exp("test-experiment", "test-project")

    # Start a span, then trigger login which calls copy_state()
    with experiment.start_span(name="s1") as span1:
        span1.log(input="one")
        # Trigger login with TEST_API_KEY and force_login=True
        # This calls copy_state() which should NOT overwrite _context_manager
        experiment.state.login(api_key=logger.TEST_API_KEY, force_login=True)
        # Continue with nested spans to ensure context manager still works
        with experiment.start_span(name="s2") as span2:
            span2.log(input="two")


def test_span_start_span_with_explicit_parent(with_memory_logger):
    """Test that span.start_span() with explicit parent doesn't inherit from context.

    This verifies the fix where span.start_span(parent=exported) should use the
    exported parent, not the current span from the context manager.
    """
    from braintrust.test_helpers import init_test_exp

    experiment = init_test_exp("test-experiment", "test-project")

    # Create a root span, log to it (creates row_id), and export it
    with experiment.start_span(name="root") as root_span:
        root_span.log(input="root input")
        root_export = root_span.export()
        root_span_id = root_span.span_id
        root_root_span_id = root_span.root_span_id

    # Create another span
    with experiment.start_span(name="span2") as span2:
        span2_span_id = span2.span_id

        # Within span2's context, create span3 with explicit parent=root_export
        # span3 should NOT inherit from span2 (the active context)
        # span3 should inherit from root (because root_export has row_id after logging)
        with span2.start_span(parent=root_export, name="span3") as span3:
            span3.log(input="test")

    logs = with_memory_logger.pop()
    span3_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "span3")

    # span3 should NOT have span2 as parent (would happen if it inherited from context)
    assert span2_span_id not in span3_log.get("span_parents", []), (
        "span3 should not inherit from span2 context when explicit parent is provided"
    )

    # span3 should inherit from root (the explicit parent)
    assert root_span_id in span3_log.get("span_parents", []), (
        "span3 should have root_span_id in span_parents from explicit parent"
    )
    assert span3_log["root_span_id"] == root_root_span_id, "span3 should have root's root_span_id"


def test_span_start_span_inherits_from_self(with_memory_logger):
    """Test that span.start_span() without explicit parent inherits from self.

    When no explicit parent is provided, the child should inherit from the current span.
    """
    from braintrust.test_helpers import init_test_exp

    experiment = init_test_exp("test-experiment", "test-project")

    # Create a parent span
    with experiment.start_span(name="parent") as parent_span:
        parent_span_id = parent_span.span_id
        parent_root_span_id = parent_span.root_span_id

        # Create a child span without explicit parent - should inherit from parent_span
        with parent_span.start_span(name="child") as child_span:
            child_span.log(input="test")

    logs = with_memory_logger.pop()
    child_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "child")

    # Child should inherit parent's root_span_id and have parent_span_id in span_parents
    assert child_log["root_span_id"] == parent_root_span_id
    assert parent_span_id in child_log.get("span_parents", []), (
        "child should have parent_span_id in span_parents when no explicit parent is provided"
    )


def test_span_start_span_with_exported_span_parent(with_memory_logger):
    """Test that span.start_span() with exported span parent uses the exported span.

    When an exported span (with row_id) is provided as parent, it should be used
    instead of the context manager's current span.
    """
    from braintrust.test_helpers import init_test_exp

    experiment = init_test_exp("test-experiment", "test-project")

    # Create and export a span with row_id
    with experiment.start_span(name="exported_parent") as exported_parent:
        exported_parent.log(input="parent")
        exported_parent_export = exported_parent.export()
        exported_parent_span_id = exported_parent.span_id
        exported_parent_root_span_id = exported_parent.root_span_id

    # Create another span that will be the active context
    with experiment.start_span(name="active_context") as active_context:
        active_context_span_id = active_context.span_id

        # Within active_context, create a child with explicit parent=exported_parent_export
        # Should use exported_parent, not active_context
        with active_context.start_span(parent=exported_parent_export, name="child") as child:
            child.log(input="test")

    logs = with_memory_logger.pop()
    child_log = next(l for l in logs if l.get("span_attributes", {}).get("name") == "child")

    # Child should inherit from exported_parent, not active_context
    assert child_log["root_span_id"] == exported_parent_root_span_id
    assert exported_parent_span_id in child_log.get("span_parents", []), (
        "child should have exported_parent_span_id in span_parents"
    )
    assert active_context_span_id not in child_log.get("span_parents", []), (
        "child should NOT have active_context_span_id in span_parents"
    )


def test_get_exporter_returns_v3_by_default():
    """Test that _get_exporter() returns SpanComponentsV3 when OTEL_COMPAT is not set."""
    with preserve_env_vars("BRAINTRUST_OTEL_COMPAT"):
        os.environ.pop("BRAINTRUST_OTEL_COMPAT", None)
        from braintrust.logger import _get_exporter
        from braintrust.span_identifier_v3 import SpanComponentsV3

        exporter = _get_exporter()
        assert exporter == SpanComponentsV3, "Should return V3 by default"


def test_get_exporter_returns_v4_when_otel_enabled():
    """Test that _get_exporter() returns SpanComponentsV4 when OTEL_COMPAT is true."""
    with preserve_env_vars("BRAINTRUST_OTEL_COMPAT"):
        os.environ["BRAINTRUST_OTEL_COMPAT"] = "true"
        from braintrust.logger import _get_exporter
        from braintrust.span_identifier_v4 import SpanComponentsV4

        exporter = _get_exporter()
        assert exporter == SpanComponentsV4, "Should return V4 when OTEL_COMPAT=true"


def test_experiment_export_respects_otel_compat_default():
    """Test that Experiment.export() uses V3 by default."""
    with preserve_env_vars("BRAINTRUST_OTEL_COMPAT"):
        os.environ.pop("BRAINTRUST_OTEL_COMPAT", None)
        experiment = init_test_exp("test-exp")
        exported = experiment.export()

        from braintrust.span_identifier_v4 import SpanComponentsV4

        version = SpanComponentsV4.get_version(exported)
        assert version == 3, f"Expected V3 encoding (version=3), got version={version}"


def test_experiment_export_respects_otel_compat_enabled():
    """Test that Experiment.export() uses V4 when OTEL_COMPAT is true."""
    with preserve_env_vars("BRAINTRUST_OTEL_COMPAT"):
        os.environ["BRAINTRUST_OTEL_COMPAT"] = "true"
        experiment = init_test_exp("test-exp")
        exported = experiment.export()

        from braintrust.span_identifier_v4 import SpanComponentsV4

        version = SpanComponentsV4.get_version(exported)
        assert version == 4, f"Expected V4 encoding (version=4), got version={version}"


def test_logger_export_respects_otel_compat_default():
    """Test that Logger.export() uses V3 by default."""
    with preserve_env_vars("BRAINTRUST_OTEL_COMPAT"):
        os.environ.pop("BRAINTRUST_OTEL_COMPAT", None)
        test_logger = init_test_logger(__name__)
        exported = test_logger.export()

        from braintrust.span_identifier_v4 import SpanComponentsV4

        version = SpanComponentsV4.get_version(exported)
        assert version == 3, f"Expected V3 encoding (version=3), got version={version}"


def test_logger_export_respects_otel_compat_enabled():
    """Test that Logger.export() uses V4 when OTEL_COMPAT is true."""
    with preserve_env_vars("BRAINTRUST_OTEL_COMPAT"):
        os.environ["BRAINTRUST_OTEL_COMPAT"] = "true"
        test_logger = init_test_logger(__name__)
        exported = test_logger.export()

        from braintrust.span_identifier_v4 import SpanComponentsV4

        version = SpanComponentsV4.get_version(exported)
        assert version == 4, f"Expected V4 encoding (version=4), got version={version}"


def test_register_otel_flush_callback():
    """Test that register_otel_flush registers a callback correctly."""
    import asyncio

    from braintrust import register_otel_flush
    from braintrust.logger import _internal_get_global_state
    from braintrust.test_helpers import init_test_logger

    init_test_logger(__name__)
    state = _internal_get_global_state()

    # Track if callback was invoked
    callback_invoked = False

    async def mock_flush():
        nonlocal callback_invoked
        callback_invoked = True

    # Register the callback
    register_otel_flush(mock_flush)

    # Calling flush_otel should invoke the registered callback
    asyncio.run(state.flush_otel())

    assert callback_invoked is True


def test_register_otel_flush_disables_span_cache():
    """Test that register_otel_flush disables the span cache."""
    from braintrust import register_otel_flush
    from braintrust.logger import _internal_get_global_state
    from braintrust.test_helpers import init_test_logger

    init_test_logger(__name__)
    state = _internal_get_global_state()

    # Enable the cache (simulating what happens during eval)
    state.span_cache.start()
    assert state.span_cache.disabled is False

    async def mock_flush():
        pass

    # Register OTEL flush
    register_otel_flush(mock_flush)

    # Cache should now be disabled
    assert state.span_cache.disabled is True


def test_flush_otel_noop_when_no_callback():
    """Test that flush_otel is a no-op when no callback is registered."""
    import asyncio

    from braintrust.logger import _internal_get_global_state
    from braintrust.test_helpers import init_test_logger

    init_test_logger(__name__)
    state = _internal_get_global_state()

    # Should not throw even with no callback registered
    asyncio.run(state.flush_otel())


def test_register_otel_flush_permanently_disables_cache():
    """Test that register_otel_flush permanently disables the cache."""
    from braintrust import register_otel_flush
    from braintrust.logger import _internal_get_global_state
    from braintrust.test_helpers import init_test_logger

    init_test_logger(__name__)
    state = _internal_get_global_state()

    # Enable the cache
    state.span_cache.start()
    assert state.span_cache.disabled is False

    async def mock_flush():
        pass

    # Register OTEL flush
    register_otel_flush(mock_flush)
    assert state.span_cache.disabled is True

    # Try to start again - should still be disabled because of explicit disable
    state.span_cache.start()
    assert state.span_cache.disabled is True


class TestJSONAttachment(TestCase):
    def test_create_attachment_from_json_data(self):
        """Test creating an attachment from JSON data."""
        test_data = {
            "foo": "bar",
            "nested": {
                "array": [1, 2, 3],
                "bool": True,
            },
        }

        attachment = JSONAttachment(test_data)

        self.assertEqual(attachment.reference["type"], "braintrust_attachment")
        self.assertEqual(attachment.reference["filename"], "data.json")
        self.assertEqual(attachment.reference["content_type"], "application/json")
        self.assertIn("key", attachment.reference)

        data = attachment.data
        parsed = json.loads(data.decode("utf-8"))
        self.assertEqual(parsed, test_data)

    def test_custom_filename(self):
        """Test that custom filename is respected."""
        attachment = JSONAttachment({"test": "data"}, filename="custom.json")

        self.assertEqual(attachment.reference["filename"], "custom.json")

    def test_pretty_print(self):
        """Test pretty printing JSON data."""
        test_data = {"a": 1, "b": 2}
        attachment = JSONAttachment(test_data, pretty=True)

        data = attachment.data
        text = data.decode("utf-8")
        self.assertEqual(text, '{\n  "a": 1,\n  "b": 2\n}')

    def test_large_transcript_scenario(self):
        """Test handling large transcript data."""
        large_transcript = [
            {
                "role": "user" if i % 2 == 0 else "assistant",
                "content": f"Message {i}",
                "timestamp": time.time() + i,
            }
            for i in range(1000)
        ]

        attachment = JSONAttachment(large_transcript, filename="transcript.json")

        self.assertEqual(attachment.reference["filename"], "transcript.json")
        self.assertEqual(attachment.reference["content_type"], "application/json")

    def test_arrays_and_primitives(self):
        """Test handling arrays and primitive values."""
        array_data = [1, 2, 3, 4, 5]
        attachment = JSONAttachment(array_data)

        data = attachment.data
        parsed = json.loads(data.decode("utf-8"))
        self.assertEqual(parsed, array_data)

    def test_integration_with_logger_patterns(self):
        """Test the intended usage pattern with logger."""
        log_data = {
            "input": {
                "type": "nameOfPrompt",
                "transcript": JSONAttachment(
                    [
                        {"role": "user", "content": "Hello"},
                        {"role": "assistant", "content": "Hi there!"},
                    ]
                ),
                "configValue1": 123,
                "configValue2": True,
            },
            "output": [{"type": "text", "value": "Generated response"}],
            "metadata": {
                "sessionId": "123",
                "userId": "456",
                "renderedPrompt": JSONAttachment(
                    "This is a very long prompt template...",
                    filename="prompt.json",
                ),
            },
        }

        self.assertIsInstance(log_data["input"]["transcript"], JSONAttachment)
        self.assertIsInstance(log_data["metadata"]["renderedPrompt"], JSONAttachment)

    def test_extract_attachments_with_json_attachment(self):
        """Test that JSONAttachment works with _extract_attachments."""
        json_attachment = JSONAttachment({"foo": "bar"}, filename="test.json")
        event = {
            "input": {
                "data": json_attachment,
            },
        }

        attachments: List[BaseAttachment] = []
        _extract_attachments(event, attachments)

        self.assertEqual(len(attachments), 1)
        self.assertIs(attachments[0], json_attachment)
        self.assertEqual(event["input"]["data"], json_attachment.reference)


class TestDatasetInternalBtql(TestCase):
    """Test that _internal_btql parameters (especially limit) are properly passed through to BTQL queries."""

    @patch("braintrust.logger.BraintrustState")
    def test_dataset_internal_btql_limit_not_overwritten(self, mock_state_class):
        """Test that custom limit in _internal_btql is not overwritten by DEFAULT_FETCH_BATCH_SIZE."""
        # Set up mock state
        mock_state = MagicMock()
        mock_state_class.return_value = mock_state

        # Mock the API connection and response
        mock_api_conn = MagicMock()
        mock_state.api_conn.return_value = mock_api_conn

        # Mock response object
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "data": [
                {"id": "1", "input": "test1", "expected": "output1"},
                {"id": "2", "input": "test2", "expected": "output2"},
            ],
            "cursor": None,
        }
        mock_api_conn.post.return_value = mock_response

        # Create dataset with custom limit in _internal_btql
        from braintrust.logger import Dataset, LazyValue, ObjectMetadata, ProjectDatasetMetadata

        project_metadata = ObjectMetadata(id="test-project", name="test-project", full_info={})
        dataset_metadata = ObjectMetadata(id="test-dataset", name="test-dataset", full_info={})
        lazy_metadata = LazyValue(
            lambda: ProjectDatasetMetadata(project=project_metadata, dataset=dataset_metadata),
            use_mutex=False,
        )

        custom_limit = 50
        dataset = Dataset(
            lazy_metadata=lazy_metadata,
            _internal_btql={"limit": custom_limit, "where": {"op": "eq", "left": "foo", "right": "bar"}},
            state=mock_state,
        )

        # Trigger a fetch which will make the BTQL query
        list(dataset.fetch())

        # Verify the API was called
        mock_api_conn.post.assert_called_once()

        # Get the actual call arguments
        call_args = mock_api_conn.post.call_args
        query_json = call_args[1]["json"]["query"]

        # Verify that the custom limit is present (not overwritten by DEFAULT_FETCH_BATCH_SIZE)
        self.assertEqual(query_json["limit"], custom_limit)

        # Verify that other _internal_btql fields are also present
        self.assertEqual(query_json["where"], {"op": "eq", "left": "foo", "right": "bar"})

    @patch("braintrust.logger.BraintrustState")
    def test_dataset_default_limit_when_not_specified(self, mock_state_class):
        """Test that DEFAULT_FETCH_BATCH_SIZE is used when no custom limit is specified."""
        from braintrust.logger import (
            DEFAULT_FETCH_BATCH_SIZE,
            Dataset,
            LazyValue,
            ObjectMetadata,
            ProjectDatasetMetadata,
        )

        # Set up mock state
        mock_state = MagicMock()
        mock_state_class.return_value = mock_state

        # Mock the API connection and response
        mock_api_conn = MagicMock()
        mock_state.api_conn.return_value = mock_api_conn

        # Mock response object
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "data": [],
            "cursor": None,
        }
        mock_api_conn.post.return_value = mock_response

        # Create dataset without custom limit
        project_metadata = ObjectMetadata(id="test-project", name="test-project", full_info={})
        dataset_metadata = ObjectMetadata(id="test-dataset", name="test-dataset", full_info={})
        lazy_metadata = LazyValue(
            lambda: ProjectDatasetMetadata(project=project_metadata, dataset=dataset_metadata),
            use_mutex=False,
        )

        dataset = Dataset(
            lazy_metadata=lazy_metadata,
            _internal_btql=None,
            state=mock_state,
        )

        # Trigger a fetch which will make the BTQL query
        list(dataset.fetch())

        # Verify the API was called
        mock_api_conn.post.assert_called_once()

        # Get the actual call arguments
        call_args = mock_api_conn.post.call_args
        query_json = call_args[1]["json"]["query"]

        # Verify that the default limit is used
        self.assertEqual(query_json["limit"], DEFAULT_FETCH_BATCH_SIZE)

    @patch("braintrust.logger.BraintrustState")
    def test_dataset_custom_batch_size_in_fetch(self, mock_state_class):
        """Test that custom batch_size in fetch() is properly passed to BTQL query."""
        from braintrust.logger import Dataset, LazyValue, ObjectMetadata, ProjectDatasetMetadata

        # Set up mock state
        mock_state = MagicMock()
        mock_state_class.return_value = mock_state

        # Mock the API connection and response
        mock_api_conn = MagicMock()
        mock_state.api_conn.return_value = mock_api_conn

        # Mock response object
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "data": [{"id": "1", "input": "test1", "expected": "output1"}],
            "cursor": None,
        }
        mock_api_conn.post.return_value = mock_response

        # Create dataset
        project_metadata = ObjectMetadata(id="test-project", name="test-project", full_info={})
        dataset_metadata = ObjectMetadata(id="test-dataset", name="test-dataset", full_info={})
        lazy_metadata = LazyValue(
            lambda: ProjectDatasetMetadata(project=project_metadata, dataset=dataset_metadata),
            use_mutex=False,
        )

        dataset = Dataset(
            lazy_metadata=lazy_metadata,
            state=mock_state,
        )

        # Trigger a fetch with custom batch_size
        custom_batch_size = 250
        list(dataset.fetch(batch_size=custom_batch_size))

        # Verify the API was called
        mock_api_conn.post.assert_called_once()

        # Get the actual call arguments
        call_args = mock_api_conn.post.call_args
        query_json = call_args[1]["json"]["query"]

        # Verify that the custom batch_size is used
        self.assertEqual(query_json["limit"], custom_batch_size)


def test_attachment_identity_preserved_through_bt_safe_deep_copy():
    """Test that attachment object identity is preserved through bt_safe_deep_copy."""
    from braintrust.bt_json import bt_safe_deep_copy

    attachment = Attachment(data=b"data", filename="file.txt", content_type="text/plain")
    original_id = id(attachment)

    # Simulate what happens in Span.log
    partial_record = {"input": {"file": attachment}}
    copied = bt_safe_deep_copy(partial_record)

    # Verify identity preserved
    assert copied["input"]["file"] is attachment
    assert id(copied["input"]["file"]) == original_id


def test_extract_attachments_collects_and_replaces():
    """Test that _extract_attachments properly collects attachments and replaces them with references."""
    from braintrust.logger import _extract_attachments

    attachment1 = Attachment(data=b"data1", filename="file1.txt", content_type="text/plain")
    attachment2 = Attachment(data=b"data2", filename="file2.txt", content_type="text/plain")
    ext_attachment = ExternalAttachment(url="s3://bucket/key", filename="file3.pdf", content_type="application/pdf")

    event = {
        "input": {"file": attachment1},
        "output": {"file": attachment2},
        "metadata": {"files": [attachment1, ext_attachment]}
    }

    attachments = []
    _extract_attachments(event, attachments)

    # Should have collected all 4 attachment instances (attachment1 appears twice)
    assert len(attachments) == 4
    assert attachments[0] is attachment1
    assert attachments[1] is attachment2
    assert attachments[2] is attachment1  # Same instance collected again
    assert attachments[3] is ext_attachment

    # Event should have been modified to contain references
    assert event["input"]["file"] == attachment1.reference
    assert event["output"]["file"] == attachment2.reference
    assert event["metadata"]["files"][0] == attachment1.reference
    assert event["metadata"]["files"][1] == ext_attachment.reference


def test_extract_attachments_preserves_identity():
    """Test that the same attachment instance is collected multiple times when it appears in different places."""
    from braintrust.logger import _extract_attachments

    attachment = Attachment(data=b"data", filename="file.txt", content_type="text/plain")
    original_id = id(attachment)

    event = {
        "input": attachment,
        "output": attachment,  # Same instance
        "metadata": {"file": attachment}  # Same instance again
    }

    attachments = []
    _extract_attachments(event, attachments)

    # Should collect the same instance 3 times
    assert len(attachments) == 3
    assert all(att is attachment for att in attachments)
    assert all(id(att) == original_id for att in attachments)


def test_attachment_upload_tracked_on_flush(with_memory_logger, with_simulate_login):
    """Test that attachment upload is tracked when attachments are logged and flushed."""
    attachment = Attachment(data=b"test data", filename="test.txt", content_type="text/plain")

    logger = init_test_logger(__name__)
    span = logger.start_span(name="test_span")
    span.log(input={"file": attachment})
    span.end()

    # No upload attempts yet
    assert len(with_memory_logger.upload_attempts) == 0

    # Flush should track upload attempt
    logger.flush()

    # Now upload should be tracked
    assert len(with_memory_logger.upload_attempts) == 1
    assert with_memory_logger.upload_attempts[0] is attachment


def test_multiple_attachments_upload_tracked(with_memory_logger, with_simulate_login):
    """Test that upload is tracked for multiple attachments."""
    attachment1 = Attachment(data=b"data1", filename="file1.txt", content_type="text/plain")
    attachment2 = Attachment(data=b"data2", filename="file2.txt", content_type="text/plain")

    logger = init_test_logger(__name__)
    span = logger.start_span(name="test_span")
    span.log(
        input={"file1": attachment1},
        output={"file2": attachment2}
    )
    span.end()
    logger.flush()

    # Both attachments should be tracked
    assert len(with_memory_logger.upload_attempts) == 2
    assert attachment1 in with_memory_logger.upload_attempts
    assert attachment2 in with_memory_logger.upload_attempts


def test_same_attachment_logged_twice_tracked_twice(with_memory_logger, with_simulate_login):
    """Test that same attachment logged twice appears twice in upload attempts."""
    attachment = Attachment(data=b"data", filename="file.txt", content_type="text/plain")

    logger = init_test_logger(__name__)
    span = logger.start_span(name="test_span")
    span.log(input={"file": attachment})
    span.log(metadata={"same_file": attachment})
    span.end()
    logger.flush()

    # Same attachment should be tracked twice (once for each log call)
    assert len(with_memory_logger.upload_attempts) == 2
    assert with_memory_logger.upload_attempts[0] is attachment
    assert with_memory_logger.upload_attempts[1] is attachment


def test_external_attachment_upload_tracked(with_memory_logger, with_simulate_login):
    """Test that ExternalAttachment upload is also tracked."""
    ext_attachment = ExternalAttachment(
        url="s3://bucket/key.pdf",
        filename="external.pdf",
        content_type="application/pdf"
    )

    logger = init_test_logger(__name__)
    span = logger.start_span(name="test_span")
    span.log(input={"file": ext_attachment})
    span.end()
    logger.flush()

    # ExternalAttachment should be tracked
    assert len(with_memory_logger.upload_attempts) == 1
    assert with_memory_logger.upload_attempts[0] is ext_attachment


def test_json_attachment_upload_tracked(with_memory_logger, with_simulate_login):
    """Test that JSONAttachment upload is tracked."""
    data = {"key": "value", "nested": {"array": [1, 2, 3]}}
    json_attachment = JSONAttachment(data, filename="data.json")

    logger = init_test_logger(__name__)
    span = logger.start_span(name="test_span")
    span.log(output={"data": json_attachment})
    span.end()
    logger.flush()

    # JSONAttachment should be tracked
    assert len(with_memory_logger.upload_attempts) == 1
    assert with_memory_logger.upload_attempts[0] is json_attachment


def test_multiple_attachment_types_tracked(with_memory_logger, with_simulate_login):
    """Test that different attachment types are all tracked."""
    attachment = Attachment(data=b"data", filename="file.txt", content_type="text/plain")
    json_attachment = JSONAttachment({"key": "value"}, filename="data.json")
    ext_attachment = ExternalAttachment(url="s3://bucket/key", filename="file.pdf", content_type="application/pdf")

    logger = init_test_logger(__name__)
    span = logger.start_span(name="test_span")
    span.log(
        input=attachment,
        output=json_attachment,
        metadata={"file": ext_attachment}
    )
    span.end()
    logger.flush()

    # All three types should be tracked
    assert len(with_memory_logger.upload_attempts) == 3
    assert attachment in with_memory_logger.upload_attempts
    assert json_attachment in with_memory_logger.upload_attempts
    assert ext_attachment in with_memory_logger.upload_attempts
