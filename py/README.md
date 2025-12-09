## Braintrust

A Python library for logging data to Braintrust. `braintrust` is distributed as
a [library on PyPI](https://pypi.org/project/braintrust/). It is open source and
[available on GitHub](https://github.com/braintrustdata/braintrust-sdk/tree/main/py).

### Quickstart

Install the library with pip.

```bash
pip install braintrust
```

**Performance tip**: For 3-5x faster JSON serialization, install with the optional `performance` extra:

```bash
pip install braintrust[performance]
```

Or install `orjson` separately:

```bash
pip install orjson
```

The SDK automatically detects and uses orjson if available, with seamless fallback to standard json. See [ORJSON_OPTIMIZATION.md](ORJSON_OPTIMIZATION.md) for details.

Then, run a simple experiment with the following code (replace `YOUR_API_KEY` with
your Braintrust API key):

```python
from braintrust import Eval

def is_equal(expected, output):
    return expected == output

Eval(
  "Say Hi Bot",
  data=lambda: [
      {
          "input": "Foo",
          "expected": "Hi Foo",
      },
      {
          "input": "Bar",
          "expected": "Hello Bar",
      },
  ],  # Replace with your eval dataset
  task=lambda input: "Hi " + input,  # Replace with your LLM call
  scores=[is_equal],
)
```

# Performance Optimization

For 3-5x faster JSON serialization, install `orjson`. The SDK automatically detects and uses orjson if available, with seamless fallback to standard json.
