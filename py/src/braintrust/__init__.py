"""
A Python library for logging data to Braintrust.

### Quickstart

Install the library with pip.

```bash
pip install braintrust
```

Then, run a simple experiment with the following code (replace `YOUR_API_KEY` with
your Braintrust API key):

```python
import braintrust

experiment = braintrust.init(project="PyTest", api_key="YOUR_API_KEY")
experiment.log(
    inputs={"test": 1},
    output="foo",
    expected="bar",
    scores={
        "n": 0.5,
    },
    metadata={
        "id": 1,
    },
)
print(experiment.summarize())
```

### API Reference
"""

from .framework import *
from .logger import *
from .oai import wrap_openai
