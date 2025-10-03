from braintrust.metrics import Metrics


def test_metrics():
    def foo(bar: Metrics):
        pass

    # build errors would fail this
    foo({"a": 1, "cached": True, "completion_tokens": 10})

    assert True
