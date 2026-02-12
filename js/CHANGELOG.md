# Changelog

## Unreleased

### Fixed

- Fixed dataset `_internal_btql` parameter to properly override default BTQL settings (e.g., custom limit values). Previously, when passing `_internal_btql: { limit: 1 }` to `initDataset()`, the SDK would overwrite the custom limit with `DEFAULT_FETCH_BATCH_SIZE` (1000).

Release notes can be found [here](https://www.braintrust.dev/docs/reference/release-notes).
