# pyright: reportPrivateUsage=false
# pyright: reportMissingParameterType=false
# pyright: reportUnknownParameterType=false
# pyright: reportUnknownArgumentType=false
# pyright: reportUnknownMemberType=false
# pylint: disable=protected-access

"""
Tests for the LangSmith wrapper to ensure compatibility with LangSmith's API.
"""


from braintrust.wrappers.langsmith_wrapper import (
    _convert_langsmith_data,
    _is_patched,
    _make_braintrust_scorer,
    _make_braintrust_task,
    wrap_aevaluate,
    wrap_client,
    wrap_traceable,
)


def test_is_patched_false():
    """Test that _is_patched returns False for unpatched objects."""

    def unpatched():
        pass

    assert _is_patched(unpatched) is False


def test_is_patched_true():
    """Test that _is_patched returns True for patched objects."""

    def patched():
        pass

    patched._braintrust_patched = True  # type: ignore

    assert _is_patched(patched) is True


def test_make_braintrust_scorer_dict_result():
    """Test converting a LangSmith evaluator that returns a dict."""

    def langsmith_evaluator(inputs, outputs, reference_outputs):
        return {"key": "accuracy", "score": 0.9, "metadata": {"note": "good"}}

    converted = _make_braintrust_scorer(langsmith_evaluator)

    # Create a mock Example object
    class MockExample:
        outputs = {"y": 2}

    result = converted(input={"x": 1}, output={"y": 2}, expected=MockExample())

    assert result.name == "accuracy"
    assert result.score == 0.9
    assert result.metadata == {"note": "good"}


def test_make_braintrust_scorer_numeric_result():
    """Test converting a LangSmith evaluator that returns a numeric score in a dict."""

    def langsmith_evaluator(inputs, outputs, reference_outputs):
        return {"score": 1.0 if outputs == reference_outputs else 0.0}

    converted = _make_braintrust_scorer(langsmith_evaluator)

    class MockExample:
        outputs = {"y": 2}

    result = converted(input={"x": 1}, output={"y": 2}, expected=MockExample())

    assert result.name == "langsmith_evaluator"
    assert result.score == 1.0


def test_make_braintrust_scorer_with_plain_dict_expected():
    """Test converting a LangSmith evaluator with plain dict as expected."""

    def langsmith_evaluator(inputs, outputs, reference_outputs):
        return {"score": 1.0 if outputs == reference_outputs else 0.0}

    converted = _make_braintrust_scorer(langsmith_evaluator)
    result = converted(input={"x": 1}, output={"y": 2}, expected={"y": 2})

    assert result.name == "langsmith_evaluator"
    assert result.score == 1.0


def test_convert_langsmith_data_from_list():
    """Test converting LangSmith data from a list of dicts."""
    data = [
        {"inputs": {"x": 1}, "outputs": {"y": 2}},
        {"inputs": {"x": 2}, "outputs": {"y": 4}},
    ]

    data_fn = _convert_langsmith_data(data)
    result = list(data_fn())

    assert len(result) == 2
    assert result[0].input == {"x": 1}
    # The whole item is passed as expected
    assert result[0].expected == {"inputs": {"x": 1}, "outputs": {"y": 2}}
    assert result[1].input == {"x": 2}
    assert result[1].expected == {"inputs": {"x": 2}, "outputs": {"y": 4}}


def test_convert_langsmith_data_from_callable():
    """Test converting LangSmith data from a callable."""

    def data_generator():
        yield {"inputs": {"x": 1}, "outputs": {"y": 2}}
        yield {"inputs": {"x": 2}, "outputs": {"y": 4}}

    data_fn = _convert_langsmith_data(data_generator)
    result = list(data_fn())

    assert len(result) == 2
    assert result[0].input == {"x": 1}
    # The whole item is passed as expected
    assert result[0].expected == {"inputs": {"x": 1}, "outputs": {"y": 2}}


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
    result = list(data_fn())

    assert len(result) == 2
    assert result[0].input == {"x": 1}
    # The whole Example object is passed as expected
    assert result[0].expected.inputs == {"x": 1}
    assert result[0].expected.outputs == {"y": 2}


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


class TestWrapTraceable:
    """Tests for wrap_traceable functionality."""

    def test_wrap_traceable_returns_wrapper(self):
        """Test that wrap_traceable returns a wrapped version."""

        def mock_traceable(func, **kwargs):
            return func

        wrapped = wrap_traceable(mock_traceable, standalone=False)
        assert callable(wrapped)
        assert _is_patched(wrapped)

    def test_wrap_traceable_standalone_mode(self):
        """Test that wrap_traceable works in standalone mode."""

        def mock_traceable(func, **kwargs):
            return func

        wrapped = wrap_traceable(mock_traceable, standalone=True)
        assert callable(wrapped)
        assert _is_patched(wrapped)


class TestWrapFunctions:
    """Tests for the wrap_* functions."""

    def test_wrap_functions_exist(self):
        """Test that wrap functions are callable."""
        assert callable(wrap_traceable)
        assert callable(wrap_client)
        assert callable(wrap_aevaluate)

    def test_wrap_traceable_returns_patched_function(self):
        """Test that wrap_traceable returns a patched function."""

        def mock_traceable(func, **kwargs):
            return func

        wrapped = wrap_traceable(mock_traceable)
        assert _is_patched(wrapped)

    def test_wrap_traceable_skips_if_already_patched(self):
        """Test that wrap_traceable skips if already patched."""

        def mock_traceable(func, **kwargs):
            return func

        mock_traceable._braintrust_patched = True  # type: ignore

        result = wrap_traceable(mock_traceable)
        # Should return the same function
        assert result is mock_traceable

    def test_wrap_client_sets_flag(self):
        """Test that wrap_client sets the patched flag."""

        class MockClient:
            def evaluate(self, *args, **kwargs):
                return "original"

        wrap_client(MockClient)
        assert _is_patched(MockClient.evaluate)

    def test_wrap_aevaluate_returns_patched_function(self):
        """Test that wrap_aevaluate returns a patched function."""

        async def mock_aevaluate(*args, **kwargs):
            pass

        wrapped = wrap_aevaluate(mock_aevaluate)
        assert _is_patched(wrapped)


class TestTandemModeIntegration:
    """Integration tests for tandem mode (LangSmith + Braintrust together)."""

    def test_make_braintrust_task_with_inputs_parameter(self):
        """Test that task handles LangSmith's required 'inputs' parameter name."""

        def target_fn(inputs: dict) -> dict:
            return {"result": inputs["x"] * 2}

        task = _make_braintrust_task(target_fn)
        result = task({"x": 5}, None)

        assert result == {"result": 10}

    def test_convert_langsmith_data_handles_different_output_types(self):
        """Test that data conversion handles various output types."""
        data = [
            {"inputs": {"x": 1}, "outputs": 2},  # outputs is int, not dict
            {"inputs": {"x": 2}, "outputs": {"result": 4}},  # outputs is already dict
        ]

        data_fn = _convert_langsmith_data(data)
        result = list(data_fn())

        # Both should work - Braintrust's EvalCase accepts any type for expected
        assert len(result) == 2
        assert result[0].input == {"x": 1}
        assert result[1].input == {"x": 2}

    def test_make_braintrust_scorer_handles_wrapped_outputs(self):
        """Test that scorers handle output wrapping correctly."""

        def langsmith_evaluator(inputs, outputs, reference_outputs):
            # outputs will be wrapped as {"output": value} for non-dict results
            actual = outputs.get("output", outputs)
            expected = reference_outputs.get("output", reference_outputs) if isinstance(reference_outputs, dict) else reference_outputs
            return {"key": "match", "score": 1.0 if actual == expected else 0.0}

        converted = _make_braintrust_scorer(langsmith_evaluator)

        class MockExample:
            outputs = {"output": 42}

        # Test with wrapped output
        result = converted(input={"x": 1}, output=42, expected=MockExample())
        assert result.name == "match"
        assert result.score == 1.0


class TestDataConversion:
    """Tests for data conversion utilities."""

    def test_convert_data_with_braintrust_format(self):
        """Test that Braintrust format is properly handled."""
        data = [
            {"input": {"x": 1}, "expected": {"y": 2}},
            {"input": {"x": 2}, "expected": {"y": 4}},
        ]

        data_fn = _convert_langsmith_data(data)
        result = list(data_fn())

        assert len(result) == 2
        assert result[0].input == {"x": 1}
        assert result[0].expected == {"y": 2}
        assert result[1].input == {"x": 2}
        assert result[1].expected == {"y": 4}

    def test_convert_data_with_simple_items(self):
        """Test that simple items (not dicts) are handled."""
        data = [1, 2, 3]

        data_fn = _convert_langsmith_data(data)
        result = list(data_fn())

        assert len(result) == 3
        assert result[0].input == 1
        assert result[1].input == 2
        assert result[2].input == 3
