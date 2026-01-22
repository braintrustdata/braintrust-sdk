import os
import subprocess
import sys
import textwrap
from contextlib import contextmanager
from pathlib import Path

import vcr
from braintrust import logger
from braintrust.test_helpers import init_test_logger

AUTO_TEST_SCRIPTS_DIR = Path(__file__).parent / "auto_test_scripts"
CASSETTES_DIR = Path(__file__).parent / "cassettes"


def run_in_subprocess(code: str, timeout: int = 30) -> subprocess.CompletedProcess:
    """Run Python code in a fresh subprocess."""
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(code)],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def verify_autoinstrument_script(script_name: str, timeout: int = 30) -> subprocess.CompletedProcess:
    """Run a test script from the auto_test_scripts directory.

    Raises AssertionError if the script exits with non-zero code.
    """
    script_path = AUTO_TEST_SCRIPTS_DIR / script_name
    result = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    assert result.returncode == 0, f"Script {script_name} failed:\n{result.stderr}"
    return result


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


@contextmanager
def autoinstrument_test_context(cassette_name: str):
    """Context manager for auto_instrument tests.

    Sets up VCR and memory_logger, yields memory_logger for direct use.

    Usage:
        with autoinstrument_test_context("test_auto_openai") as memory_logger:
            # make API call
            spans = memory_logger.pop()
    """
    cassette_path = CASSETTES_DIR / f"{cassette_name}.yaml"

    init_test_logger("test-auto-instrument")

    with logger._internal_with_memory_background_logger() as memory_logger:
        memory_logger.pop()  # Clear any prior spans

        my_vcr = vcr.VCR(
            filter_headers=["authorization", "api-key", "x-api-key", "x-goog-api-key"],
            record_mode="once" if not os.environ.get("CI") else "none",
        )
        with my_vcr.use_cassette(str(cassette_path)):
            yield memory_logger
