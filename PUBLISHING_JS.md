# JS SDK Release

## Recommended Path

Use the [Publish JavaScript SDK workflow](https://github.com/braintrustdata/braintrust-sdk-javascript/actions/workflows/publish-js-sdk.yaml) in GitHub Actions.

This is the primary release entrypoint for both stable releases and prereleases.

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

## Fallback CLI Trigger

If you do not want to open GitHub Actions manually, you can dispatch the same workflow from the terminal:

```bash
make release-js-sdk
```

To target a different remote branch:

```bash
make release-js-sdk BRANCH=<branch>
```

Notes:

- This is a fallback, not the recommended path.
- It requires `gh` to be installed and authenticated.
- It does not publish from your local checkout.
- It dispatches the same GitHub Actions workflow against the selected branch on GitHub.

## Repository Setup

Configure the `npm-publish` environment in GitHub repository settings with the required reviewers who are allowed to approve stable releases.
