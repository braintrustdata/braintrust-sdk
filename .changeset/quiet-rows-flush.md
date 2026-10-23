---
"braintrust": minor
---

feat(logger): batch log rows with a short flush delay

Batch nearby log rows into fewer HTTP requests in long-lived Node processes. Configure the delay and batch threshold with environment variables; serverless and other runtimes continue to flush immediately by default.
