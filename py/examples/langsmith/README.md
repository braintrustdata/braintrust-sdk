# LangSmith to Braintrust Migration Examples

Examples demonstrating how to migrate from LangSmith to Braintrust using the compatibility wrapper.

## Setup

```bash
cd sdk/py/examples/langsmith

# Install dependencies with uv
uv sync

# Set your API key
export BRAINTRUST_API_KEY="your-braintrust-api-key"
```

## Migration Modes

The wrapper supports two modes:

### 1. Wrapping Mode (default)

Both LangSmith and Braintrust tracing are active. Use this during migration to verify everything works before fully switching.

```python
from braintrust.wrappers.langsmith import setup_langsmith

setup_langsmith(project_name="my-project")
```

### 2. Standalone Mode

Only Braintrust runs - LangSmith code is completely replaced. Use this when you're ready to fully migrate.

```python
from braintrust.wrappers.langsmith import setup_langsmith

setup_langsmith(project_name="my-project", standalone=True)
```

## Running the Examples

### Tracing Example

Shows how `@traceable` decorated functions work with Braintrust:

```bash
# Wrapping mode (both LangSmith and Braintrust tracing)
python tracing_example.py

# Standalone mode (Braintrust only)
BRAINTRUST_STANDALONE=1 python tracing_example.py
```

### Evaluation Example

Shows how to migrate `client.evaluate()` calls to use Braintrust's evaluation framework:

```bash
# Wrapping mode
python eval_example.py

# Standalone mode
BRAINTRUST_STANDALONE=1 python eval_example.py
```

## What Gets Migrated

| LangSmith           | Braintrust                                                            |
| ------------------- | --------------------------------------------------------------------- |
| `@traceable`        | `@traced` (runs both in wrapping mode, only Braintrust in standalone) |
| `client.evaluate()` | `Eval()` (always uses Braintrust)                                     |
| `aevaluate()`       | `EvalAsync()` (always uses Braintrust)                                |

## Viewing Traces

After running the examples, visit [https://www.braintrust.dev](https://www.braintrust.dev) and navigate to your project to see:

- Function traces with inputs and outputs
- Evaluation results with scores
- Nested span hierarchies
