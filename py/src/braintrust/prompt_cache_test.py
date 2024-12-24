import json
import os
import shutil
import tempfile
import time
import unittest
from typing import Dict

import braintrust

from .prompt import PromptData, PromptSchema
from .prompt_cache import PromptCache


class TestPromptCache(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory for each test.
        self.cache_dir = tempfile.mkdtemp()
        self.cache = PromptCache(self.cache_dir, max_size=5, memory_cache_max_size=2)
        self.test_prompt = PromptSchema(
            id="456",
            project_id="123",
            _xact_id="789",
            name="test-prompt",
            slug="test-prompt",
            description=None,
            prompt_data=PromptData(),
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

    def test_store_and_retrieve_from_disk_after_memory_eviction(self):
        # Fill memory cache (max size is 2).
        self.cache.set("test-prompt", "789", self.test_prompt, project_id="123")
        self.cache.set("prompt2", "789", self.test_prompt, project_id="123")
        self.cache.set("prompt3", "789", self.test_prompt, project_id="123")

        # Original prompt should now be on disk but not in memory.
        result = self.cache.get("test-prompt", version="789", project_id="123")
        self.assertEqual(result.as_dict(), self.test_prompt.as_dict())

    def test_return_none_for_nonexistent_prompts(self):
        with self.assertRaises(KeyError):
            self.cache.get("missing-prompt", version="789", project_id="123")

    def test_handle_different_projects_with_same_slug(self):
        self.cache.set("test-prompt", "789", self.test_prompt, project_id="123")

        different_prompt = PromptSchema.from_dict_deep(self.test_prompt.as_dict())
        different_prompt.project_id = "different-project"
        self.cache.set("test-prompt", "789", different_prompt, project_id="different-project")

        result1 = self.cache.get("test-prompt", version="789", project_id="123")
        result2 = self.cache.get("test-prompt", version="789", project_id="different-project")

        self.assertEqual(result1["project_id"], "123")
        self.assertEqual(result2["project_id"], "different-project")

    def test_throw_error_if_no_project_identifier(self):
        with self.assertRaisesRegex(ValueError, "Either project_id or project_name must be provided"):
            self.cache.get("test-prompt", version="789")

        with self.assertRaisesRegex(ValueError, "Either project_id or project_name must be provided"):
            self.cache.set("test-prompt", "789", self.test_prompt)

    def test_disk_cache_eviction(self):
        # Fill disk cache beyond max size (5).
        for i in range(5):
            self.cache.set(f"prompt{i}", "789", self.test_prompt, project_id="123")
            time.sleep(0.1)  # Ensure different mtimes.

        # Add one more to trigger eviction.
        self.cache.set("prompt-final", "789", self.test_prompt, project_id="123")

        # Oldest prompt should be evicted.
        with self.assertRaises(KeyError):
            self.cache.get("prompt0", version="789", project_id="123")

        # Newer prompts should still exist.
        result = self.cache.get("prompt4", version="789", project_id="123")
        self.assertEqual(result.as_dict(), self.test_prompt.as_dict())

    def test_memory_cache_behavior(self):
        # Fill memory cache (max size is 2).
        self.cache.set("test-prompt", "789", self.test_prompt, project_id="123")
        self.cache.set("prompt2", "789", self.test_prompt, project_id="123")

        # This should evict the first prompt from memory but keep it on disk.
        self.cache.set("prompt3", "789", self.test_prompt, project_id="123")

        # Should still be able to get the first prompt from disk.
        result = self.cache.get("test-prompt", version="789", project_id="123")
        self.assertEqual(result.as_dict(), self.test_prompt.as_dict())

    def test_update_memory_cache_after_disk_hit(self):
        self.cache.set("test-prompt", "789", self.test_prompt, project_id="123")

        # Create new cache instance (empty memory cache).
        new_cache = PromptCache(self.cache_dir, max_size=5, memory_cache_max_size=2)

        # First get should load from disk into memory.
        new_cache.get("test-prompt", version="789", project_id="123")

        # Remove the disk cache.
        shutil.rmtree(self.cache_dir)

        # Second get should still work (from memory).
        result = new_cache.get("test-prompt", version="789", project_id="123")
        self.assertEqual(result.as_dict(), self.test_prompt.as_dict())

    def test_handle_disk_write_errors(self):
        # Make cache directory read-only.
        os.chmod(self.cache_dir, 0o444)

        # Should not raise when disk write fails.
        try:
            self.cache.set("test-prompt", "789", self.test_prompt, project_id="123")
        except Exception as e:
            self.fail(f"set() raised {type(e).__name__} unexpectedly!")

    def test_handle_disk_read_errors(self):
        self.cache.set("test-prompt", "789", self.test_prompt, project_id="123")

        # Create new cache instance with empty memory cache.
        new_cache = PromptCache(self.cache_dir, max_size=5, memory_cache_max_size=2)

        # Remove the cache directory.
        shutil.rmtree(self.cache_dir)

        # Should raise KeyError when disk read fails.
        with self.assertRaises(KeyError):
            new_cache.get("test-prompt", version="789", project_id="123")

    def test_handle_different_versions_of_same_prompt(self):
        prompt_v1 = PromptSchema(
            id="456",
            project_id="123",
            _xact_id="789",
            name="test-prompt",
            slug="test-prompt",
            description=None,
            prompt_data=PromptData(),
            tags=None,
        )

        prompt_v2 = PromptSchema(
            id="457",
            project_id="123",
            _xact_id="790",
            name="test-prompt",
            slug="test-prompt",
            description=None,
            prompt_data=PromptData(),
            tags=None,
        )

        # Store both versions
        self.cache.set("test-prompt", "789", prompt_v1, project_id="123")
        self.cache.set("test-prompt", "790", prompt_v2, project_id="123")

        # Retrieve and verify both versions
        result_v1 = self.cache.get("test-prompt", version="789", project_id="123")
        result_v2 = self.cache.get("test-prompt", version="790", project_id="123")

        self.assertEqual(result_v1._xact_id, "789")
        self.assertEqual(result_v2._xact_id, "790")


if __name__ == "__main__":
    unittest.main()
