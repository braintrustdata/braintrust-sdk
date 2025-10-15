# Publishing Guide

This document explains how to publish the Braintrust JavaScript SDK to npm.

## Pre-Release Versions (Recommended)

The easiest way to publish is using pre-releases. This doesn't require updating `package.json` or creating git tags.

### Quick Start

From the SDK root:

```bash
make publish-js-sdk-prerelease MODE=local BUMP=prepatch
```

This publishes a new beta version locally (e.g., `0.4.3` → `0.4.4-beta.0`).

### Options

**BUMP** - How to increment the version:

- `prepatch` (default) - Bump patch and add `-beta.0` (e.g., `0.4.3` → `0.4.4-beta.0`)
- `prerelease` - Increment beta number (e.g., `0.4.4-beta.0` → `0.4.4-beta.1`)
- `preminor` - Bump minor and add `-beta.0` (e.g., `0.4.3` → `0.5.0-beta.0`)
- `premajor` - Bump major and add `-beta.0` (e.g., `0.4.3` → `1.0.0-beta.0`)

**TYPE** - Pre-release tag (defaults to `beta`):

- `beta` → npm tag `@beta`
- `alpha` → npm tag `@alpha`
- `rc` → npm tag `@next`

**MODE** - Where to publish:

- `local` - Publish from your machine
- `gh` - Trigger GitHub Actions to publish

### Examples

```bash
# Publish next beta in sequence
make publish-js-sdk-prerelease MODE=local BUMP=prerelease

# Publish alpha with patch bump
make publish-js-sdk-prerelease MODE=local TYPE=alpha BUMP=prepatch

# Publish via GitHub Actions
make publish-js-sdk-prerelease MODE=gh BUMP=prepatch
```

Users install pre-releases via:

```bash
npm install braintrust@beta
```

## Stable Releases

For stable releases (published to `@latest`):

1. Update version in `js/package.json` (e.g., `0.4.3` → `0.4.4`)
2. Commit to `main` branch
3. Run:
   ```bash
   make publish-js-sdk
   ```
4. Confirm when prompted - this creates a git tag and triggers GitHub Actions

## Requirements

**For local publishing:**

- npm credentials: `npm login`

**For GitHub Actions publishing:**

- gh CLI: `gh auth login`

## View Published Versions

```bash
npm view braintrust versions --json
npm view braintrust dist-tags --json
```

Or visit: https://www.npmjs.com/package/braintrust?activeTab=versions
