import asyncio
from typing import List, Optional

import pytest

from .framework import (
    EvalCase,
    EvalResultWithSummary,
    Evaluator,
    build_local_summary,
    run_evaluator,
)
from .score import Score, Scorer


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
async def test_run_evaluator_with_many_scorers():
    # This test validates that we can process scores from any sources. It is nox's job
    # to ensure this test runs with and without autoevals and braintrust_core installed.
    try:
        from braintrust_core.score import Score as BraintrustCoreScore
    except ImportError:
        from .score import Score as BraintrustCoreScore

    # Define test data
    data = [
        EvalCase(input="abc", expected="abc"),
        EvalCase(input="def", expected="def"),
    ]

    # Define a simple task function that returns fixed responses
    def simple_task(input_value):
        return input_value

    def dict_scorer(input_value, output, expected):
        return {"name": "dict_scorer", "score": 1.0}

    def core_scorer(input_value, output, expected):
        return BraintrustCoreScore(name="core_scorer", score=1.0)

    def scorer(input_value, output, expected):
        return Score(name="scorer", score=1.0)

    class CustomScorer(Scorer):
        def _run_eval_sync(self, *args, **kwargs):
            return Score(name="custom_scorer", score=1.0)

    class CustomScorerAsync(Scorer):
        async def eval_async(self, *args, **kwargs):
            return Score(name="custom_async_scorer", score=1.0)

        def _run_eval_sync(self, *args, **kwargs):
            return Score(name="custom_async_scorer", score=1.0)

    scorers = [
        dict_scorer,
        core_scorer,
        scorer,
        CustomScorer(),
        CustomScorerAsync(),
    ]
    scorer_names = [
        "core_scorer",
        "scorer",
        "dict_scorer",
        "custom_scorer",
        "custom_async_scorer",
    ]

    try:
        from autoevals import Levenshtein

        scorers.append(Levenshtein())
        scorer_names.append("Levenshtein")
    except ImportError:
        pass

    # Create evaluator with all scorers
    evaluator = Evaluator(
        project_name="test-project",
        eval_name="test-multiple-score-classes",
        data=data,
        task=simple_task,
        scores=scorers,
        experiment_name=None,
        metadata=None,
    )

    # Run evaluator
    result = await run_evaluator(None, evaluator, None, [])

    # Verify results
    assert isinstance(result, EvalResultWithSummary)
    assert len(result.results) == 2

    # All scorers should produce the same scores
    for eval_result in result.results:
        for scorer_name in scorer_names:
            print(eval_result.scores)
            assert scorer_name in eval_result.scores
            assert eval_result.scores[scorer_name] == 1.0

    # Verify summary
    assert result.summary.project_name == "test-project"
    for scorer_name in scorer_names:
        assert scorer_name in result.summary.scores
        assert result.summary.scores[scorer_name].score == 1.0


@pytest.mark.asyncio
async def test_run_evaluator_with_scorer_classes():
    """Test that run_evaluator works with different class-based scorer implementations."""

    # Define test data
    data = [EvalCase(input="Test input", expected="Test input")]

    # Simple task function
    def echo_task(input_value):
        return input_value

    # Class that mimics autoevals Scorer pattern
    class AutoevalsStyleScorer:
        def eval(self, input_value, output, expected):
            return {"name": "autoeval_style", "score": 1.0}

        def __call__(self, input_value, output, expected):
            return {"name": "autoeval_style", "score": 1.0}

    # Class with async eval
    class AsyncScorer:
        async def eval_async(self, input_value, output, expected):
            return Score(name="async_style", score=1.0)

    # A completely custom implementation with _run_eval_sync
    class CustomImplScorer:
        def _run_eval_sync(self, input_value, output, expected):
            return Score(name="custom_impl", score=1.0)

        def eval(self, input_value, output, expected):
            return self._run_eval_sync(input_value, output, expected)

    # Create evaluator with class-based scorers that should be instantiated via duck typing
    evaluator = Evaluator(
        project_name="test-project",
        eval_name="test-scorer-classes",
        data=data,
        task=echo_task,
        scores=[AutoevalsStyleScorer, AsyncScorer, CustomImplScorer],
        experiment_name=None,
        metadata=None,
    )

    # Run evaluator
    result = await run_evaluator(None, evaluator, None, [])

    # Verify results
    assert isinstance(result, EvalResultWithSummary)
    assert len(result.results) == 1

    # All scorer classes should be properly instantiated and produce scores
    expected_scorer_names = ["autoeval_style", "async_style", "custom_impl"]

    # Check that all scorer classes were instantiated and produced scores
    for scorer_name in expected_scorer_names:
        assert result.results[0].scores[scorer_name] == 1.0
        assert result.summary.scores[scorer_name].score == 1.0
