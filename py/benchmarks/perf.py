import time

import braintrust
from braintrust import traced

LOOPS = 2000

braintrust.init_logger(project="perf_test")


@traced
def root(input: int) -> int:
    return input * 2


@traced
def child(input: int) -> int:
    with braintrust.start_span(name="child") as span:
        span.log(metadata={"m1": "v1", "m2": "v2"})
        result = root(input)
        span.log(metrics={"result": result})
        return result


def main():
    t = time.time()
    for i in range(LOOPS):
        child(i)
    elapsed = time.time() - t
    print(f"ran {LOOPS} in {elapsed:.3f}s")


if __name__ == "__main__":
    main()
