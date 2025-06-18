# Build Memory Optimization

This document explains the memory optimization solution implemented to fix the "out of memory" (OOM) issues encountered during the build process.

## Problem

The `pnpm build` command was running out of memory during the TypeScript declaration file (DTS) generation phase. This is a common issue with large TypeScript projects because type checking and declaration file generation can be very memory-intensive.

## Solution

The solution consists of two main parts:

1. **Increased Node.js memory limit**: Modified the build script to allocate more memory to the Node.js process.
2. **Optimized TypeScript configuration**: Updated the tsup configuration to reduce memory usage during DTS generation.

### Changes Made

1. **Package.json**:

   - Added `cross-env` as a dev dependency
   - Updated the build script to include `NODE_OPTIONS="--max-old-space-size=8192"` to increase memory allocation

2. **tsup.config.ts**:
   - Added DTS-specific configurations to optimize memory usage
   - Used `skipLibCheck: true` to skip type checking of declaration files in node_modules
   - Added `splitting: true` to enable code splitting, which can reduce the memory requirements
   - Disabled DTS generation for the CLI build since it's not needed
   - Used proper `clean` settings to avoid redundant operations

## How It Works

- **Memory Limit Increase**: The `--max-old-space-size=8192` option tells Node.js to allocate up to 8GB of memory for the build process, reducing the chance of OOM errors.
- **Skip Library Checking**: By enabling `skipLibCheck`, we avoid type-checking node_modules, which significantly reduces memory usage.
- **Code Splitting**: This helps break up the build into smaller chunks that require less memory to process.

## Future Considerations

If you encounter OOM issues again in the future, consider these additional options:

1. **Further increase memory limit**: You could increase `--max-old-space-size` to a higher value if your system has more available memory.
2. **Split the build process**: You could further divide the build into separate commands for each entry point.
3. **Incremental builds**: Consider using TypeScript's incremental builds feature for development.
4. **Reduce type complexity**: Review complex types that might be causing excessive memory usage during type checking.

## References

- [tsup documentation](https://tsup.egoist.dev/)
- [TypeScript memory optimization](https://github.com/microsoft/TypeScript/wiki/Performance)
- [Node.js memory options](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-megabytes)
