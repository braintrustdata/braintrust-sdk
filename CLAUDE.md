# Braintrust SDK

JavaScript client for Braintrust, plus wrapper libraries for OpenAI, Anthropic, and other AI providers.

This repo uses `pnpm` as it's package manager.

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

```bash
pnpm install      # Install dependencies
pnpm run build    # Build all packages
```
