"""
Tests for the LangSmith wrapper to ensure compatibility with LangSmith's API.
"""

from unittest.mock import MagicMock

from braintrust.wrappers.langsmith import (
    _braintrust_traceable,
    _convert_langsmith_data,
    _convert_langsmith_evaluator,
    _is_patched,
    _make_braintrust_task,
    _traceable_wrapper,
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
    result = converted(task_input={"x": 1}, output={"y": 2}, expected={"y": 2})

    assert result.name == "accuracy"
    assert result.score == 0.9
    assert result.metadata == {"note": "good"}


def test_convert_langsmith_evaluator_numeric_result():
    """Test converting a LangSmith evaluator that returns a number."""

    def langsmith_evaluator(run, example):
        return 1.0 if run.outputs == example.outputs else 0.0

    converted = _convert_langsmith_evaluator(langsmith_evaluator)
    result = converted(task_input={"x": 1}, output={"y": 2}, expected={"y": 2})

    assert result.name == "langsmith_evaluator"
    assert result.score == 1.0


def test_convert_langsmith_evaluator_none_result():
    """Test converting a LangSmith evaluator that returns None."""

    def langsmith_evaluator(run, example):
        return None

    converted = _convert_langsmith_evaluator(langsmith_evaluator)
    result = converted(task_input={"x": 1}, output={"y": 2}, expected=None)

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


class TestTraceableWrapper:
    """Tests for _traceable_wrapper (wrapping mode)."""

    def test_traceable_wrapper_with_direct_function(self):
        """Test wrapper when @traceable is called with a function directly."""

        def my_function(x: int) -> int:
            return x * 2

        # Simulate LangSmith's traceable returning the decorated function
        def mock_traceable(func):
            return func

        result = _traceable_wrapper(mock_traceable, None, (my_function,), {})
        assert result(5) == 10

    def test_traceable_wrapper_with_decorator_kwargs(self):
        """Test wrapper when @traceable() is called with kwargs."""

        def my_function(x: int) -> int:
            return x * 2

        # Simulate LangSmith's traceable returning a decorator
        def mock_traceable_factory(**kwargs):
            def decorator(func):
                return func
            return decorator

        result = _traceable_wrapper(mock_traceable_factory, None, (), {"name": "custom"})
        decorated = result(my_function)
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
        # In standalone mode, traceable should be replaced with _braintrust_traceable
        assert mock_module.traceable == _braintrust_traceable

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
