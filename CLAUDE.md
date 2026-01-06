# Braintrust SDK

Multi-language SDK for Braintrust - an AI/ML evaluation and observability platform.

## Repository Structure

```
sdk/
├── py/                    # Python SDK (main package: braintrust)
├── js/                    # JavaScript/TypeScript SDK
├── core/                  # Shared core code
│   ├── py/               # Python core
│   └── js/               # JavaScript core
└── integrations/          # Framework integrations
    ├── langchain-py/     # LangChain Python
    ├── adk-py/           # ADK Python
    └── otel-js/          # OpenTelemetry JS (see integrations/otel-js/CLAUDE.md)
```

## Development Commands

### Python SDK (py/)

```bash
# Install dev dependencies
cd py && make install-dev

# Run all tests (via nox)
make nox                    # from root
cd py && nox                # from py/

# Run specific test session
cd py && nox -s test_core
cd py && nox -s test_openai
cd py && nox -s test_anthropic

# Lint
cd py && make lint

# Full verification
cd py && make verify
```

### JavaScript SDK (js/)

```bash
# Install dependencies (from root)
pnpm install

# Build
pnpm run build

# Run tests
pnpm run test
cd js && make test

# Lint
pnpm run lint
```

### Linting & Formatting (Both)

```bash
# Run pre-commit hooks (format + lint)
make fixup
```

## Testing Guidelines

- Python uses `pytest` via `nox` for test isolation across dependency versions
- JavaScript uses `vitest`
- Always run relevant tests before submitting changes
- For Python integration tests, check which nox sessions are relevant (e.g., `test_openai`, `test_anthropic`, `test_temporal`)

## Key Files

- `py/noxfile.py` - Python test session definitions
- `py/pyproject.toml` - Python package configuration
- `js/package.json` - JavaScript package configuration
- `pnpm-workspace.yaml` - Workspace configuration

## Code Style

- Follow existing patterns in the codebase
- Python: Use type hints, follow PEP 8
- JavaScript/TypeScript: Follow existing ESLint configuration
- Avoid unnecessary comments - code should be self-documenting
