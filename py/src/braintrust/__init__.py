# pyright: reportUnusedImport=false
"""
A Python library for interacting with [Braintrust](https://braintrust.dev/). This library
contains functionality for running evaluations, logging completions, loading and invoking
functions, and more.

`braintrust` is distributed as a [library on PyPI](https://pypi.org/project/braintrust/). It is open source and
[available on GitHub](https://github.com/braintrustdata/braintrust-sdk/tree/main/py).

### Quickstart

Install the library with pip.

```bash
pip install braintrust
```

Then, create a file like `eval_hello.py` with the following content:

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

Finally, run the script with `braintrust eval eval_hello.py`.

```bash
BRAINTRUST_API_KEY=<YOUR_BRAINTRUST_API_KEY> braintrust eval eval_hello.py
```

### API Reference
"""

# Check env var at import time for auto-instrumentation
import os

if os.getenv("BRAINTRUST_INSTRUMENT_THREADS", "").lower() in ("true", "1", "yes"):
    try:
        from .wrappers.threads import setup_threads

        setup_threads()
    except Exception:
        pass  # Never break on import

from .audit import *
from .auto import (
    auto_instrument,  # noqa: F401 # type: ignore[reportUnusedImport]
)
from .framework import *
from .framework2 import *
from .functions.invoke import *
from .functions.stream import *
from .generated_types import *
from .logger import *
from .logger import (
    _internal_get_global_state,  # noqa: F401 # type: ignore[reportUnusedImport]
    _internal_reset_global_state,  # noqa: F401 # type: ignore[reportUnusedImport]
    _internal_with_custom_background_logger,  # noqa: F401 # type: ignore[reportUnusedImport]
)
from .oai import (
    wrap_openai,  # noqa: F401 # type: ignore[reportUnusedImport]
)
from .util import (
    BT_IS_ASYNC_ATTRIBUTE,  # noqa: F401 # type: ignore[reportUnusedImport]
    MarkAsyncWrapper,  # noqa: F401 # type: ignore[reportUnusedImport]
)
from .wrappers.anthropic import (
    wrap_anthropic,  # noqa: F401 # type: ignore[reportUnusedImport]
)
from .wrappers.litellm import (
    wrap_litellm,  # noqa: F401 # type: ignore[reportUnusedImport]
)
from .wrappers.pydantic_ai import (
    setup_pydantic_ai,  # noqa: F401 # type: ignore[reportUnusedImport]
)
