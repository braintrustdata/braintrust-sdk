# Publishing Guide

This document explains how to publish the Braintrust JavaScript SDK to npm.

## Stable Releases

Stable releases are published from the `main` branch using git tags.

### Process

1. Update the version in `package.json` manually (e.g., `0.4.3` → `0.4.4`)
2. Commit the change to `main` branch
3. Run the tag push script:
   ```bash
   cd js
   ./scripts/push-release-tag.sh
   ```
4. The script will validate everything and prompt for confirmation
5. Once confirmed, it creates and pushes a tag (e.g., `js-sdk-v0.4.4`)
6. GitHub Actions automatically builds and publishes to npm as `latest`

Users install stable releases via:

```bash
npm install braintrust
# or
npm install braintrust@latest
```

## Pre-Release Versions

Pre-release versions (beta, alpha, rc) can be published from any branch **without updating `package.json`** in the repository.

### Process

You can publish pre-releases either **locally** or via **GitHub Actions**:

**Via GitHub Actions (default):**

```bash
cd js
make publish-prerelease TYPE=<beta|alpha|rc> BUMP=<prerelease|prepatch|preminor|premajor>
```

**Locally:**

```bash
cd js
make publish-prerelease TYPE=<beta|alpha|rc> BUMP=<prerelease|prepatch|preminor|premajor> LOCAL=true
```

You can also call the script directly:

```bash
cd js
./scripts/publish-prerelease.sh <beta|alpha|rc> <prerelease|prepatch|preminor|premajor>
```

### Parameters

**TYPE** - Pre-release type (determines npm dist-tag):

- `beta` → published to npm with tag `beta`
- `alpha` → published to npm with tag `alpha`
- `rc` → published to npm with tag `next`

**BUMP** - Version bump type:

- `prerelease` - Increment pre-release number (e.g., `0.4.4-beta.0` → `0.4.4-beta.1`)
- `prepatch` - Bump patch and add pre-release (e.g., `0.4.3` → `0.4.4-beta.0`)
- `preminor` - Bump minor and add pre-release (e.g., `0.4.3` → `0.5.0-beta.0`)
- `premajor` - Bump major and add pre-release (e.g., `0.4.3` → `1.0.0-beta.0`)

### Examples

**Via GitHub Actions:**

```bash
# Publish the next beta in sequence
# 0.4.3 → 0.4.4-beta.0  or  0.4.4-beta.0 → 0.4.4-beta.1
make publish-prerelease TYPE=beta BUMP=prerelease

# Publish alpha with patch bump
# 0.4.3 → 0.4.4-alpha.0
make publish-prerelease TYPE=alpha BUMP=prepatch

# Publish release candidate with minor bump
# 0.4.3 → 0.5.0-rc.0
make publish-prerelease TYPE=rc BUMP=preminor
```

**Locally:**

```bash
# Same commands with LOCAL=true flag
make publish-prerelease TYPE=beta BUMP=prerelease LOCAL=true

# Or call the script directly
./scripts/publish-prerelease.sh beta prerelease
./scripts/publish-prerelease.sh alpha prepatch
./scripts/publish-prerelease.sh rc preminor
```

### How It Works

**Via GitHub Actions:**

1. The Makefile triggers the GitHub Actions workflow
2. The workflow calls `publish-prerelease.sh` in the CI environment
3. Script temporarily updates `package.json`, builds, and publishes
4. **Package.json in the repo is never modified**

**Locally:**

1. The script temporarily updates `package.json` to the pre-release version
2. Builds the SDK
3. Prompts for confirmation before publishing
4. Publishes to npm with the appropriate dist-tag
5. **Restores `package.json` to original version after publishing**

Users install pre-releases via:

```bash
npm install braintrust@beta   # Latest beta version
npm install braintrust@alpha  # Latest alpha version
npm install braintrust@next   # Latest release candidate
```

### Viewing Published Pre-releases

Check published versions and tags on npm:

```bash
npm view braintrust versions --json
npm view braintrust dist-tags --json
```

Or visit: https://www.npmjs.com/package/braintrust?activeTab=versions

## Requirements

### For GitHub Actions Publishing

- **gh CLI**: Required to trigger workflows
  - Install: https://cli.github.com/
  - Authenticate: `gh auth login`

### For Local Publishing

- **npm credentials**: Must be logged in to npm
  - `npm login` or configure `~/.npmrc` with auth token
- **pnpm**: Package manager used for building
  - Will be used by the build script

## Files

### Workflows

- Stable releases: `.github/workflows/publish-js-sdk.yaml`
- Pre-releases: `.github/workflows/publish-js-sdk-prerelease.yaml`

### Scripts

- Pre-release publishing: `js/scripts/publish-prerelease.sh`
  - Contains all business logic for creating, building, and publishing pre-releases
  - Can be called directly or via Makefile/GitHub Actions
  - Automatically detects CI vs local environment
- Stable release validation: `js/scripts/validate-release.sh`
- Stable release tag management: `js/scripts/push-release-tag.sh`
