def assert_metrics_are_valid(metrics, start=None, end=None):
    assert metrics
    # assert 0 < metrics["time_to_first_token"]
    assert 0 < metrics["tokens"]
    assert 0 < metrics["prompt_tokens"]
    assert 0 < metrics["completion_tokens"]
    # we use <= because windows timestamps are not very precise and
    # we use VCR which skips HTTP requests.
    if start and end:
        assert start <= metrics["start"] <= metrics["end"] <= end
    else:
        assert metrics["start"] <= metrics["end"]
