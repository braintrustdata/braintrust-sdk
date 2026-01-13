# Braintrust SDK

Python and JavaScript clients for Braintrust, plus wrapper libraries for OpenAI, Anthropic, and other AI providers.

## Structure

```
sdk/
├── py/           # Python SDK (see py/CLAUDE.md)
├── js/           # JavaScript SDK (see js/CLAUDE.md)
└── core/         # Shared core library
```

## Quick Reference

| Task          | Command       |
| ------------- | ------------- |
| Run all tests | `make test`   |
| Lint/format   | `make fixup`  |
| Python lint   | `make pylint` |

## Setup

```bash
make develop      # Create venv and install deps
source env.sh     # Activate environment
```
