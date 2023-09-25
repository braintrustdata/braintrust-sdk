# Brainrust SDK

[Braintrust](https://www.braintrustdata.com/) is a platform for evaluating and shipping AI products. To learn more about Braintrust or sign up for free,
visit our [website](https://www.braintrustdata.com/) or check out the [docs](https://www.braintrustdata.com/docs).

This repository contains the Python and Javascript SDKs for Braintrust. The SDKs include utilities to:

- Log experiments and datasets to Braintrust
- Run evaluations (via the `Eval` framework)
- Manage an on-premises installation of Braintrust (Python)

## Quickstart: Typescript

First, install the Braintrust SDK:

```bash
npm install braintrust autoevals
```

or

```bash

yarn add braintrust autoevals

```

Then, create a file named `tutorial.eval.ts` with the following code:

```typescript
import { Eval } from "braintrust";
import { LevenshteinScorer } from "autoevals";

Eval("Say Hi Bot", {
  data: () => {
    return [
      {
        input: "Foo",
        expected: "Hi Foo",
      },
      {
        input: "Bar",
        expected: "Hello Bar",
      },
    ]; // Replace with your eval dataset
  },
  task: (input) => {
    return "Hi " + input; // Replace with your LLM call
  },
  scores: [LevenshteinScorer],
});
```

Then, run the following command:

```bash
BRAINTRUST_API_KEY=<YOUR_API_KEY> \
    npx braintrust eval tutorial.eval.ts
```

## Quickstart: Python

Install the library with pip.

```bash
pip install braintrust
```

Then, create a file named `eval_tutorial.py` with the following code:

```python
from braintrust import Eval
from autoevals import LevenshteinScorer

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
  scores=[LevenshteinScorer],
)
```

Then, run the following command:

```bash
BRAINTRUST_API_KEY=<YOUR_API_KEY> \
  braintrust eval eval_tutorial.py
```

## Documentation

For more information, check out the [docs](https://www.braintrustdata.com/docs):

- [Typescript](https://www.braintrustdata.com/docs/libs/nodejs)
- [Python](https://www.braintrustdata.com/docs/libs/python)
