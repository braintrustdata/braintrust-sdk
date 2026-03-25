---
name: instrumentation
description: Add or update Braintrust SDK instrumentation. Use when working on auto-instrumentation configs, tracing channels, provider plugins, vendored SDK typings, wrappers, or instrumentation-specific tests.
---

# Instrumentation Rules

- Non-invasive: instrumentation must not change user-visible behavior. Errors must still propagate, streams and promise subclasses must keep their original semantics, and any patch must be behavior-preserving and idempotent.
- Inputs are untrusted: treat args, results, events, headers, and metadata as hostile. Prototype pollution is a concrete risk here. Avoid unsafe property access patterns, prototype-sensitive operations, and unnecessary mutation of third-party objects.
- Support both auto-instrumentation and manual instrumentation. Auto-instrumentation does not cover every environment, loader, or framework.
- For orchestrion auto-instrumentation, prefer targeting public API functions. Instrumenting internal helpers is more likely to break across SDK versions.
- Auto and manual paths should share logic. Prefer both paths emitting the same tracing-channel events, with provider plugins converting those events into spans/logs/errors. Manual wrappers should not directly emit observability data.
- Preserve async context propagation. Changes around tracing channels, stream patching, or loader hooks must keep the current span context across awaits and stream consumption.
- Maintain isomorphic behavior. Node and browser/bundled paths must use compatible channel implementations and avoid channel-registry mismatches.
- Setup, teardown, and patching must be idempotent. Enabling twice, disabling twice, or applying a patch twice should remain safe.
- Promise/stream behavior must be preserved. Patches need to keep subclass/helper semantics intact.
- Contain instrumentation failures. Extraction/logging bugs should be logged or ignored as appropriate, but must not break the user call path.
- Log only the useful surface. Prefer narrow, stable payloads over dumping full request/response objects; exclude redundant or overly large data when possible.

## Process

Before implementing or changing instrumentation it is advisable to add or adjust the e2e tests for the desired change, make it fail, then implement the new instrumentation until the test passes.
