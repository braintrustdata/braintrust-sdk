from braintrust import Eval

NUM_EXAMPLES = 10


def exact_match_scorer(input, output, expected):
    if expected is None:
        return 0.0
    return 1.0 if output == expected else 0.0


def data_fn():
    data = []
    for i in range(NUM_EXAMPLES):
        names = [
            "Foo",
            "Bar",
            "Alice",
            "Bob",
            "Charlie",
            "Diana",
            "Eve",
            "Frank",
        ]
        greetings = ["Hi", "Hello", "Hey", "Greetings"]

        name = names[i % len(names)]
        greeting = greetings[i % len(greetings)]

        data.append({"input": name, "expected": f"{greeting} {name}"})
    return data


def task_fn(input, hooks=None):
    return f"Hi {input}"


Eval(
    "queue-test",
    data=data_fn,
    task=task_fn,
    scores=[exact_match_scorer],
)
