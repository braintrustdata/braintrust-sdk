import time
import unittest
from unittest.mock import Mock

from braintrust.wrappers.genai import _aggregate_generate_content_chunks


class TestAggregateGenerateContentChunks(unittest.TestCase):
    def test_empty_chunks(self):
        """Test handling of empty chunks list."""
        start = time.time()
        result, metrics = _aggregate_generate_content_chunks([], start)

        self.assertEqual(result, {})
        self.assertIsNotNone(metrics)
        self.assertIn("start", metrics)
        self.assertIn("end", metrics)
        self.assertIn("duration", metrics)

    def test_text_aggregation(self):
        """Test aggregation of text parts from multiple chunks."""
        start = time.time()

        # Create mock chunks with text parts
        chunk1 = Mock()
        chunk1.candidates = [Mock()]
        chunk1.candidates[0].content = Mock()
        part1 = Mock()
        part1.text = "Hello "
        part1.thought = False
        chunk1.candidates[0].content.parts = [part1]
        chunk1.usage_metadata = None

        chunk2 = Mock()
        chunk2.candidates = [Mock()]
        chunk2.candidates[0].content = Mock()
        part2 = Mock()
        part2.text = "world!"
        part2.thought = False
        chunk2.candidates[0].content.parts = [part2]
        chunk2.candidates[0].finish_reason = "STOP"
        chunk2.usage_metadata = None

        chunks = [chunk1, chunk2]
        result, metrics = _aggregate_generate_content_chunks(chunks, start)

        # Check aggregated text
        self.assertIn("text", result)
        self.assertEqual(result["text"], "Hello world!")

        # Check candidates structure
        self.assertIn("candidates", result)
        self.assertEqual(len(result["candidates"]), 1)
        self.assertIn("content", result["candidates"][0])
        self.assertIn("parts", result["candidates"][0]["content"])

        # Check that text is combined in parts
        text_part = next((p for p in result["candidates"][0]["content"]["parts"] if "text" in p), None)
        self.assertIsNotNone(text_part)
        self.assertEqual(text_part["text"], "Hello world!")

    def test_thought_text_aggregation(self):
        """Test separate handling of thought text."""
        start = time.time()

        # Create mock chunks with both thought and regular text
        chunk1 = Mock()
        chunk1.candidates = [Mock()]
        chunk1.candidates[0].content = Mock()

        thought_part = Mock()
        thought_part.text = "Thinking about this..."
        thought_part.thought = True

        text_part = Mock()
        text_part.text = "Here's the answer."
        text_part.thought = False

        chunk1.candidates[0].content.parts = [thought_part, text_part]
        chunk1.candidates[0].finish_reason = "STOP"
        chunk1.usage_metadata = None

        chunks = [chunk1]
        result, metrics = _aggregate_generate_content_chunks(chunks, start)

        # Check that both thought and regular text are in parts
        self.assertIn("candidates", result)
        parts = result["candidates"][0]["content"]["parts"]
        self.assertEqual(len(parts), 2)

        # Thought text should come first with thought flag
        self.assertIn("thought", parts[0])
        self.assertTrue(parts[0]["thought"])
        self.assertEqual(parts[0]["text"], "Thinking about this...")

        # Regular text should come second without thought flag
        self.assertIn("text", parts[1])
        self.assertNotIn("thought", parts[1])
        self.assertEqual(parts[1]["text"], "Here's the answer.")

    def test_function_call_aggregation(self):
        """Test handling of function call parts."""
        start = time.time()

        chunk = Mock()
        chunk.candidates = [Mock()]
        chunk.candidates[0].content = Mock()

        func_part = Mock()
        func_part.function_call = {"name": "test_function", "args": {}}
        func_part.text = None

        chunk.candidates[0].content.parts = [func_part]
        chunk.candidates[0].finish_reason = "STOP"
        chunk.usage_metadata = None

        chunks = [chunk]
        result, metrics = _aggregate_generate_content_chunks(chunks, start)

        # Check that function call is preserved in parts
        self.assertIn("candidates", result)
        parts = result["candidates"][0]["content"]["parts"]
        self.assertEqual(len(parts), 1)
        self.assertIn("function_call", parts[0])
        self.assertEqual(parts[0]["function_call"], {"name": "test_function", "args": {}})

    def test_usage_metadata_extraction(self):
        """Test extraction of token metrics from usage metadata."""
        start = time.time()

        chunk = Mock()
        chunk.candidates = [Mock()]
        chunk.candidates[0].content = Mock()
        part = Mock()
        part.text = "Response"
        part.thought = False
        chunk.candidates[0].content.parts = [part]

        # Add usage metadata
        usage = Mock()
        usage.prompt_token_count = 10
        usage.candidates_token_count = 5
        usage.total_token_count = 15
        usage.cached_content_token_count = 2
        chunk.usage_metadata = usage

        chunks = [chunk]
        result, metrics = _aggregate_generate_content_chunks(chunks, start)

        # Check usage metadata is preserved
        self.assertIn("usage_metadata", result)
        self.assertEqual(result["usage_metadata"], usage)

        # Check metrics extraction
        self.assertEqual(metrics.get("prompt_tokens"), 10)
        self.assertEqual(metrics.get("completion_tokens"), 5)
        self.assertEqual(metrics.get("tokens"), 15)
        self.assertEqual(metrics.get("prompt_cached_tokens"), 2)

    def test_mixed_content_types(self):
        """Test handling of mixed content types in a single response."""
        start = time.time()

        chunk = Mock()
        chunk.candidates = [Mock()]
        chunk.candidates[0].content = Mock()

        text_part = Mock()
        text_part.text = "Here's the result:"
        text_part.thought = False

        code_part = Mock()
        code_part.executable_code = {"code": "print('hello')"}
        code_part.text = None

        result_part = Mock()
        result_part.code_execution_result = {"output": "hello"}
        result_part.text = None

        chunk.candidates[0].content.parts = [text_part, code_part, result_part]
        chunk.candidates[0].finish_reason = "STOP"
        chunk.usage_metadata = None

        chunks = [chunk]
        result, metrics = _aggregate_generate_content_chunks(chunks, start)

        # Check all parts are preserved
        self.assertIn("candidates", result)
        parts = result["candidates"][0]["content"]["parts"]
        self.assertEqual(len(parts), 3)

        # Text part
        self.assertIn("text", parts[0])
        self.assertEqual(parts[0]["text"], "Here's the result:")

        # Code part
        self.assertIn("executable_code", parts[1])
        self.assertEqual(parts[1]["executable_code"], {"code": "print('hello')"})

        # Result part
        self.assertIn("code_execution_result", parts[2])
        self.assertEqual(parts[2]["code_execution_result"], {"output": "hello"})

    def test_metadata_preservation(self):
        """Test that candidate metadata is preserved."""
        start = time.time()

        chunk = Mock()
        chunk.candidates = [Mock()]
        chunk.candidates[0].content = Mock()
        part = Mock()
        part.text = "Response"
        part.thought = False
        chunk.candidates[0].content.parts = [part]
        chunk.candidates[0].finish_reason = "MAX_TOKENS"
        chunk.candidates[0].safety_ratings = [{"category": "HARM", "probability": "LOW"}]
        chunk.usage_metadata = None

        chunks = [chunk]
        result, metrics = _aggregate_generate_content_chunks(chunks, start)

        # Check metadata preservation
        self.assertIn("candidates", result)
        candidate = result["candidates"][0]
        self.assertIn("finish_reason", candidate)
        self.assertEqual(candidate["finish_reason"], "MAX_TOKENS")
        self.assertIn("safety_ratings", candidate)
        self.assertEqual(candidate["safety_ratings"], [{"category": "HARM", "probability": "LOW"}])


if __name__ == "__main__":
    unittest.main()
