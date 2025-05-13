import asyncio
from typing import List, Optional

import pytest

try:
    from autoevals import Score as AutoevalsScore
except ImportError:
    # Use local Score if autoevals is not available
    from .score import Score as AutoevalsScore
try:
    from braintrust_core.score import Score as BraintrustCoreScore
except ImportError:
    from .score import Score as BraintrustCoreScore
from .framework import (
    EvalCase,
    EvalResultWithSummary,
    Evaluator,
    build_local_summary,
    run_evaluator,
)
from .score import Score


@pytest.mark.asyncio
async def test_run_evaluator_basic():
    """Test that run_evaluator correctly processes a simple evaluation."""
    # Define test data
    data = [
        EvalCase(input=1, expected=2),
        EvalCase(input=2, expected=4),
        EvalCase(input=3, expected=6),
    ]

    # Define a simple task function
    def multiply_by_two(input_value):
        return input_value * 2

    # Define a simple scoring function
    def exact_match(input_value, output, expected):
        return 1.0 if output == expected else 0.0

    # Create evaluator
    evaluator = Evaluator(
        project_name="test-project",
        eval_name="test-evaluator",
        data=data,
        task=multiply_by_two,
        scores=[exact_match],
        experiment_name=None,
        metadata=None,
    )

    # Run evaluator
    result = await run_evaluator(experiment=None, evaluator=evaluator, position=None, filters=[])

    # Verify results
    assert isinstance(result, EvalResultWithSummary)
    assert len(result.results) == 3

    # Check individual results
    for i, eval_result in enumerate(result.results):
        input_value = i + 1
        expected_value = input_value * 2

        assert eval_result.input == input_value
        assert eval_result.expected == expected_value
        assert eval_result.output == expected_value
        assert eval_result.scores.get("exact_match") == 1.0
        assert eval_result.error is None

    # Verify summary
    assert result.summary.project_name == "test-project"
    assert "exact_match" in result.summary.scores
    assert result.summary.scores["exact_match"].score == 1.0


@pytest.mark.asyncio
async def test_run_evaluator_with_both_score_classes():
    """Test that run_evaluator works with scorers that return both Score class types."""
    # Define test data
    data = [
        EvalCase(input="Calculate 2+2", expected="4"),
        EvalCase(input="What is the capital of France?", expected="Paris"),
    ]

    # Define a simple task function that returns fixed responses
    def simple_task(input_value):
        if "2+2" in input_value:
            return "The answer is 4"
        elif "capital of France" in input_value:
            return "The capital of France is Paris"
        return "I don't know"

    # Define a scorer that returns an autoevals Score object
    def autoevals_scorer(input_value, output, expected):
        contains_expected = expected.lower() in output.lower()
        return AutoevalsScore(name="autoevals_scorer", score=1.0 if contains_expected else 0.0)

    # Define a scorer that returns a braintrust_core Score object
    def core_scorer(input_value, output, expected):
        contains_expected = expected.lower() in output.lower()
        return BraintrustCoreScore(name="core_scorer", score=1.0 if contains_expected else 0.0)

    def scorer(input_value, output, expected):
        contains_expected = expected.lower() in output.lower()
        return Score(name="scorer", score=1.0 if contains_expected else 0.0)

    # Create evaluator with all three scorers
    evaluator = Evaluator(
        project_name="test-project",
        eval_name="test-multiple-score-classes",
        data=data,
        task=simple_task,
        scores=[autoevals_scorer, core_scorer, scorer],
        experiment_name=None,
        metadata=None,
    )

    # Run evaluator
    result = await run_evaluator(None, evaluator, None, [])

    # Verify results
    assert isinstance(result, EvalResultWithSummary)
    assert len(result.results) == 2

    # Both scorers should produce the same scores
    for eval_result in result.results:
        assert "autoevals_scorer" in eval_result.scores
        assert "core_scorer" in eval_result.scores
        assert "scorer" in eval_result.scores
        assert eval_result.scores["autoevals_scorer"] == 1.0
        assert eval_result.scores["core_scorer"] == 1.0
        assert eval_result.scores["scorer"] == 1.0

    # Verify summary
    assert result.summary.project_name == "test-project"
    assert "autoevals_scorer" in result.summary.scores
    assert "core_scorer" in result.summary.scores
    assert "scorer" in result.summary.scores
    assert result.summary.scores["autoevals_scorer"].score == 1.0
    assert result.summary.scores["core_scorer"].score == 1.0
    assert result.summary.scores["scorer"].score == 1.0
