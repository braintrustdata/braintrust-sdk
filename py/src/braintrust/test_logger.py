from typing import List
from unittest import TestCase

import braintrust
from braintrust import Attachment, BaseAttachment, ExternalAttachment, LazyValue, Prompt
from braintrust.logger import _deep_copy_event, _extract_attachments
from braintrust.prompt import PromptChatBlock, PromptData, PromptMessage, PromptSchema


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
    assert span.permalink() == "https://braintrust.dev/noop-span"

    link = braintrust.permalink(span.export())
    assert link == "https://braintrust.dev/noop-span"
