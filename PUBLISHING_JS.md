# JS SDK Release

## Recommended Path

Use the [Publish JavaScript SDK workflow](https://github.com/braintrustdata/braintrust-sdk-javascript/actions/workflows/publish-js-sdk.yaml) in GitHub Actions.

This is the single npm publish entrypoint for stable releases, prereleases, and canaries.

We keep all npm publishes in one workflow file because npm trusted publishing only allows one configured GitHub Actions publisher per package.

Stable releases now pause at the `npm-publish` GitHub Actions environment and require approval before the publish job runs.

## Release Types

### Stable release

- Publishes the exact version already set in `js/package.json`
- Publishes to npm as the normal latest release
- Creates the `js-sdk-v<version>` git tag from the workflow
- Fails before publishing if that tag already exists on GitHub
- Waits for approval on the `npm-publish` environment before publishing

### Prerelease

- Uses the current `js/package.json` version as the base version
- Publishes `<version>-rc.<run_number>`
- Publishes to the `rc` npm dist-tag
- Does not update `js/package.json` in the repository

### Canary

- Can be triggered manually by running the same workflow with `release_type=canary`
- Publishes `<js/package.json version>-canary.<YYYYMMDD>.<run_number>.g<short_sha>`
- Publishes to the `canary` npm dist-tag
- Does not create a GitHub release
- Skips publishing if the current `HEAD` commit already matches the existing `canary` tag on npm
- Skips publishing unless the latest completed `js.yaml` run on the target branch succeeded

## Stable Release Checklist

1. Bump `js/package.json` according to [SEMVER](https://semver.org/) principles.
2. Make sure tests and integration tests pass on the PR.
3. Merge the change to `main` in `braintrust-sdk-javascript` and `braintrust`.
4. Open the [Publish JavaScript SDK workflow](https://github.com/braintrustdata/braintrust-sdk-javascript/actions/workflows/publish-js-sdk.yaml).
5. Click `Run workflow`.
6. Set `release_type=stable`.
7. Set `branch=main`.
8. Run the workflow.
9. Approve the pending `npm-publish` environment deployment when prompted.
10. Monitor the run at https://github.com/braintrustdata/braintrust-sdk-javascript/actions/workflows/publish-js-sdk.yaml.
11. Spot check the package at https://www.npmjs.com/package/braintrust.
12. Update relevant docs ([internal](https://www.notion.so/braintrustdata/SDK-Release-Process-183f7858028980b8a57ac4a81d74f97c#2f1f78580289807ebf35d5e171832d2a)).
13. Run the test app at https://github.com/braintrustdata/sdk-test-apps (internal) with `make verify-js`.

## Prerelease Steps

1. Open the [Publish JavaScript SDK workflow](https://github.com/braintrustdata/braintrust-sdk-javascript/actions/workflows/publish-js-sdk.yaml).
2. Click `Run workflow`.
3. Set `release_type=prerelease`.
4. Set `branch` to the branch you want to prerelease from.
5. Run the workflow.

If you prerelease from a non-`main` branch, make sure that branch is in the state you intend to publish.

## Nightly Canary

Nightly canary scheduling now lives in the separate [Schedule JavaScript SDK Canary Publish workflow](https://github.com/braintrustdata/braintrust-sdk-javascript/actions/workflows/publish-js-sdk-canary-scheduler.yaml).

- The scheduler only dispatches [Publish JavaScript SDK](https://github.com/braintrustdata/braintrust-sdk-javascript/actions/workflows/publish-js-sdk.yaml) with `release_type=canary` and `branch=main`.
- The actual npm publish still runs in `publish-js-sdk.yaml`, so npm trusted publishing only needs that one workflow configured as the publisher.
- Manual canary runs still use the publish workflow dispatch form directly.
- Install with `npm install braintrust@canary`.

The workflow writes a short run summary with the published version and recent commits touching `js/` so there is at least a lightweight change summary even though there is no formal changelog.

## Fallback CLI Trigger

If you do not want to open GitHub Actions manually, you can dispatch the same workflow from the terminal:

```bash
make release-js-sdk
```

To target a different remote branch:

```bash
make release-js-sdk BRANCH=<branch>
```

To dispatch a prerelease or canary instead of a stable release:

```bash
make release-js-sdk RELEASE_TYPE=prerelease
make release-js-sdk RELEASE_TYPE=canary
```

Notes:

- This is a fallback, not the recommended path.
- It requires `gh` to be installed and authenticated.
- It does not publish from your local checkout.
- It dispatches the same GitHub Actions workflow against the selected branch on GitHub.
- `RELEASE_TYPE` defaults to `stable`.

## Repository Setup

Configure the `npm-publish` environment in GitHub repository settings with the required reviewers who are allowed to approve stable releases.
