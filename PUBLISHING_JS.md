# JS SDK Release

## Prerelease Instructions

- Go to [JS SDK release workflow](https://github.com/braintrustdata/braintrust-sdk-javascript/actions/workflows/publish-js-sdk.yaml)
- Click `Run Workflow`
- Pick which branch you want to pre-release and run workflow to pre-release JS SDK version
  - When creating a pre-release off a non-main branch, ensure your branch is up to date with main.

## Release Instructions

- Cut a PR that bumps version number in https://github.com/braintrustdata/braintrust-sdk/blob/main/js/package.json#L3 according to [SEMVER](https://semver.org/) principles (e.g., `0.4.3` → `0.4.4`).
- Make sure the tests & integration tests PR pass.
- Merge to main in `braintrust-sdk-javascript` and `braintrust` repos.
- In the `braintrust-sdk-javascript` repo, check out the correct commit and verify you are in a sane state to release code.

  ```bash
  make release-js-sdk
  ```

- This creates a git tag and triggers GitHub Actions
- Monitor release at https://github.com/braintrustdata/braintrust-sdk-javascript/actions/workflows/publish-js-sdk.yaml
- Update relevant docs ([internal](https://www.notion.so/braintrustdata/SDK-Release-Process-183f7858028980b8a57ac4a81d74f97c#2f1f78580289807ebf35d5e171832d2a))
