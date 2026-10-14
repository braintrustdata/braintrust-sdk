---
"braintrust": minor
"@braintrust/otel": minor
---

feat: support OpenTelemetry span customizers

Run the existing synchronous `onSpanExport` registration on isolated plain OTel snapshots after filtering and origin enrichment. Preserve identity, timing and routing, honor content removal, and fail closed before OTLP serialization by stripping failed spans using the native pipeline's once-only safe diagnostics. Support public processors/exporters, compatibility mode, OTel 1.x/2.x, and ESM/CJS bundles without duplicate customization.

Keep resource snapshots isolated throughout the customizer chain so a later callback cannot mutate another span's export, including when the callback throws.

Deduplicate pending-resource waits within each customizer batch while preserving delayed attribute redaction and per-span snapshot isolation.
