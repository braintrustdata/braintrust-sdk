import json

from braintrust import Eval

NUM_EXAMPLES = 10


async def exact_match_scorer(input, output, expected, trace=None):
    """Async scorer that prints trace spans."""
    score = 0.0
    if expected is not None:
        score = 1.0 if output == expected else 0.0

    if trace:
        print("\n" + "="*80)
        print(f"🔍 TRACE INFO for input: {input}")
        print("="*80)

        # Print trace configuration
        config = trace.get_configuration()
        print(f"\n📋 Configuration:")
        print(f"  Object Type: {config.get('objectType')}")
        print(f"  Object ID:   {config.get('objectId')}")
        print(f"  Root Span:   {config.get('rootSpanId')}")

        # Fetch and print spans
        try:
            spans = await trace.get_spans()
            print(f"\n✨ Found {len(spans)} spans:")
            print("-"*80)

            for i, span in enumerate(spans, 1):
                print(f"\n  Span {i}:")
                print(f"    ID:         {span.span_id}")
                span_type = span.span_attributes.get('type', 'N/A') if span.span_attributes else 'N/A'
                span_name = span.span_attributes.get('name', 'N/A') if span.span_attributes else 'N/A'
                print(f"    Type:       {span_type}")
                print(f"    Name:       {span_name}")

                if span.input:
                    input_str = json.dumps(span.input)
                    if len(input_str) > 100:
                        input_str = input_str[:100] + "..."
                    print(f"    Input:      {input_str}")
                if span.output:
                    output_str = json.dumps(span.output)
                    if len(output_str) > 100:
                        output_str = output_str[:100] + "..."
                    print(f"    Output:     {output_str}")
                if span.metadata:
                    print(f"    Metadata:   {list(span.metadata.keys())}")

            print("\n" + "="*80 + "\n")
        except Exception as e:
            print(f"\n⚠️  Error fetching spans: {e}")
            import traceback
            traceback.print_exc()
    else:
        print(f"⚠️  No trace available for input: {input}")

    return score


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
