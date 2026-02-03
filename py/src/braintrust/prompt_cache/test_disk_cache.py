import os
import shutil
import tempfile
import time
import unittest
from typing import Any

from braintrust import prompt
from braintrust.prompt_cache import disk_cache


class TestDiskCache(unittest.TestCase):
    def setUp(self):
        self.cache_dir = tempfile.mkdtemp()
        self.cache = disk_cache.DiskCache[dict](
            cache_dir=self.cache_dir,
            max_size=3,
            log_warnings=False,
        )

    def tearDown(self):
        try:
            shutil.rmtree(self.cache_dir, ignore_errors=True)
        except Exception:
            pass

    def test_keys_with_invalid_paths(self):
        data = {"1": "2"}
        weird_keys = [
            ".",
            "..",
            "a/b/c",
            "my\0file.txt",
            "file*.txT",
            "what?.txt",
            " asdf ",
            "invalid/name",
            "my<file>.txt",
            "a\nb",
        ]
        for k in weird_keys:
            time.sleep(0.01)  # make sure the mtimes are different
            self.cache.set(k, data)
            result = self.cache.get(k)
            assert data == result

    def test_store_and_retrieve_values(self):
        test_data = {"foo": "bar"}
        self.cache.set("test-key", test_data)
        result = self.cache.get("test-key")
        self.assertEqual(result, test_data)

    def test_raise_keyerror_for_missing_keys(self):
        """Test raising KeyError for missing keys."""
        with self.assertRaises(KeyError) as cm:
            self.cache.get("missing-key")
        self.assertEqual(str(cm.exception), "'Cache key not found: missing-key'")

    def test_raise_keyerror_after_eviction(self):
        """Test that accessing evicted entries raises KeyError."""
        # Fill cache beyond max size (3).
        for i in range(3):
            self.cache.set(f"key{i}", {"value": i})
            time.sleep(0.01)  # wait to ensure different mtimes

        # Add one more to trigger eviction.
        self.cache.set("key3", {"value": 3})

        # The oldest entry should raise KeyError.
        with self.assertRaises(KeyError) as cm:
            self.cache.get("key0")
        self.assertEqual(str(cm.exception), "'Cache key not found: key0'")

    def test_evict_oldest_entries_when_cache_is_full(self):
        # Fill cache beyond max size (3).
        for i in range(3):
            self.cache.set(f"key{i}", {"value": i})
            time.sleep(0.01)  # wait to ensure different mtimes

        # Add one more to trigger eviction.
        self.cache.set("key3", {"value": 3})

        # The oldest entry should be evicted.
        with self.assertRaises(KeyError) as cm:
            self.cache.get("key0")
        self.assertEqual(str(cm.exception), "'Cache key not found: key0'")

        # Newer entries should still exist.
        newer = self.cache.get("key2")
        self.assertEqual(newer, {"value": 2})

    def test_dont_throw_when_write_fails(self):
        # Make cache directory read-only.
        non_existent_dir = os.path.join(self.cache_dir, "non-existent-dir")
        # Don't throw when writing fails.
        broken_cache = disk_cache.DiskCache[dict](
            cache_dir=non_existent_dir,
            max_size=3,
            log_warnings=False,
            mkdirs=False,
        )
        broken_cache.set("test", {"foo": "bar"})

        try:
            broken_cache.get("test")
        except KeyError:
            pass

    def test_dont_throw_when_read_fails(self):
        self.cache.set("test-key", {"foo": "bar"})
        assert self.cache.get("test-key") == {"foo": "bar"}

        # Make cache directory unreadable.
        shutil.rmtree(self.cache_dir)

        try:
            self.cache.get("test-key")
        except KeyError:
            pass
        else:
            assert False, "shouldn't fail"

    def test_throw_on_corrupted_data(self):
        self.cache.set("test-key", {"foo": "bar"})
        assert self.cache.get("test-key") == {"foo": "bar"}

        # Corrupt the file.
        file_path = self.cache._get_entry_path("test-key")
        with open(file_path, "w") as f:
            f.write("invalid data")

        # if the data is corrupted, pretend like its not cached
        try:
            self.cache.get("test-key")
        except KeyError:
            pass
        else:
            assert 0

        # we should be able to write and read again.
        self.cache.set("test-key", {"foo": "bar"})
        assert self.cache.get("test-key") == {"foo": "bar"}

    def test_store_and_retrieve_with_serialization(self):
        """Test storing and retrieving objects using custom serialization."""
        cache = disk_cache.DiskCache[prompt.PromptSchema](
            cache_dir=self.cache_dir,
            max_size=3,
            serializer=lambda x: x.as_dict(),
            deserializer=prompt.PromptSchema.from_dict_deep,
            log_warnings=False,
        )

        # Create a test prompt.
        test_prompt = prompt.PromptSchema(
            id="456",
            project_id="123",
            _xact_id="789",
            name="test-prompt",
            slug="test-prompt",
            description=None,
            prompt_data=prompt.PromptData(),
            tags=None,
        )

        # Store and retrieve.
        cache.set("test-key", test_prompt)
        result = cache.get("test-key")

        # Should get back a PromptSchema instance.
        self.assertIsInstance(result, prompt.PromptSchema)
        self.assertEqual(result.as_dict(), test_prompt.as_dict())

    def test_serializer_handles_complex_objects(self):
        """Test that serializer is used for complex nested objects."""
        cache = disk_cache.DiskCache[prompt.PromptSchema](
            cache_dir=self.cache_dir,
            serializer=lambda x: x.as_dict(),
            deserializer=prompt.PromptSchema.from_dict_deep,
            log_warnings=False,
        )

        # Create a prompt with nested data.
        test_prompt = prompt.PromptSchema(
            id="456",
            project_id="123",
            _xact_id="789",
            name="test-prompt",
            slug="test-prompt",
            description="test description",
            prompt_data=prompt.PromptData(
                prompt=prompt.PromptCompletionBlock(
                    content="test",
                )
            ),
            tags=["tag1", "tag2"],
        )

        # Store and retrieve.
        cache.set("test-key", test_prompt)
        result = cache.get("test-key")

        self.assertEqual(result.as_dict(), test_prompt.as_dict())

    def test_throw_on_deserializer_error(self):
        """Test that deserializer errors are propagated."""

        def bad_deserializer(data: Any) -> prompt.PromptSchema:
            raise ValueError("Deserialization failed")

        cache = disk_cache.DiskCache[prompt.PromptSchema](
            cache_dir=self.cache_dir, serializer=lambda x: x.as_dict(), deserializer=bad_deserializer
        )

        # Store a prompt.
        test_prompt = prompt.PromptSchema(
            id="456",
            project_id="123",
            _xact_id="789",
            name="test-prompt",
            slug="test-prompt",
            description=None,
            prompt_data=prompt.PromptData(),
            tags=None,
        )
        cache.set("test-key", test_prompt)

        # assert a serde error is treated like a cache miss.
        try:
            cache.get("test-key")
        except KeyError:
            pass
        else:
            assert False, "should fail"
