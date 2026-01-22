# Template-Nunjucks Smoke Test

This smoke test validates that the `@braintrust/template-nunjucks` package correctly integrates with the Braintrust SDK to provide Nunjucks template rendering capabilities.

## What It Tests

1. **Basic Loop Rendering**: Tests that Nunjucks `for` loops work correctly with template data
2. **Conditional Rendering**: Validates `if/else` conditional logic in templates
3. **Template Format Option**: Ensures that templates only render when `templateFormat: "nunjucks"` is specified

## Running Locally

```bash
# From this directory
make test

# Or from the smoke test root
cd ../..
make test template-nunjucks
```

## Integration Points

This test verifies that:

- The `@braintrust/template-nunjucks` package can be imported
- The Nunjucks template engine is properly registered with Braintrust
- The `templateFormat` option correctly activates Nunjucks rendering
- Template variables and control structures are correctly interpolated
