# Python SDK

## Running Tests

```bash
make test                    # All tests via nox
make test-core               # Core tests only
make lint                    # Pylint + formatting
make clean                   # Remove build artifacts
```

**Run a single test:**

```bash
nox -s "test_openai(latest)" -- -k "test_chat_metrics"
```

**Common test sessions:**

```bash
nox -l                           # List all sessions
nox -s "test_openai(latest)"     # OpenAI wrapper (latest version)
nox -s "test_anthropic(latest)"  # Anthropic wrapper
nox -s "test_temporal(latest)"   # Temporal integration
nox -s test_openai               # All OpenAI versions
```

## VCR Cassettes

Tests use VCR to record HTTP interactions so they run without live API calls.

**Cassette location:** `src/braintrust/wrappers/cassettes/`

**Using in tests:**

```python
@pytest.mark.vcr
def test_openai_chat_metrics(memory_logger):
    client = wrap_openai(openai.OpenAI())
    response = client.chat.completions.create(...)
```

**Record new cassettes:**

```bash
export OPENAI_API_KEY="sk-..."
nox -s "test_openai(latest)" -- --disable-vcr
```

## Test Fixtures

**Memory logger** - test span recording without real logging:

```python
def test_something(memory_logger):
    # ... do work ...
    spans = memory_logger.pop()
    assert len(spans) == 1
```

**Auto-applied fixtures** (conftest.py):

- `override_app_url_for_tests` - sets BRAINTRUST_APP_URL
- `setup_braintrust` - sets API key env vars
- `reset_braintrust_state` - resets global state after each test
