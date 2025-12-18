# Zod Version Compatibility

The Braintrust SDK supports both **zod 3.x** and **zod 4.x** as peer dependencies, allowing you to choose the version that best fits your project.

## Installation

The SDK requires zod as a peer dependency. Install your preferred version:

```bash
# For zod 3.x (stable)
pnpm add zod@^3.25

# For zod 4.x (latest)
pnpm add zod@^4
```

> **Note**: Minimum supported version is zod 3.25.0

## Which Version Should I Use?

### Use Zod 3.x if:

- You need maximum ecosystem compatibility
- You're working with existing projects using zod 3.x
- You prioritize stability over new features

### Use Zod 4.x if:

- You're starting a new project
- You want the latest features and improvements
- Your dependencies support zod 4.x

## How It Works

The SDK uses an internal compatibility layer (`src/zod-compat.ts`) that works with both zod 3.x and 4.x. This is achieved by importing from `zod/v3`, which exists in both major versions:

- **In zod 3.x**: `zod/v3` exports the v3 API
- **In zod 4.x**: `zod/v3` exports backward-compatible v3 API

This ensures the SDK works regardless of which version you install.

## Breaking Changes

**None!** The SDK maintains the same API regardless of your zod version.

## Dependencies

The SDK also uses `zod-to-json-schema` for converting zod schemas to JSON Schema. This package already supports both zod 3.x and 4.x (`^3.25 || ^4`), so no additional configuration is needed.

## For SDK Contributors

When working on the SDK:

1. **Never import directly from `"zod"`** - Always use `"./zod-compat"` (or the appropriate relative path)
2. **Test with both versions** - The SDK should work with both zod 3.x and 4.x
3. **Use v3 API** - Stick to features available in zod 3.x for maximum compatibility

Example:

```typescript
// ✅ Correct
import { z } from "./zod-compat";

// ❌ Incorrect
import { z } from "zod";
import { z } from "zod/v3";
```

## Testing

The SDK includes comprehensive tests that verify compatibility with both zod versions. Run them with:

```bash
pnpm test
```

## Migration from Older Versions

If you're upgrading from an older version of the Braintrust SDK (< 1.1.0):

1. Install zod if it's not already in your dependencies:

   ```bash
   pnpm add zod@^3.25
   # or
   pnpm add zod@^4
   ```

2. No code changes required in your application - the SDK handles compatibility automatically.

## Troubleshooting

### "Cannot find module 'zod'"

Make sure zod is installed in your project:

```bash
pnpm add zod
```

### Version conflicts

If you see peer dependency warnings, ensure your zod version is `^3.25` or `^4`:

```bash
pnpm list zod
```

## Related Packages

The following packages are used for zod support:

- `zod` (peer dependency): Schema validation library
- `zod-to-json-schema` (dependency): Converts zod schemas to JSON Schema format

Both support zod 3.x and 4.x, ensuring seamless compatibility.
