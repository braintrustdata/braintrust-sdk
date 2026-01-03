import json
import unittest

from .score import Score


class TestScore(unittest.TestCase):
    def test_as_dict_includes_all_required_fields(self):
        """Test that as_dict() includes name, score, and metadata fields."""
        score = Score(name="test_scorer", score=0.85, metadata={"key": "value"})
        result = score.as_dict()

        self.assertIn("name", result)
        self.assertIn("score", result)
        self.assertIn("metadata", result)

        self.assertEqual(result["name"], "test_scorer")
        self.assertEqual(result["score"], 0.85)
        self.assertEqual(result["metadata"], {"key": "value"})

    def test_as_dict_with_null_score(self):
        """Test that as_dict() works correctly with null score."""
        score = Score(name="null_scorer", score=None, metadata={})
        result = score.as_dict()

        self.assertEqual(result["name"], "null_scorer")
        self.assertIsNone(result["score"])
        self.assertEqual(result["metadata"], {})

    def test_as_dict_with_empty_metadata(self):
        """Test that as_dict() works correctly with empty metadata."""
        score = Score(name="empty_metadata_scorer", score=1.0)
        result = score.as_dict()

        self.assertEqual(result["name"], "empty_metadata_scorer")
        self.assertEqual(result["score"], 1.0)
        self.assertEqual(result["metadata"], {})

    def test_as_dict_with_complex_metadata(self):
        """Test that as_dict() works correctly with complex nested metadata."""
        complex_metadata = {
            "reason": "Test reason",
            "details": {"nested": {"deeply": "value"}},
            "list": [1, 2, 3],
            "bool": True,
        }
        score = Score(name="complex_scorer", score=0.5, metadata=complex_metadata)
        result = score.as_dict()

        self.assertEqual(result["name"], "complex_scorer")
        self.assertEqual(result["score"], 0.5)
        self.assertEqual(result["metadata"], complex_metadata)

    def test_as_json_serialization(self):
        """Test that as_json() produces valid JSON string."""
        score = Score(name="json_scorer", score=0.75, metadata={"test": "data"})
        json_str = score.as_json()

        # Should be valid JSON
        parsed = json.loads(json_str)

        self.assertEqual(parsed["name"], "json_scorer")
        self.assertEqual(parsed["score"], 0.75)
        self.assertEqual(parsed["metadata"], {"test": "data"})

    def test_from_dict_round_trip(self):
        """Test that Score can be serialized to dict and deserialized back."""
        original = Score(name="round_trip_scorer", score=0.95, metadata={"info": "test"})

        # Serialize to dict
        as_dict = original.as_dict()

        # Deserialize from dict
        restored = Score.from_dict(as_dict)

        self.assertEqual(restored.name, original.name)
        self.assertEqual(restored.score, original.score)
        self.assertEqual(restored.metadata, original.metadata)

    def test_array_of_scores_serialization(self):
        """Test that arrays of Score objects can be serialized correctly."""
        scores = [
            Score(name="score_1", score=0.8, metadata={"index": 1}),
            Score(name="score_2", score=0.6, metadata={"index": 2}),
            Score(name="score_3", score=None, metadata={}),
        ]

        # Serialize each score
        serialized = [s.as_dict() for s in scores]

        # Check that all scores have required fields
        for i, s_dict in enumerate(serialized):
            self.assertIn("name", s_dict)
            self.assertIn("score", s_dict)
            self.assertIn("metadata", s_dict)
            self.assertEqual(s_dict["name"], f"score_{i + 1}")

        # Check specific values
        self.assertEqual(serialized[0]["score"], 0.8)
        self.assertEqual(serialized[1]["score"], 0.6)
        self.assertIsNone(serialized[2]["score"])

    def test_array_of_scores_json_serialization(self):
        """Test that arrays of Score objects can be JSON serialized."""
        scores = [
            Score(name="json_score_1", score=0.9),
            Score(name="json_score_2", score=0.7),
        ]

        # Serialize to JSON
        serialized = [s.as_dict() for s in scores]
        json_str = json.dumps(serialized)

        # Parse back
        parsed = json.loads(json_str)

        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["name"], "json_score_1")
        self.assertEqual(parsed[0]["score"], 0.9)
        self.assertEqual(parsed[1]["name"], "json_score_2")
        self.assertEqual(parsed[1]["score"], 0.7)

    def test_score_validation_enforces_bounds(self):
        """Test that Score validates score values are between 0 and 1."""
        # Valid scores
        Score(name="valid_0", score=0.0)
        Score(name="valid_1", score=1.0)
        Score(name="valid_mid", score=0.5)
        Score(name="valid_null", score=None)

        # Invalid scores
        with self.assertRaises(ValueError):
            Score(name="invalid_negative", score=-0.1)

        with self.assertRaises(ValueError):
            Score(name="invalid_over_one", score=1.1)

    def test_score_does_not_include_deprecated_error_field(self):
        """Test that as_dict() does not include the deprecated error field."""
        score = Score(name="test_scorer", score=0.5)
        result = score.as_dict()

        # The error field should not be in the serialized output
        self.assertNotIn("error", result)

        # Even if error was set (though deprecated), it shouldn't be in as_dict
        score_with_error = Score(name="error_scorer", score=0.5)
        score_with_error.error = Exception("test")  # Set after construction
        result_with_error = score_with_error.as_dict()

        self.assertNotIn("error", result_with_error)


if __name__ == "__main__":
    unittest.main()
