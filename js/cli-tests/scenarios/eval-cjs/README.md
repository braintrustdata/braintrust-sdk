# Eval CJS Scenario

Tests the `braintrust eval` CLI with **pure JavaScript CommonJS** files (no TypeScript).

## What This Tests

Pure CJS patterns that users write:

- **`require()`**: Classic CJS imports (`const { Eval } = require("braintrust")`)
- **Node.js built-ins**: `require("path")`, `require("os")`
- **`__dirname`/`__filename`**: CJS-only globals
- **`module.exports`**: Classic CJS export pattern

## Test Files

1. **`require-builtin.eval.js`** - `require()` with Node.js built-ins (`path`, `os`)
2. **`dirname-filename.eval.js`** - CJS globals `__dirname` and `__filename`
3. **`module-exports.eval.js`** - Classic `module.exports` pattern

## Key Differences from TypeScript Scenarios

- ✅ **Pure JavaScript** - No TypeScript compilation
- ✅ **`require()` syntax** - Classic CJS imports
- ✅ **No tsconfig.json** - Not a TypeScript project
- ✅ **`.js` extension** - Pure JavaScript files

## Expected Behavior

The CLI should:

- ✅ Handle pure JavaScript CJS files
- ✅ Process `require()` statements
- ✅ Preserve `__dirname`/`__filename` behavior
- ✅ Work with `module.exports`

## Related Scenarios

- **`eval-ts-cjs`**: TypeScript files configured for CJS output
- **`eval-esm`**: Pure JavaScript ESM files
- **`eval-ts-esm`**: TypeScript files configured for ESM output

## Running

```bash
# From this directory:
make test

# From cli-tests root:
make test
```
