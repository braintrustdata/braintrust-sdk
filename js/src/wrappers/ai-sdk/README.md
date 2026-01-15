# AI SDK Wrapper

This wrapper provides Braintrust logging integration for the Vercel AI SDK.

## Test Structure

Tests are organized to support multiple AI SDK versions:

```
ai-sdk/
├── ai-sdk.test.ts          # Shared tests (run against both v5 and v6)
└── tests/
    ├── v5/                  # AI SDK v5 test environment
    │   ├── package.json     # Pins ai@^5.0.76
    │   ├── vitest.config.js
    │   └── ai-sdk.v5.test.ts  # v5-specific API tests
    └── v6/                  # AI SDK v6 test environment
        ├── package.json     # Pins ai@6.0.1
        ├── vitest.config.js
        └── ai-sdk.v6.test.ts  # v6-specific API tests
```

### Running Tests

From the `sdk/js` directory:

```bash
# Run all AI SDK tests (both v5 and v6)
make test-ai-sdk

# Run only v5 tests
make test-ai-sdk-v5

# Run only v6 tests
make test-ai-sdk-v6
```

### Version Differences

Key differences between AI SDK v5 and v6 that affect the wrapper:

| Feature                          | v5                | v6                             |
| -------------------------------- | ----------------- | ------------------------------ |
| `Output.object().responseFormat` | Plain object      | Promise                        |
| `finishReason`                   | String (`"stop"`) | Object (`{ unified: "stop" }`) |

The shared `ai-sdk.test.ts` uses version-agnostic assertions that work with both versions. Version-specific behavior is verified in the `ai-sdk.v5.test.ts` and `ai-sdk.v6.test.ts` files.
