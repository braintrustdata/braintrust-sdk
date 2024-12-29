import os
import shutil
import tempfile
import unittest

from braintrust import prompt
from braintrust.prompt_cache import disk_cache, lru_cache, prompt_cache


class TestPromptCache(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory for each test
        self.cache_dir = tempfile.mkdtemp()
        mc = lru_cache.LRUCache[str, prompt.PromptSchema](max_size=2)
        dc = disk_cache.DiskCache[prompt.PromptSchema](
            cache_dir=self.cache_dir,
            max_size=5,
            serializer=lambda x: x.as_dict(),
            deserializer=prompt.PromptSchema.from_dict_deep,
        )
        self.cache = prompt_cache.PromptCache(memory_cache=mc, disk_cache=dc)

        self.test_prompt = prompt.PromptSchema(
            id="456",
            project_id="123",
            _xact_id="789",
            name="test-prompt",
            slug="test-prompt",
            description=None,
            prompt_data=prompt.PromptData(),
            tags=None,
        )

    def tearDown(self):
        # Clean up the temporary directory.
        try:
            shutil.rmtree(self.cache_dir, ignore_errors=True)
        except Exception:
            pass

    def test_store_and_retrieve_from_memory_cache(self):
        self.cache.set("test-prompt", "789", self.test_prompt, project_id="123")
        result = self.cache.get("test-prompt", version="789", project_id="123")
        self.assertEqual(result.as_dict(), self.test_prompt.as_dict())

    def test_work_with_project_name(self):
        self.cache.set("test-prompt", "789", self.test_prompt, project_name="test-project")
        result = self.cache.get("test-prompt", version="789", project_name="test-project")
        self.assertEqual(result.as_dict(), self.test_prompt.as_dict())

    def test_throw_error_if_no_project_identifier(self):
        with self.assertRaisesRegex(ValueError, "Either project_id or project_name must be provided"):
            self.cache.get("test-prompt", version="789")

        with self.assertRaisesRegex(ValueError, "Either project_id or project_name must be provided"):
            self.cache.set("test-prompt", "789", self.test_prompt)

    def test_store_and_retrieve_from_disk_after_memory_eviction(self):
        # Fill memory cache (max size is 2).
        self.cache.set("test-prompt", "789", self.test_prompt, project_id="123")
        self.cache.set("prompt2", "789", self.test_prompt, project_id="123")
        self.cache.set("prompt3", "789", self.test_prompt, project_id="123")

        # Original prompt should now be on disk but not in memory.
        result = self.cache.get("test-prompt", version="789", project_id="123")
        self.assertEqual(result.as_dict(), self.test_prompt.as_dict())

    def test_raise_for_nonexistent_prompts(self):
        with self.assertRaises(KeyError):
            self.cache.get("missing-prompt", version="789", project_id="123")

    def test_handle_different_projects_with_same_slug(self):
        self.cache.set("test-prompt", "789", self.test_prompt, project_id="123")

        different_prompt = prompt.PromptSchema.from_dict_deep(self.test_prompt.as_dict())
        different_prompt.project_id = "different-project"
        self.cache.set("test-prompt", "789", different_prompt, project_id="different-project")

        result1 = self.cache.get("test-prompt", version="789", project_id="123")
        result2 = self.cache.get("test-prompt", version="789", project_id="different-project")

        self.assertEqual(result1.project_id, "123")
        self.assertEqual(result2.project_id, "different-project")

    def test_memory_only_cache(self):
        memory_only_cache = prompt_cache.PromptCache(memory_cache=lru_cache.LRUCache(max_size=2))

        memory_only_cache.set("test-prompt", "789", self.test_prompt, project_id="123")
        result = memory_only_cache.get("test-prompt", version="789", project_id="123")
        self.assertEqual(result.as_dict(), self.test_prompt.as_dict())

        # Fill memory cache beyond capacity.
        memory_only_cache.set("prompt2", "789", self.test_prompt, project_id="123")
        memory_only_cache.set("prompt3", "789", self.test_prompt, project_id="123")

        # First prompt should be gone since there's no disk backup.
        with self.assertRaises(KeyError):
            memory_only_cache.get("test-prompt", version="789", project_id="123")

    def test_throw_when_disk_write_fails(self):
        # Make cache directory read-only.
        os.chmod(self.cache_dir, 0o444)

        # Should raise when disk write fails.
        with self.assertRaises(RuntimeError):
            self.cache.set("test-prompt", "789", self.test_prompt, project_id="123")

        # Memory cache should still be updated despite disk failure.
        result = self.cache.get("test-prompt", version="789", project_id="123")
        self.assertEqual(result.as_dict(), self.test_prompt.as_dict())

        # Restore permissions so cleanup can happen.
        os.chmod(self.cache_dir, 0o777)


if __name__ == "__main__":
    unittest.main()
