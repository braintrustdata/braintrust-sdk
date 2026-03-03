# Braintrust SDK

JavaScript client for Braintrust, plus wrapper libraries for OpenAI, Anthropic, and other AI providers.

This repo uses `pnpm` as its package manager and [mise](https://mise.jdx.dev/) to manage tool versions.

## Structure

```
sdk/
├── js/           # JavaScript SDK (see js/CLAUDE.md)
└── core/         # Shared core library
```

## Quick Reference

| Task          | Command          |
| ------------- | ---------------- |
| Run all tests | `pnpm run test`  |
| Build         | `pnpm run build` |
| Lint check    | `pnpm run lint`  |
| Auto-fix      | `pnpm run fix`   |

## Setup

This repo uses [mise](https://mise.jdx.dev/) to manage tool versions (e.g. `pnpm`). The root `mise.toml` pins versions and runs `pnpm install` automatically on `mise install`.

```bash
mise install      # Install tools and dependencies (recommended)
# or manually:
pnpm install      # Install dependencies
pnpm run build    # Build all packages
```

mise also auto-loads a `.env` file if present — see `.env.example` to configure API keys.
