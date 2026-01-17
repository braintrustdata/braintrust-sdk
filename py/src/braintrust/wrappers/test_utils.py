import subprocess
import sys
import textwrap


def run_in_subprocess(code: str, timeout: int = 30) -> subprocess.CompletedProcess:
    """Run Python code in a fresh subprocess."""
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(code)],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


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
