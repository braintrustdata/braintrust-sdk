import time

import braintrust
from braintrust import traced
from braintrust.logger import _internal_with_noop_background_logger

LOOPS = 5000

braintrust.init_logger(project="perf_test")


@traced
def root(input: int) -> int:
    return input * 2


@traced
def child(input: int) -> int:
    with braintrust.start_span(name="child") as span:
        span.log(
            metadata={
                "model": "gpt-4",
                "temperature": 0.7,
                "max_tokens": 1000,
                "user_id": "user_123",
                "session_id": "session_abc",
            },
            scores={"accuracy": 0.95, "latency": 0.6, "cost": 0.004},
        )
        result = root(input)
        span.log(
            metrics={"result": result, "tokens_used": 175, "processing_time": 0.35},
            scores={"quality": 0.92, "relevance": 0.88},
        )
        return result


def main():
    # NoOp logging for comparison
    with _internal_with_noop_background_logger():
        t = time.time()
        for i in range(LOOPS):
            child(i)
        elapsed = time.time() - t
        print(f"ran {LOOPS} in {elapsed:.3f}s (noop mode)")


if __name__ == "__main__":
    main()
