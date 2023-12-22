import unittest

from braintrust.serialized_span_info import (
    SerializedSpanInfo,
    SpanExperimentIds,
    SpanParentRootSpanIds,
    SpanParentSubSpanIds,
    SpanProjectLogIds,
    serialized_span_info_from_string,
    serialized_span_info_to_string,
)


class TestSerializedSpanInfo(unittest.TestCase):
    def test_to_from_string(self):
        items = [
            SerializedSpanInfo(
                object_ids=SpanExperimentIds(project_id="abc", experiment_id="q"),
                span_parent_ids=SpanParentSubSpanIds(span_id="xyz", root_span_id="xxx"),
            ),
            SerializedSpanInfo(
                object_ids=SpanProjectLogIds(org_id="abc", project_id="def", log_id="g"),
                span_parent_ids=SpanParentSubSpanIds(span_id="xyz", root_span_id="xxx"),
            ),
            SerializedSpanInfo(
                object_ids=SpanExperimentIds(project_id="abc", experiment_id="q"),
                span_parent_ids=SpanParentRootSpanIds(span_id="zzz"),
            ),
            SerializedSpanInfo(
                object_ids=SpanExperimentIds(project_id="abc", experiment_id="q"), span_parent_ids=None
            ),
        ]

        for item in items:
            self.assertEqual(item, serialized_span_info_from_string(serialized_span_info_to_string(item)))
