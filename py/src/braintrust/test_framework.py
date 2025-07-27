from typing import List

import pytest

from .framework import (
    DictEvalHooks,
    EvalCase,
    EvalHooks,
    EvalResultWithSummary,
    Evaluator,
    run_evaluator,
)
from .logger import Experiment, init_experiment
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


class MockExperiment:
    """Mock experiment for testing purposes."""
    def __init__(self, name="test-experiment", id="test-id"):
        self.name = name
        self.id = id


def test_dict_eval_hooks_experiment_propagation():
    """Test that DictEvalHooks properly handles experiment propagation."""
    # Test with explicit experiment
    experiment = MockExperiment("my-experiment")
    hooks = DictEvalHooks(
        metadata={"test": "value"},
        expected="expected_output",
        experiment=experiment
    )
    
    assert hooks.experiment is not None
    assert hooks.experiment.name == "my-experiment"
    assert hooks.experiment.id == "test-id"
    
    # Test with no experiment
    hooks_no_exp = DictEvalHooks(
        metadata={"test": "value"},
        expected="expected_output"
    )
    
    assert hooks_no_exp.experiment is None
    
    # Test that other properties still work
    assert hooks.metadata["test"] == "value"
    assert hooks.expected == "expected_output"
    assert hooks_no_exp.metadata["test"] == "value"
    assert hooks_no_exp.expected == "expected_output"


def test_dict_eval_hooks_experiment_setter():
    """Test that DictEvalHooks experiment can be set after construction."""
    hooks = DictEvalHooks()
    assert hooks.experiment is None
    
    experiment = MockExperiment("set-later")
    hooks.set_experiment(experiment)
    assert hooks.experiment is not None
    assert hooks.experiment.name == "set-later"
    
    # Test setting to None
    hooks.set_experiment(None)
    assert hooks.experiment is None


@pytest.mark.asyncio
async def test_experiment_propagation_in_evaluation():
    """Test that experiment is properly propagated to hooks during evaluation."""
    captured_experiments = []
    
    def task_with_experiment_access(input_value, hooks):
        # Capture the experiment from hooks for verification
        captured_experiments.append(hooks.experiment)
        return input_value * 2
    
    data = [EvalCase(input=1, expected=2)]
    
    # Test with no experiment (experiment=None)
    evaluator_no_exp = Evaluator(
        project_name="test-project",
        eval_name="test-no-experiment",
        data=data,
        task=task_with_experiment_access,
        scores=[],
        experiment_name=None,
        metadata=None,
    )
    
    result = await run_evaluator(experiment=None, evaluator=evaluator_no_exp, position=None, filters=[])
    
    assert len(captured_experiments) == 1
    assert captured_experiments[0] is None  # No experiment should be None
    
    # Clear captured experiments for next test
    captured_experiments.clear()
    
    # Test with experiment provided
    experiment = MockExperiment("test-with-experiment")
    
    result_with_exp = await run_evaluator(
        experiment=experiment, 
        evaluator=evaluator_no_exp, 
        position=None, 
        filters=[]
    )
    
    assert len(captured_experiments) == 1
    assert captured_experiments[0] is not None
    assert captured_experiments[0].name == "test-with-experiment"


@pytest.mark.asyncio
async def test_experiment_propagation_task_signature_flexibility():
    """Test that experiment propagation works with different task signatures."""
    captured_hooks = []
    
    def task_with_hooks(input_value, hooks):
        captured_hooks.append(hooks)
        return input_value
    
    def task_without_hooks(input_value):
        return input_value
    
    data = [EvalCase(input=1, expected=1)]
    experiment = MockExperiment("flexible-test")
    
    # Test task that accepts hooks
    evaluator_with_hooks = Evaluator(
        project_name="test-project",
        eval_name="test-with-hooks",
        data=data,
        task=task_with_hooks,
        scores=[],
        experiment_name=None,
        metadata=None,
    )
    
    await run_evaluator(experiment=experiment, evaluator=evaluator_with_hooks, position=None, filters=[])
    
    assert len(captured_hooks) == 1
    assert captured_hooks[0].experiment is not None
    assert captured_hooks[0].experiment.name == "flexible-test"
    
    # Test task that doesn't accept hooks (should still work)
    evaluator_without_hooks = Evaluator(
        project_name="test-project",
        eval_name="test-without-hooks",
        data=data,
        task=task_without_hooks,
        scores=[],
        experiment_name=None,
        metadata=None,
    )
    
    result = await run_evaluator(experiment=experiment, evaluator=evaluator_without_hooks, position=None, filters=[])
    assert len(result.results) == 1
    assert result.results[0].output == 1


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


@pytest.mark.asyncio
async def test_hooks_experiment_and_trial_index_together():
    """Test that both experiment and trial_index work together."""
    captured_data = []
    
    def task_with_both(input_value, hooks):
        captured_data.append({
            'input': input_value,
            'experiment': hooks.experiment,
            'trial_index': hooks.trial_index
        })
        return input_value * 2
    
    experiment = MockExperiment("combined-test")
    
    evaluator = Evaluator(
        project_name="test-project",
        eval_name="test-combined",
        data=[EvalCase(input=5, expected=10)],
        task=task_with_both,
        scores=[],
        experiment_name=None,
        metadata=None,
        trial_count=2,
    )
    
    result = await run_evaluator(experiment=experiment, evaluator=evaluator, position=None, filters=[])
    
    # Should have 2 results (2 trials)
    assert len(result.results) == 2
    assert len(captured_data) == 2
    
    # Both trials should have the same experiment but different trial_index
    for i, data in enumerate(captured_data):
        assert data['input'] == 5
        assert data['experiment'] is not None
        assert data['experiment'].name == "combined-test"
        assert data['trial_index'] == i  # Should be 0 and 1
