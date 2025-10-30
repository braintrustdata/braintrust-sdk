import re

from braintrust import Eval


def task(input: str, hooks) -> str:
    match = re.search(r"(\d+)\+(\d+)", input)
    if match:
        return str(int(match.group(1)) + int(match.group(2)))
    return "I don't know"


def simple_scorer(output, expected):
    """Simple hardcoded scorer that always returns 0.5"""
    return 0.5


Eval(
    "simple-math-eval",
    data=[
        {"input": "What is 2+2?", "expected": "4"},
        {"input": "What is 3+3?", "expected": "6"},
    ],
    task=task,
    scores=[simple_scorer],
)
