# Jest Node.js Smoke Test

Tests Braintrust SDK in a Jest environment with Node.js runtime.

## Design Decisions

**Tarball installation:** Uses well-known tarball path (`braintrust-latest.tgz`) to avoid package.json changes on version bumps.

**CommonJS mode:** Jest works best with CommonJS, so `type: "commonjs"` is used.

**Shared test suites:** Leverages `../../shared` for consistent test coverage across all scenarios.

**Test structure:** Both legacy simple span tests and modern shared suite tests are included to verify Jest compatibility.
