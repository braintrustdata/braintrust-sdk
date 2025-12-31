# pyright: reportUnknownVariableType=false
# pyright: reportUnknownArgumentType=false
# pyright: reportPrivateUsage=false
import json
from typing import Any
from unittest import TestCase

from braintrust.bt_json import json_safe_deep_copy, to_json_safe
from braintrust.logger import Attachment, ExternalAttachment, _check_json_serializable


class TestBTJson(TestCase):
    def testdeep_copy_event_basic(self):
        original = {
            "input": {"foo": "bar", "null": None, "empty": {}},
            "output": [1, 2, "3", None, {}],
        }
        copy = json_safe_deep_copy(original)
        self.assertEqual(copy, original)
        self.assertIsNot(copy, original)
        self.assertIsNot(copy["input"], original["input"])
        self.assertIsNot(copy["output"], original["output"])

    def test_deep_copy_mutation_independence(self):
        """Test that mutating the copy doesn't affect the original (true dereferencing)."""
        original = {
            "top_level": "value",
            "nested_dict": {"inner": "data", "deep": {"level": 3}},
            "nested_list": [1, 2, [3, 4]],
            "nested_in_list": [{"key": "val"}],
        }

        copy = json_safe_deep_copy(original)

        # Mutate the copy at various levels
        copy["top_level"] = "MODIFIED"
        copy["nested_dict"]["inner"] = "MODIFIED"
        copy["nested_dict"]["deep"]["level"] = 999
        copy["nested_list"][0] = 999
        copy["nested_list"][2][0] = 999
        copy["nested_in_list"][0]["key"] = "MODIFIED"

        # Verify original is unchanged
        self.assertEqual(original["top_level"], "value")
        self.assertEqual(original["nested_dict"]["inner"], "data")
        self.assertEqual(original["nested_dict"]["deep"]["level"], 3)
        self.assertEqual(original["nested_list"][0], 1)
        self.assertEqual(original["nested_list"][2][0], 3)
        self.assertEqual(original["nested_in_list"][0]["key"], "val")

        # Add new keys to copy
        copy["new_key"] = "new_value"
        copy["nested_dict"]["new_inner"] = "new"

        # Verify original doesn't have these keys
        self.assertNotIn("new_key", original)
        self.assertNotIn("new_inner", original["nested_dict"])

    def testdeep_copy_event_with_attachments(self):
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

        copy = json_safe_deep_copy(original)

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

    def test_check_json_serializable_catches_circular_references(self):
        """Test that _check_json_serializable properly handles circular references.

        After fix, _check_json_serializable should catch ValueError from circular
        references and convert them to a more appropriate exception or handle them.
        """
        # Create data with circular reference
        data: dict[str, Any] = {"a": "b"}
        data["self"] = data

        # Should either succeed (by handling circular refs) or raise a clear exception
        # The error message should indicate the data is not serializable
        try:
            result = _check_json_serializable(data)
            # If it succeeds, it should return a serialized string
            self.assertIsInstance(result, str)
        except Exception as e:
            # If it raises an exception, it should mention serialization issue
            error_msg = str(e).lower()
            self.assertTrue(
                "json-serializable" in error_msg or "circular" in error_msg,
                f"Expected error message to mention serialization issue, got: {e}",
            )

    def test_deep_copy_binary_types(self):
        """Test current handling of bytes, bytearray, memoryview through bt_dumps/bt_loads roundtrip."""
        data = {
            "bytes": b"hello world",
            "bytearray": bytearray(b"test data"),
            "memoryview": memoryview(b"memory"),
            "nested": {"embedded": b"\x00\x01\x02\x03"},
        }
        result = json_safe_deep_copy(data)

        # The function uses bt_dumps/bt_loads for non-container types, so binary
        # gets JSON-serialized. Check what actually comes back:
        self.assertIn("bytes", result)
        self.assertIn("bytearray", result)
        self.assertIn("memoryview", result)
        self.assertIn("nested", result)
        self.assertIn("embedded", result["nested"])

        # Verify it's JSON-serializable (main goal of the function)
        json_str = json.dumps(result)
        self.assertIsInstance(json_str, str)

    def test_deep_copy_frozenset(self):
        """Test current frozenset handling through JSON roundtrip."""
        data = {"frozen": frozenset([1, 2, 3])}
        result = json_safe_deep_copy(data)

        # frozenset goes through bt_dumps/bt_loads - it becomes a string representation
        # since frozenset is not JSON-serializable, bt_dumps converts it to str
        self.assertIn("frozen", result)
        self.assertIsInstance(result["frozen"], str)
        self.assertIn("frozenset", result["frozen"])

    def test_deep_copy_empty_containers(self):
        """Test handling of empty containers."""
        data = {
            "empty_list": [],
            "empty_dict": {},
            "empty_set": set(),
            "nested": {"also_empty": {}},
        }
        result = json_safe_deep_copy(data)

        self.assertEqual(result["empty_list"], [])
        self.assertEqual(result["empty_dict"], {})
        # empty set becomes empty list via JSON roundtrip
        self.assertEqual(result["empty_set"], [])
        self.assertEqual(result["nested"]["also_empty"], {})

    def test_deep_copy_exactly_max_depth(self):
        """Test behavior at exactly MAX_DEPTH (200)."""
        # Create nested structure at depth 199 (just under limit)
        nested = {"level": 0}
        current = nested
        for i in range(1, 199):
            current["child"] = {"level": i}
            current = current["child"]

        result = json_safe_deep_copy(nested)

        # Should succeed - verify structure is preserved
        self.assertEqual(result["level"], 0)
        self.assertIn("child", result)

        # Walk down and verify depth
        current_result = result
        depth_reached = 0
        while "child" in current_result:
            current_result = current_result["child"]
            depth_reached += 1
        self.assertEqual(depth_reached, 198)  # 199 levels total (0 to 198)

    def test_deep_copy_exceeds_max_depth(self):
        """Test behavior exceeding MAX_DEPTH (200)."""
        # Create nested structure at depth 201 (exceeds limit)
        nested = {"level": 0}
        current = nested
        for i in range(1, 201):
            current["child"] = {"level": i}
            current = current["child"]

        result = json_safe_deep_copy(nested)

        # Should have root level preserved
        self.assertEqual(result["level"], 0)

        # Walk down until we find the truncation marker
        current_result = result
        depth_reached = 0
        truncation_found = False
        while isinstance(current_result, dict) and "child" in current_result:
            current_result = current_result["child"]
            depth_reached += 1
            if current_result == "<max depth exceeded>":
                truncation_found = True
                break

        self.assertTrue(truncation_found, f"Expected truncation marker at depth {depth_reached}")
        self.assertLessEqual(depth_reached, 200)  # Should truncate at or before MAX_DEPTH

    def test_deep_copy_non_stringifiable_keys(self):
        """Test dict with keys that can't be converted to string."""

        class BadKey:
            def __str__(self):
                raise RuntimeError("Cannot stringify")

        data = {BadKey(): "value"}
        result = json_safe_deep_copy(data)

        # Should have fallback key from exception handler
        keys = list(result.keys())
        self.assertEqual(len(keys), 1)

        # The fallback should contain type name and indicate it's non-stringifiable
        key = keys[0]
        self.assertTrue("non-stringifiable" in key.lower() or "BadKey" in key)
        self.assertEqual(result[key], "value")

    def test_deep_copy_numeric_and_special_keys(self):
        """Test dict with various key types that need coercion."""
        data = {
            1: "int_key",
            2.5: "float_key",
            True: "bool_key",
            (1, 2): "tuple_key",
            None: "none_key",
        }
        result = json_safe_deep_copy(data)

        # All keys should be coerced to strings
        self.assertTrue(all(isinstance(k, str) for k in result.keys()))

        # Verify values are preserved
        # bool True coerces to "True", int 1 to "1" - they may conflict
        self.assertTrue("1" in result or "True" in result)
        self.assertIn("2.5", result)
        # tuple str representation
        self.assertTrue("(1, 2)" in result or "1, 2" in result)
        self.assertIn("None", result)

    def test_deep_copy_custom_sanitizer_failure(self):
        """Test behavior when custom sanitizer raises exceptions."""

        def bad_sanitizer(v):
            if isinstance(v, int) and v == 42:
                raise ValueError("The answer!")
            return v

        data = {"answer": 42, "other": 10}
        result = json_safe_deep_copy(data, to_json_safe=bad_sanitizer)

        # Exception should be caught and replaced with error marker
        answer_value = result["answer"]
        self.assertIsInstance(answer_value, str)
        self.assertTrue("non-sanitizable" in answer_value.lower() or "int" in answer_value.lower())

        # Other values should work fine
        self.assertEqual(result["other"], 10)

    def test_deep_copy_custom_sanitizer_success(self):
        """Test custom sanitizer working correctly."""

        def uppercase_strings(v):
            if isinstance(v, str):
                return v.upper()
            # Let default handler deal with everything else
            return to_json_safe(v)

        data = {
            "text": "hello",
            "nested": {"message": "world"},
            "number": 42,
        }
        result = json_safe_deep_copy(data, to_json_safe=uppercase_strings)

        # Strings should be uppercased
        self.assertEqual(result["text"], "HELLO")
        self.assertEqual(result["nested"]["message"], "WORLD")
        # Numbers should pass through
        self.assertEqual(result["number"], 42)
