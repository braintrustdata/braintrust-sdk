# pyright: reportPrivateUsage=false
# pyright: reportMissingParameterType=false
# pyright: reportUnknownParameterType=false
# pyright: reportUnknownArgumentType=false
# pyright: reportUnknownMemberType=false

"""
Tests for the LangSmith wrapper to ensure compatibility with LangSmith's API.
"""

from unittest.mock import MagicMock

from braintrust.wrappers.langsmith_wrapper import (
    _braintrust_traceable,
    _convert_langsmith_data,
    _convert_langsmith_evaluator,
    _is_patched,
    _make_braintrust_task,
    _tandem_traceable,
    wrap_aevaluate,
    wrap_client,
    wrap_traceable,
)


def test_is_patched_false():
    """Test that _is_patched returns False for unpatched objects."""

    class Unpatched:
        pass

    assert _is_patched(Unpatched, "traceable") is False
    assert _is_patched(Unpatched, "evaluate") is False


def test_is_patched_true():
    """Test that _is_patched returns True for patched objects."""

    class Patched:
        _braintrust_traceable_patched = True
        _braintrust_evaluate_patched = True

    assert _is_patched(Patched, "traceable") is True
    assert _is_patched(Patched, "evaluate") is True


def test_convert_langsmith_evaluator_dict_result():
    """Test converting a LangSmith evaluator that returns a dict."""

    def langsmith_evaluator(run, example):
        return {"key": "accuracy", "score": 0.9, "metadata": {"note": "good"}}

    converted = _convert_langsmith_evaluator(langsmith_evaluator)
    result = converted(input={"x": 1}, output={"y": 2}, expected={"y": 2})

    assert result.name == "accuracy"
    assert result.score == 0.9
    assert result.metadata == {"note": "good"}


def test_convert_langsmith_evaluator_numeric_result():
    """Test converting a LangSmith evaluator that returns a number."""

    def langsmith_evaluator(run, example):
        return 1.0 if run.outputs == example.outputs else 0.0

    converted = _convert_langsmith_evaluator(langsmith_evaluator)
    result = converted(input={"x": 1}, output={"y": 2}, expected={"y": 2})

    assert result.name == "langsmith_evaluator"
    assert result.score == 1.0


def test_convert_langsmith_evaluator_none_result():
    """Test converting a LangSmith evaluator that returns None."""

    def langsmith_evaluator(run, example):
        return None

    converted = _convert_langsmith_evaluator(langsmith_evaluator)
    result = converted(input={"x": 1}, output={"y": 2}, expected=None)

    assert result.name == "langsmith_evaluator"
    assert result.score is None


def test_convert_langsmith_data_from_list():
    """Test converting LangSmith data from a list of dicts."""
    data = [
        {"inputs": {"x": 1}, "outputs": {"y": 2}},
        {"inputs": {"x": 2}, "outputs": {"y": 4}},
    ]

    data_fn = _convert_langsmith_data(data)
    result = data_fn()

    assert len(result) == 2
    assert result[0].input == {"x": 1}
    assert result[0].expected == {"y": 2}
    assert result[1].input == {"x": 2}
    assert result[1].expected == {"y": 4}


def test_convert_langsmith_data_from_callable():
    """Test converting LangSmith data from a callable."""

    def data_generator():
        yield {"inputs": {"x": 1}, "outputs": {"y": 2}}
        yield {"inputs": {"x": 2}, "outputs": {"y": 4}}

    data_fn = _convert_langsmith_data(data_generator)
    result = data_fn()

    assert len(result) == 2
    assert result[0].input == {"x": 1}
    assert result[0].expected == {"y": 2}


def test_convert_langsmith_data_with_example_objects():
    """Test converting LangSmith data with Example-like objects."""

    class MockExample:
        def __init__(self, inputs, outputs):
            self.inputs = inputs
            self.outputs = outputs

    data = [
        MockExample(inputs={"x": 1}, outputs={"y": 2}),
        MockExample(inputs={"x": 2}, outputs={"y": 4}),
    ]

    data_fn = _convert_langsmith_data(data)
    result = data_fn()

    assert len(result) == 2
    assert result[0].input == {"x": 1}
    assert result[0].expected == {"y": 2}


def test_make_braintrust_task_with_dict_input():
    """Test that task function handles dict inputs correctly."""

    def target_fn(inputs):
        return inputs["x"] * 2

    task = _make_braintrust_task(target_fn)
    result = task({"x": 5}, None)

    assert result == 10


def test_make_braintrust_task_with_kwargs_expansion():
    """Test that task function expands dict kwargs when signature matches."""

    def target_fn(x, y):
        return x + y

    task = _make_braintrust_task(target_fn)
    result = task({"x": 2, "y": 3}, None)

    assert result == 5


def test_make_braintrust_task_simple_input():
    """Test that task function handles simple inputs."""

    def target_fn(inp):
        return inp * 2

    task = _make_braintrust_task(target_fn)
    result = task(5, None)

    assert result == 10


class TestBraintrustTraceable:
    """Tests for the Braintrust traceable decorator."""

    def test_traceable_preserves_function_name(self):
        """Test that traceable preserves function metadata."""

        @_braintrust_traceable
        def my_function(x: int) -> int:
            """My docstring."""
            return x * 2

        assert my_function.__name__ == "my_function"
        assert my_function.__doc__ == "My docstring."

    def test_traceable_with_name_parameter(self):
        """Test that traceable accepts name parameter."""

        @_braintrust_traceable(name="custom_name")
        def my_function(x: int) -> int:
            return x * 2

        result = my_function(5)
        assert result == 10

    def test_traceable_executes_function(self):
        """Test that decorated function executes correctly."""

        @_braintrust_traceable
        def add(a: int, b: int) -> int:
            return a + b

        result = add(2, 3)
        assert result == 5


class TestTandemTraceable:
    """Tests for _tandem_traceable (wrapping mode)."""

    def test_tandem_traceable_with_function(self):
        """Test tandem traceable when called with a function directly."""

        def my_function(x: int) -> int:
            return x * 2

        # Simulate LangSmith's traceable
        def mock_traceable(func, **kwargs):
            return func

        result = _tandem_traceable(mock_traceable, my_function, name="test")
        assert result(5) == 10

    def test_tandem_traceable_as_decorator(self):
        """Test tandem traceable when used as a decorator factory."""

        def my_function(x: int) -> int:
            return x * 2

        # Simulate LangSmith's traceable
        def mock_traceable(func, **kwargs):
            return func

        decorator = _tandem_traceable(mock_traceable, name="custom")
        decorated = decorator(my_function)
        assert decorated(5) == 10


class TestWrapFunctions:
    """Tests for the wrap_* functions."""

    def test_wrap_functions_exist(self):
        """Test that wrap functions are callable."""
        assert callable(wrap_traceable)
        assert callable(wrap_client)
        assert callable(wrap_aevaluate)

    def test_wrap_traceable_sets_flag(self):
        """Test that wrap_traceable sets the patched flag."""
        mock_module = MagicMock()
        mock_module._braintrust_traceable_patched = False

        wrap_traceable(mock_module)
        assert mock_module._braintrust_traceable_patched is True

    def test_wrap_traceable_standalone_replaces_traceable(self):
        """Test that standalone=True replaces traceable entirely."""
        mock_module = MagicMock()
        mock_module._braintrust_traceable_patched = False

        wrap_traceable(mock_module, standalone=True)
        assert mock_module._braintrust_traceable_patched is True
        # traceable should be replaced with a wrapper function
        assert callable(mock_module.traceable)
        assert (
            mock_module.traceable != mock_module._original_traceable
            if hasattr(mock_module, "_original_traceable")
            else True
        )

    def test_wrap_traceable_skips_if_already_patched(self):
        """Test that wrap_traceable skips if already patched."""
        mock_module = MagicMock()
        mock_module._braintrust_traceable_patched = True
        original_traceable = mock_module.traceable

        wrap_traceable(mock_module)
        # Should not have changed
        assert mock_module.traceable == original_traceable

    def test_wrap_client_sets_flag(self):
        """Test that wrap_client sets the patched flag."""

        class MockClient:
            _braintrust_evaluate_patched = False

            def evaluate(self):
                pass

        wrap_client(MockClient)
        assert MockClient._braintrust_evaluate_patched is True

    def test_wrap_aevaluate_sets_flag(self):
        """Test that wrap_aevaluate sets the patched flag."""
        mock_module = MagicMock()
        mock_module._braintrust_aevaluate_patched = False

        async def mock_aevaluate():
            pass

        mock_module.aevaluate = mock_aevaluate

        wrap_aevaluate(mock_module)
        assert mock_module._braintrust_aevaluate_patched is True

    def test_wrap_aevaluate_skips_if_no_aevaluate(self):
        """Test that wrap_aevaluate skips if aevaluate doesn't exist."""
        mock_module = MagicMock(spec=[])  # No attributes

        result = wrap_aevaluate(mock_module)
        assert result == mock_module
        assert not hasattr(mock_module, "_braintrust_aevaluate_patched")


class TestTandemModeIntegration:
    """Integration tests for tandem mode (LangSmith + Braintrust together)."""

    def test_traceable_preserves_function_signature(self):
        """Test that wrapped functions preserve their signature for LangSmith inspection."""

        def original_traceable(func, **kwargs):
            """Mock LangSmith traceable that wraps the function and strips langsmith_extra."""

            def wrapper(*args, **inner_kwargs):
                # Real LangSmith strips langsmith_extra before calling the function
                inner_kwargs.pop("langsmith_extra", None)
                return func(*args, **inner_kwargs)

            return wrapper

        def sample_func(inputs: dict) -> int:
            return inputs["x"] * 2

        # The decorated function should be callable with dict input
        wrapped = _tandem_traceable(original_traceable, sample_func, name="test")
        result = wrapped({"x": 5})
        assert result == 10

    def test_traceable_handles_langsmith_extra_kwarg(self):
        """Test that langsmith_extra kwargs don't break the wrapper when LangSmith injects them."""
        langsmith_extra_received = {"value": None}

        def original_traceable(func, **kwargs):
            """Mock LangSmith traceable that receives and strips langsmith_extra."""

            def wrapper(*args, **inner_kwargs):
                # Real LangSmith receives langsmith_extra, uses it for tracing, then strips it
                langsmith_extra_received["value"] = inner_kwargs.pop("langsmith_extra", None)
                return func(*args, **inner_kwargs)

            return wrapper

        def my_func(x: int) -> int:
            return x * 2

        wrapped = _tandem_traceable(original_traceable, my_func, name="test")
        # Simulate LangSmith evaluate() passing langsmith_extra
        result = wrapped(5, langsmith_extra={"run_id": "123"})
        assert result == 10
        # Verify LangSmith's wrapper received the langsmith_extra
        assert langsmith_extra_received["value"] == {"run_id": "123"}

    def test_braintrust_traceable_filters_langsmith_extra(self):
        """Test that _braintrust_traceable filters out langsmith_extra before calling func."""
        received_kwargs = {}

        @_braintrust_traceable(name="test")
        def capture_kwargs(**kwargs):
            received_kwargs.update(kwargs)
            return 42

        # Call with langsmith_extra (simulating what LangSmith does)
        result = capture_kwargs(a=1, b=2, langsmith_extra={"run_id": "123"})

        assert result == 42
        assert "langsmith_extra" not in received_kwargs
        assert received_kwargs == {"a": 1, "b": 2}

    def test_tandem_traceable_calls_both_langsmith_and_braintrust(self):
        """Test that tandem mode actually calls both LangSmith's wrapper and adds Braintrust tracing."""
        langsmith_called = {"count": 0}

        def mock_langsmith_traceable(func, **kwargs):
            """Mock that tracks calls."""

            def wrapper(*args, **inner_kwargs):
                langsmith_called["count"] += 1
                return func(*args, **inner_kwargs)

            return wrapper

        def my_func(x: int) -> int:
            return x * 2

        wrapped = _tandem_traceable(mock_langsmith_traceable, my_func, name="test")
        result = wrapped(5)

        assert result == 10
        assert langsmith_called["count"] == 1

    def test_convert_langsmith_evaluator_with_dict_wrapped_outputs(self):
        """Test that evaluators handle dict-wrapped outputs (required by LangSmith)."""

        def langsmith_evaluator(run, example):
            # LangSmith wraps non-dict outputs as {"output": value}
            actual = run.outputs
            expected = example.outputs
            if isinstance(actual, dict) and "output" in actual:
                actual = actual["output"]
            if isinstance(expected, dict) and "output" in expected:
                expected = expected["output"]
            return {"key": "match", "score": 1.0 if actual == expected else 0.0}

        converted = _convert_langsmith_evaluator(langsmith_evaluator)

        # Test with raw values (what Braintrust uses)
        result = converted(input={"x": 1}, output=42, expected=42)
        assert result.score == 1.0

    def test_make_braintrust_task_with_inputs_parameter(self):
        """Test that task handles LangSmith's required 'inputs' parameter name."""

        def target_fn(inputs: dict) -> dict:
            return {"result": inputs["x"] * 2}

        task = _make_braintrust_task(target_fn)
        result = task({"x": 5}, None)

        assert result == {"result": 10}

    def test_convert_langsmith_data_wraps_non_dict_outputs(self):
        """Test that data conversion handles non-dict outputs that LangSmith requires as dicts."""
        data = [
            {"inputs": {"x": 1}, "outputs": 2},  # outputs is int, not dict
            {"inputs": {"x": 2}, "outputs": {"result": 4}},  # outputs is already dict
        ]

        data_fn = _convert_langsmith_data(data)
        result = data_fn()

        # Both should work - Braintrust's EvalCase accepts any type for expected
        assert len(result) == 2
        assert result[0].input == {"x": 1}
        assert result[0].expected == 2
        assert result[1].input == {"x": 2}
        assert result[1].expected == {"result": 4}


class TestCreateTempLangsmithDataset:
    """Tests for temporary LangSmith dataset creation in tandem mode."""

    def test_create_temp_dataset_creates_dataset_and_examples(self):
        """Test that _create_temp_langsmith_dataset creates a dataset with examples."""
        from braintrust.wrappers.langsmith_wrapper import _create_temp_langsmith_dataset

        mock_client = MagicMock()
        mock_dataset = MagicMock()
        mock_dataset.id = "dataset-123"
        mock_client.create_dataset.return_value = mock_dataset

        data = [
            {"inputs": {"x": 1}, "outputs": 2},
            {"inputs": {"x": 2}, "outputs": 4},
        ]

        result = _create_temp_langsmith_dataset(mock_client, data, "test-prefix")

        assert result is not None
        assert result.startswith("_temp_test-prefix_")
        mock_client.create_dataset.assert_called_once()
        assert mock_client.create_example.call_count == 2

    def test_create_temp_dataset_wraps_non_dict_outputs(self):
        """Test that non-dict outputs are wrapped as {'output': value} for LangSmith."""
        from braintrust.wrappers.langsmith_wrapper import _create_temp_langsmith_dataset

        mock_client = MagicMock()
        mock_dataset = MagicMock()
        mock_dataset.id = "dataset-123"
        mock_client.create_dataset.return_value = mock_dataset

        data = [{"inputs": {"x": 1}, "outputs": 42}]  # int output

        _create_temp_langsmith_dataset(mock_client, data, "test")

        # Check that create_example was called with wrapped output
        call_kwargs = mock_client.create_example.call_args[1]
        assert call_kwargs["outputs"] == {"output": 42}

    def test_create_temp_dataset_handles_failure(self):
        """Test that dataset creation failure returns None."""
        from braintrust.wrappers.langsmith_wrapper import _create_temp_langsmith_dataset

        mock_client = MagicMock()
        mock_client.create_dataset.side_effect = Exception("API error")

        data = [{"inputs": {"x": 1}, "outputs": 2}]

        result = _create_temp_langsmith_dataset(mock_client, data, "test")

        assert result is None
