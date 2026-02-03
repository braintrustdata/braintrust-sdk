from typing import List
from unittest.mock import MagicMock

import pytest
from braintrust.logger import BraintrustState

from .framework import (
    Eval,
    EvalCase,
    EvalHooks,
    EvalResultWithSummary,
    Evaluator,
    run_evaluator,
)
from .score import Score, Scorer
from .test_helpers import init_test_exp, with_memory_logger, with_simulate_login  # noqa: F401


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

    # if autoevals is installed, use it. This verifies our scoring duck typing works
    try:
        from autoevals import Levenshtein

        scorers.append(Levenshtein())
        scorer_names.append("Levenshtein")
        scorers.append(Levenshtein)
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

    assert isinstance(result, EvalResultWithSummary)
    assert len(result.results) == 2

    # All scorers should produce the same scores
    for eval_result in result.results:
        for scorer_name in scorer_names:
            print(eval_result.scores)
            assert scorer_name in eval_result.scores
            assert eval_result.scores[scorer_name] == 1.0

    assert result.summary.project_name == "test-project"
    for scorer_name in scorer_names:
        assert scorer_name in result.summary.scores
        assert result.summary.scores[scorer_name].score == 1.0


@pytest.mark.asyncio
async def test_hooks_trial_index():
    """Test that trial_index is correctly passed to task via hooks."""
    trial_indices: List[int] = []

    # Task that captures trial indices
    def task_with_hooks(input_value: int, hooks: EvalHooks) -> int:
        trial_indices.append(hooks.trial_index)
        return input_value * 2

    # Create evaluator with trial_count > 1
    evaluator = Evaluator(
        project_name="test-project",
        eval_name="test-trial-index",
        data=[EvalCase(input=1, expected=2)],
        task=task_with_hooks,
        scores=[],  # No scoring needed for this test
        experiment_name=None,
        metadata=None,
        trial_count=3,  # Run 3 trials
    )

    # Run evaluator
    result = await run_evaluator(experiment=None, evaluator=evaluator, position=None, filters=[])

    # Verify we got 3 results (one for each trial)
    assert len(result.results) == 3

    # Verify trial indices were captured correctly
    assert len(trial_indices) == 3
    assert sorted(trial_indices) == [0, 1, 2]

    # Verify all results are correct
    for eval_result in result.results:
        assert eval_result.input == 1
        assert eval_result.expected == 2
        assert eval_result.output == 2  # 1 * 2
        assert eval_result.error is None


@pytest.mark.asyncio
async def test_hooks_trial_index_multiple_inputs():
    """Test trial_index with multiple inputs to ensure proper indexing."""
    trial_data: List[tuple] = []  # (input, trial_index)

    def task_with_hooks(input_value: int, hooks: EvalHooks) -> int:
        trial_data.append((input_value, hooks.trial_index))
        return input_value * 2

    # Create evaluator with multiple inputs and trials
    evaluator = Evaluator(
        project_name="test-project",
        eval_name="test-trial-index-multiple",
        data=[
            EvalCase(input=1, expected=2),
            EvalCase(input=2, expected=4),
        ],
        task=task_with_hooks,
        scores=[],
        experiment_name=None,
        metadata=None,
        trial_count=2,  # 2 trials per input
    )

    # Run evaluator
    result = await run_evaluator(experiment=None, evaluator=evaluator, position=None, filters=[])

    # Should have 4 results total (2 inputs × 2 trials)
    assert len(result.results) == 4
    assert len(trial_data) == 4

    # Group by input to verify trial indices
    input_1_trials = [trial_idx for inp, trial_idx in trial_data if inp == 1]
    input_2_trials = [trial_idx for inp, trial_idx in trial_data if inp == 2]

    # Each input should have been run with trial indices 0 and 1
    assert sorted(input_1_trials) == [0, 1]
    assert sorted(input_2_trials) == [0, 1]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_scorer_spans_have_purpose_attribute(with_memory_logger, with_simulate_login):
    """Test that scorer spans have span_attributes.purpose='scorer' and propagate to subspans."""
    # Define test data
    data = [
        EvalCase(input="hello", expected="hello"),
    ]

    def simple_task(input_value):
        return input_value

    def purpose_scorer(input_value, output, expected):
        return 1.0 if output == expected else 0.0

    evaluator = Evaluator(
        project_name="test-project",
        eval_name="test-scorer-purpose",
        data=data,
        task=simple_task,
        scores=[purpose_scorer],
        experiment_name="test-scorer-purpose",
        metadata=None,
    )

    # Create experiment so spans get logged
    exp = init_test_exp("test-scorer-purpose", "test-project")

    # Run evaluator
    result = await run_evaluator(experiment=exp, evaluator=evaluator, position=None, filters=[])

    assert len(result.results) == 1
    assert result.results[0].scores.get("purpose_scorer") == 1.0

    # Check the logged spans
    logs = with_memory_logger.pop()

    # Find the scorer span (has type="score")
    scorer_spans = [log for log in logs if log.get("span_attributes", {}).get("type") == "score"]
    assert len(scorer_spans) == 1, f"Expected 1 scorer span, found {len(scorer_spans)}"

    scorer_span = scorer_spans[0]

    # Verify the scorer span has purpose='scorer'
    assert scorer_span["span_attributes"].get("purpose") == "scorer", (
        f"Scorer span should have purpose='scorer', got: {scorer_span['span_attributes']}"
    )

    # Verify that non-scorer spans (task, eval) do NOT have purpose='scorer'
    non_scorer_spans = [log for log in logs if log.get("span_attributes", {}).get("type") != "score"]
    assert len(non_scorer_spans) > 0, "Expected at least one non-scorer span"
    for span in non_scorer_spans:
        assert span.get("span_attributes", {}).get("purpose") != "scorer", (
            f"Non-scorer span should NOT have purpose='scorer', got: {span['span_attributes']}"
        )


@pytest.fixture
def simple_scorer():
    def simple_scorer_function(input, output, expected):
        return {"name": "simple_scorer", "score": 0.8}

    return simple_scorer_function


@pytest.mark.asyncio
async def test_eval_no_send_logs_true(with_memory_logger, simple_scorer):
    """Test that Eval with no_send_logs=True runs locally without creating experiment."""

    def exact_match(input, output, expected):
        return {"name": "exact_match", "score": 1.0 if output == expected else 0.0}

    result = await Eval(
        "test-no-logs",
        data=[{"input": "hello", "expected": "hello world"}, {"input": "test", "expected": "test world"}],
        task=lambda input_val: input_val + " world",
        scores=[exact_match, simple_scorer],
        no_send_logs=True,
    )

    # Verify it returns results
    assert len(result.results) == 2
    assert result.results[0].input == "hello"
    assert result.results[0].output == "hello world"
    assert result.results[0].scores["exact_match"] == 1.0
    assert result.results[0].scores["simple_scorer"] == 0.8

    assert result.results[1].input == "test"
    assert result.results[1].output == "test world"
    assert result.results[1].scores["exact_match"] == 1.0
    assert result.results[1].scores["simple_scorer"] == 0.8

    # Verify it builds a local summary (no experiment_url means local run)
    assert result.summary.project_name == "test-no-logs"
    assert result.summary.experiment_url is None
    assert result.summary.scores["exact_match"].score == 1.0
    assert result.summary.scores["simple_scorer"].score == 0.8

    # Most importantly: verify that no logs were sent (should be empty)
    logs = with_memory_logger.pop()
    assert len(logs) == 0


@pytest.mark.asyncio
async def test_eval_no_send_logs_with_none_score(with_memory_logger):
    """Test that scorers returning None don't crash local mode."""

    def sometimes_none_scorer(input, output, expected):
        # Return None for first input, score for second
        if input == "hello":
            return {"name": "conditional", "score": None}
        return {"name": "conditional", "score": 1.0}

    result = await Eval(
        "test-none-score",
        data=[
            {"input": "hello", "expected": "hello world"},
            {"input": "test", "expected": "test world"},
        ],
        task=lambda input_val: input_val + " world",
        scores=[sometimes_none_scorer],
        no_send_logs=True,
    )

    # Should not crash and should calculate average from non-None scores only
    assert result.summary.scores["conditional"].score == 1.0  # Only the second score counts


@pytest.mark.asyncio
async def test_hooks_tags_append(with_memory_logger, with_simulate_login, simple_scorer):
    """Test that hooks.tags can be appended to and logged."""

    initial_tags = ["cookies n cream"]
    appended_tags = ["chocolate", "vanilla", "strawberry"]
    expected_tags = ["cookies n cream", "chocolate", "vanilla", "strawberry"]

    def task_with_hooks(input, hooks):
        for x in appended_tags:
            hooks.tags.append(x)
        return input

    evaluator = Evaluator(
        project_name=__name__,
        eval_name=__name__,
        data=[EvalCase(input="hello", expected="hello world", tags=initial_tags)],
        task=task_with_hooks,
        scores=[simple_scorer],
        experiment_name=__name__,
        metadata=None,
        summarize_scores=False,
    )
    exp = init_test_exp(__name__)
    result = await run_evaluator(experiment=exp, evaluator=evaluator, position=None, filters=[])
    assert result.results[0].tags == expected_tags

    logs = with_memory_logger.pop()
    assert len(logs) == 3

    # assert root span contains tags
    root_span = [log for log in logs if not log["span_parents"]]
    assert len(root_span) == 1
    assert root_span[0].get("tags") == expected_tags


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tags", "expected_tags"),
    [(None, None), ([], None), (["chocolate", "vanilla", "strawberry"], ["chocolate", "vanilla", "strawberry"])],
)
async def test_hooks_tags_list(with_memory_logger, with_simulate_login, simple_scorer, tags, expected_tags):
    """Test that hooks.tags can be set to a list."""

    def task_with_hooks(input, hooks):
        hooks.tags = tags
        return input

    evaluator = Evaluator(
        project_name=__name__,
        eval_name=__name__,
        data=[EvalCase(input="hello", expected="hello world")],
        task=task_with_hooks,
        scores=[simple_scorer],
        experiment_name=__name__,
        metadata=None,
        summarize_scores=False,
    )
    exp = init_test_exp(__name__)
    result = await run_evaluator(experiment=exp, evaluator=evaluator, position=None, filters=[])
    assert result.results[0].tags == expected_tags

    logs = with_memory_logger.pop()
    assert len(logs) == 3

    # assert root span contains tags
    root_span = [log for log in logs if not log["span_parents"]]
    assert len(root_span) == 1
    assert root_span[0].get("tags") == expected_tags


@pytest.mark.asyncio
async def test_hooks_tags_with_failing_scorer(with_memory_logger, with_simulate_login, simple_scorer):
    """Test that hooks.tags can be set to a list."""

    expected_tags = ["chocolate", "vanilla", "strawberry"]

    def task_with_hooks(input, hooks):
        hooks.tags = expected_tags
        return input

    def failing_scorer(input, output, expected):
        raise Exception("test error")

    evaluator = Evaluator(
        project_name=__name__,
        eval_name=__name__,
        data=[EvalCase(input="hello", expected="hello world")],
        task=task_with_hooks,
        scores=[simple_scorer, failing_scorer],
        experiment_name=__name__,
        metadata=None,
        summarize_scores=False,
    )
    exp = init_test_exp(__name__)
    result = await run_evaluator(experiment=exp, evaluator=evaluator, position=None, filters=[])
    assert result.results[0].tags == expected_tags

    logs = with_memory_logger.pop()
    assert len(logs) == 4

    # assert root span contains tags
    root_span = [log for log in logs if not log["span_parents"]]
    assert len(root_span) == 1
    assert root_span[0].get("tags") == expected_tags


@pytest.mark.asyncio
async def test_hooks_tags_with_invalid_type(with_memory_logger, with_simulate_login, simple_scorer):
    """Test that result contains an error for cases where hooks.tags is set to an invalid type."""

    def task_with_hooks(input, hooks):
        hooks.tags = 123
        return input

    evaluator = Evaluator(
        project_name=__name__,
        eval_name=__name__,
        data=[EvalCase(input="hello", expected="hello world")],
        task=task_with_hooks,
        scores=[simple_scorer],
        experiment_name=__name__,
        metadata=None,
        summarize_scores=False,
    )
    exp = init_test_exp(__name__)
    result = await run_evaluator(experiment=exp, evaluator=evaluator, position=None, filters=[])
    assert len(result.results) == 1
    assert isinstance(result.results[0].error, TypeError)


@pytest.mark.asyncio
async def test_hooks_without_setting_tags(with_memory_logger, with_simulate_login, simple_scorer):
    """Test where hooks.tags is not set"""

    def task_with_hooks(input, hooks):
        return input

    evaluator = Evaluator(
        project_name=__name__,
        eval_name=__name__,
        data=[EvalCase(input="hello", expected="hello world")],
        task=task_with_hooks,
        scores=[simple_scorer],
        experiment_name=__name__,
        metadata=None,
        summarize_scores=False,
    )
    exp = init_test_exp(__name__)
    result = await run_evaluator(experiment=exp, evaluator=evaluator, position=None, filters=[])
    assert result.results[0].tags == None

    logs = with_memory_logger.pop()
    assert len(logs) == 3

    # assert root span contains tags
    root_span = [log for log in logs if not log["span_parents"]]
    assert len(root_span) == 1
    assert root_span[0].get("tags") == None

@pytest.mark.asyncio
async def test_eval_enable_cache():
    state = BraintrustState()
    state.span_cache = MagicMock()

    # Test enable_cache=False
    await Eval(
        "test-enable-cache-false",
        data=[EvalCase(input=1, expected=1)],
        task=lambda x: x,
        scores=[],
        state=state,
        no_send_logs=True,
        enable_cache=False,
    )
    state.span_cache.start.assert_not_called()
    state.span_cache.stop.assert_not_called()

    # Test enable_cache=True (default)
    state.span_cache.start.reset_mock()
    state.span_cache.stop.reset_mock()

    await Eval(
        "test-enable-cache-true",
        data=[EvalCase(input=1, expected=1)],
        task=lambda x: x,
        scores=[],
        state=state,
        no_send_logs=True,
        # enable_cache defaults to True
    )
    state.span_cache.start.assert_called()
    state.span_cache.stop.assert_called()
