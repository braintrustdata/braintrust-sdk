---
"braintrust": minor
---

feat(logs): add application logging and console capture

Record application messages with `logger.trace()`, `debug()`, `info()`, `warn()`,
`error()`, and `fatal()`. Preserve native JavaScript message templates with
`logger.fmt` and capture future console calls with `wrapConsole()`, which returns
a cleanup function. Logs share the active span's context and upload as a single
complete event.
