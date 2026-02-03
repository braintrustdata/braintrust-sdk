# pyright: reportUnknownVariableType=false
# pyright: reportUnknownArgumentType=false
# pyright: reportPrivateUsage=false
import json
from typing import Any
from unittest import TestCase

import pytest
from braintrust.bt_json import bt_dumps, bt_safe_deep_copy
from braintrust.logger import Attachment, ExternalAttachment


class TestBTJson(TestCase):
    def testdeep_copy_event_basic(self):
        original = {
            "input": {"foo": "bar", "null": None, "empty": {}},
            "output": [1, 2, "3", None, {}],
        }
        copy = bt_safe_deep_copy(original)
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

        copy = bt_safe_deep_copy(original)

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

        copy = bt_safe_deep_copy(original)

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

    def test_bt_dumps_circular_references_raises(self):
        """Test that bt_dumps raises on circular references in raw data.

        Note: bt_dumps without bt_safe_deep_copy will raise ValueError on circular refs.
        Use bt_safe_deep_copy first to handle circular references gracefully.
        """
        data: dict[str, Any] = {"a": "b"}
        data["self"] = data

        with self.assertRaises(ValueError) as ctx:
            bt_dumps(data)
        self.assertIn("Circular reference", str(ctx.exception))

    def test_deep_copy_binary_types(self):
        """Test current handling of bytes, bytearray, memoryview through bt_dumps/bt_loads roundtrip."""
        data = {
            "bytes": b"hello world",
            "bytearray": bytearray(b"test data"),
            "memoryview": memoryview(b"memory"),
            "nested": {"embedded": b"\x00\x01\x02\x03"},
        }
        result = bt_safe_deep_copy(data)

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
        result = bt_safe_deep_copy(data)

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
        result = bt_safe_deep_copy(data)

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

        result = bt_safe_deep_copy(nested)

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

        result = bt_safe_deep_copy(nested)

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
        result = bt_safe_deep_copy(data)

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
        result = bt_safe_deep_copy(data)

        # All keys should be coerced to strings
        self.assertTrue(all(isinstance(k, str) for k in result.keys()))

        # Verify values are preserved
        # bool True coerces to "True", int 1 to "1" - they may conflict
        self.assertTrue("1" in result or "True" in result)
        self.assertIn("2.5", result)
        # tuple str representation
        self.assertTrue("(1, 2)" in result or "1, 2" in result)
        self.assertIn("None", result)

@pytest.mark.vcr
def test_to_bt_safe_special_objects():
    """Test _to_bt_safe handling of Span, Experiment, Dataset, Logger objects."""
    from braintrust import init, init_dataset, init_logger

    # Create actual objects
    exp = init(project="test", experiment="test")
    dataset = init_dataset(project="test", name="test")
    logger = init_logger(project="test")
    span = exp.start_span()

    # Import _to_bt_safe
    from braintrust.bt_json import _to_bt_safe

    # Test each special object
    assert _to_bt_safe(span) == "<span>"
    assert _to_bt_safe(exp) == "<experiment>"
    assert _to_bt_safe(dataset) == "<dataset>"
    assert _to_bt_safe(logger) == "<logger>"


class TestBTJsonAttachments(TestCase):
    def test_to_bt_safe_attachments(self):
        """Test _to_bt_safe preserves BaseAttachment and converts ReadonlyAttachment to reference."""
        from braintrust.bt_json import _to_bt_safe

        # Test BaseAttachment preservation
        attachment = Attachment(data=b"test", filename="test.txt", content_type="text/plain")
        result = _to_bt_safe(attachment)
        self.assertIs(result, attachment)

        # Test ExternalAttachment preservation
        ext_attachment = ExternalAttachment(
            url="s3://bucket/key", filename="ext.pdf", content_type="application/pdf"
        )
        result_ext = _to_bt_safe(ext_attachment)
        self.assertIs(result_ext, ext_attachment)

        # Test ReadonlyAttachment conversion to reference
        from braintrust.logger import ReadonlyAttachment

        reference = {
            "type": "braintrust_attachment",
            "key": "test-key",
            "filename": "readonly.txt",
            "content_type": "text/plain",
        }
        readonly = ReadonlyAttachment(reference)
        result_readonly = _to_bt_safe(readonly)
        self.assertEqual(result_readonly, reference)
        self.assertIsNot(result_readonly, readonly)

    def test_to_bt_safe_pydantic_models(self):
        """Test _to_bt_safe handling of Pydantic v1 and v2 models."""
        from braintrust.bt_json import _to_bt_safe

        try:
            from pydantic import BaseModel

            class TestModel(BaseModel):
                name: str
                value: int

            model = TestModel(name="test", value=42)
            result = _to_bt_safe(model)

            # Should convert to dict
            self.assertIsInstance(result, dict)
            self.assertEqual(result["name"], "test")
            self.assertEqual(result["value"], 42)
        except ImportError:
            self.skipTest("Pydantic not available")

    def test_to_bt_safe_dataclasses(self):
        """Test _to_bt_safe handling of dataclasses with attachment fields."""
        from dataclasses import dataclass

        from braintrust.bt_json import _to_bt_safe

        @dataclass
        class SimpleData:
            text: str
            number: int

        @dataclass
        class DataWithAttachment:
            name: str
            file: Attachment

        # Test simple dataclass
        simple = SimpleData(text="hello", number=123)
        result = _to_bt_safe(simple)
        self.assertIsInstance(result, dict)
        self.assertEqual(result["text"], "hello")
        self.assertEqual(result["number"], 123)

        # Test dataclass with attachment field
        attachment = Attachment(data=b"data", filename="file.txt", content_type="text/plain")
        with_attachment = DataWithAttachment(name="test", file=attachment)
        result_with_att = _to_bt_safe(with_attachment)

        self.assertIsInstance(result_with_att, dict)
        self.assertEqual(result_with_att["name"], "test")
        # The attachment should be preserved in the dict
        self.assertIs(result_with_att["file"], attachment)

    def test_to_bt_safe_special_floats(self):
        """Test _to_bt_safe handling of NaN, Infinity, -Infinity."""
        from braintrust.bt_json import _to_bt_safe

        self.assertEqual(_to_bt_safe(float("nan")), "NaN")
        self.assertEqual(_to_bt_safe(float("inf")), "Infinity")
        self.assertEqual(_to_bt_safe(float("-inf")), "-Infinity")
        self.assertEqual(_to_bt_safe(1.5), 1.5)
        self.assertEqual(_to_bt_safe(0.0), 0.0)

    def test_to_bt_safe_fallback_exceptions(self):
        """Test _to_bt_safe graceful handling when serialization fails in bt_safe_deep_copy."""

        class UnserializableObject:
            def __init__(self):
                self.data = "test"

        obj = UnserializableObject()

        # When called through bt_safe_deep_copy, exceptions are caught
        result = bt_safe_deep_copy({"key": obj})

        # The object should be in the result (after roundtrip through bt_dumps/bt_loads)
        self.assertIn("key", result)
        # The value might be stringified or converted depending on fallback behavior
        self.assertIsNotNone(result["key"])

    def test_bt_safe_deep_copy_attachment_identity(self):
        """Test bt_safe_deep_copy preserves attachment object identity."""
        attachment1 = Attachment(data=b"data1", filename="file1.txt", content_type="text/plain")
        attachment2 = ExternalAttachment(
            url="s3://bucket/key", filename="file2.pdf", content_type="application/pdf"
        )

        original = {
            "field1": attachment1,
            "nested": {"field2": attachment2},
            "list": [attachment1, "string", attachment2],
        }

        result = bt_safe_deep_copy(original)

        # Verify attachment identity is preserved (same object)
        self.assertIs(result["field1"], attachment1)
        self.assertIs(result["nested"]["field2"], attachment2)
        self.assertIs(result["list"][0], attachment1)
        self.assertIs(result["list"][2], attachment2)

        # But container objects are copied
        self.assertIsNot(result, original)
        self.assertIsNot(result["nested"], original["nested"])
        self.assertIsNot(result["list"], original["list"])

    def test_bt_safe_deep_copy_mixed_attachment_types(self):
        """Test bt_safe_deep_copy with BaseAttachment and ReadonlyAttachment together."""
        from braintrust.logger import ReadonlyAttachment

        base_attachment = Attachment(data=b"base", filename="base.txt", content_type="text/plain")

        reference = {
            "type": "braintrust_attachment",
            "key": "readonly-key",
            "filename": "readonly.txt",
            "content_type": "text/plain",
        }
        readonly_attachment = ReadonlyAttachment(reference)

        original = {
            "base": base_attachment,
            "readonly": readonly_attachment,
            "mixed_list": [base_attachment, readonly_attachment],
        }

        result = bt_safe_deep_copy(original)

        # BaseAttachment preserved as-is
        self.assertIs(result["base"], base_attachment)
        self.assertIs(result["mixed_list"][0], base_attachment)

        # ReadonlyAttachment converted to reference dict
        self.assertEqual(result["readonly"], reference)
        self.assertIsInstance(result["readonly"], dict)
        self.assertEqual(result["mixed_list"][1], reference)

    def test_bt_safe_deep_copy_circular_with_attachments(self):
        """Test circular reference detection with attachments in the structure."""
        attachment = Attachment(data=b"data", filename="file.txt", content_type="text/plain")

        # Create circular structure with attachment
        circular: dict[str, Any] = {"attachment": attachment, "data": "test"}
        circular["self"] = circular

        result = bt_safe_deep_copy(circular)

        # Attachment should be preserved
        self.assertIs(result["attachment"], attachment)
        self.assertEqual(result["data"], "test")

        # Circular reference should be detected
        self.assertEqual(result["self"], "<circular reference>")

    def test_bt_safe_deep_copy_containers_with_attachments(self):
        """Test tuple, set, and nested containers with attachments."""
        attachment = Attachment(data=b"data", filename="file.txt", content_type="text/plain")

        original = {
            "tuple_with_attachment": (attachment, "string", 123),
            "set_with_attachment": {attachment, "value"},
            "nested": {"inner_tuple": (1, 2, attachment)},
        }

        result = bt_safe_deep_copy(original)

        # Tuples and sets are converted to lists
        self.assertIsInstance(result["tuple_with_attachment"], list)
        self.assertIsInstance(result["set_with_attachment"], list)

        # Attachment preserved in converted list
        self.assertIs(result["tuple_with_attachment"][0], attachment)
        self.assertIn(attachment, result["set_with_attachment"])

        # Nested tuple also converted
        self.assertIsInstance(result["nested"]["inner_tuple"], list)
        self.assertIs(result["nested"]["inner_tuple"][2], attachment)

    def test_bt_safe_deep_copy_pydantic_with_attachments(self):
        """Test Pydantic model with attachment field."""
        try:
            from pydantic import BaseModel

            attachment = Attachment(data=b"data", filename="file.txt", content_type="text/plain")

            class ModelWithAttachment(BaseModel):
                name: str
                file: Any  # Pydantic doesn't have built-in type for our Attachment

            model = ModelWithAttachment(name="test", file=attachment)

            result = bt_safe_deep_copy(model)

            # Model should be converted to dict
            self.assertIsInstance(result, dict)
            self.assertEqual(result["name"], "test")

            # Attachment should be preserved
            self.assertIs(result["file"], attachment)
        except ImportError:
            self.skipTest("Pydantic not available")

    def test_bt_safe_deep_copy_dataclass_with_attachments(self):
        """Test that dataclasses with attachments are handled correctly."""
        from dataclasses import dataclass

        attachment = Attachment(data=b"data", filename="file.txt", content_type="text/plain")

        @dataclass
        class DataWithAttachment:
            name: str
            value: int
            file: Attachment

        data = DataWithAttachment(name="test", value=42, file=attachment)

        result = bt_safe_deep_copy({"data": data})

        # Dataclasses with Attachment fields are now properly converted by
        # recursively applying _to_bt_safe to each field instead of using
        # dataclasses.asdict() which would try to deepcopy the Attachment.
        self.assertIsInstance(result["data"], dict)
        self.assertEqual(result["data"]["name"], "test")
        self.assertEqual(result["data"]["value"], 42)
        self.assertIs(result["data"]["file"], attachment)

        # Attachments in regular dicts also work fine
        dict_with_attachment = {"name": "test", "value": 42, "file": attachment}
        result2 = bt_safe_deep_copy({"data": dict_with_attachment})
        self.assertIsInstance(result2["data"], dict)
        self.assertIs(result2["data"]["file"], attachment)

    def test_bt_safe_deep_copy_circular_in_pydantic_deferred_to_bt_dumps(self):
        """Test that circular references inside Pydantic model results bypass bt_safe_deep_copy detection.

        Current behavior: model_dump() preserves the circular structure (with different object
        identity). bt_safe_deep_copy passes it through, and bt_dumps catches it at serialization.
        This differs from plain dicts where circular refs are caught and replaced with
        '<circular reference>'.
        """
        try:
            from pydantic import BaseModel
        except ImportError:
            self.skipTest("Pydantic not available")

        class ModelWithObject(BaseModel):
            data: object
            model_config = {"arbitrary_types_allowed": True}

        circular: dict[str, Any] = {"value": 1}
        circular["self"] = circular

        model = ModelWithObject(data=circular)

        # bt_safe_deep_copy passes through the circular structure from model_dump()
        result = bt_safe_deep_copy({"model": model})
        self.assertIsInstance(result["model"], dict)
        # model_dump() preserves circular structure but NOT object identity
        self.assertIsInstance(result["model"]["data"]["self"], dict)
        self.assertEqual(result["model"]["data"]["self"]["value"], 1)

        # bt_dumps catches the circular reference at serialization time
        with self.assertRaises(ValueError) as ctx:
            bt_dumps(result)
        self.assertIn("Circular reference", str(ctx.exception))

    def test_bt_safe_deep_copy_pydantic_with_attachment_field(self):
        """Test Pydantic model with a Braintrust Attachment field.

        Pydantic models with Attachment fields should work correctly through
        bt_safe_deep_copy, with the Attachment object preserved.
        """
        try:
            from pydantic import BaseModel
        except ImportError:
            self.skipTest("Pydantic not available")

        attachment = Attachment(data=b"data", filename="file.txt", content_type="text/plain")

        class ModelWithAttachment(BaseModel):
            name: str
            file: object
            model_config = {"arbitrary_types_allowed": True}

        model = ModelWithAttachment(name="test", file=attachment)

        result = bt_safe_deep_copy({"model": model})

        self.assertIsInstance(result["model"], dict)
        self.assertEqual(result["model"]["name"], "test")
        # Attachment should be preserved through model_dump()
        self.assertIs(result["model"]["file"], attachment)

    def test_bt_safe_deep_copy_circular_in_plain_dict_is_caught(self):
        """Contrast test: circular references in plain dicts ARE caught by bt_safe_deep_copy."""
        circular: dict[str, Any] = {"value": 1}
        circular["self"] = circular

        result = bt_safe_deep_copy({"data": circular})

        # Circular reference IS detected and replaced
        self.assertEqual(result["data"]["self"], "<circular reference>")

        # bt_dumps succeeds because the circular ref was sanitized
        json_str = bt_dumps(result)
        self.assertIn("<circular reference>", json_str)
