# Publishing Guide

This document explains how to publish the Braintrust JavaScript SDK to npm.

## Pre-Release Versions (Recommended)

The easiest way to publish is using pre-releases. This doesn't require updating `package.json` or creating git tags.

### Quick Start

Use Github Actions UI -> Publish JS SDK Pre-release.

## Stable Releases

For stable releases (published to `@latest`):

1. Update version in `js/package.json` (e.g., `0.4.3` → `0.4.4`)
2. Commit to `main` branch
3. Run:
   ```bash
   make publish-js-sdk
   ```
4. Confirm when prompted - this creates a git tag and triggers GitHub Actions
