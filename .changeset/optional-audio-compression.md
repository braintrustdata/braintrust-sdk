---
"braintrust": minor
"@braintrust/audio-utils": minor
---

feat: add optional Ogg/Opus compression through @braintrust/audio-utils. Enabled recordings use Ogg when the package is installed and WAV otherwise; explicit WAV bypasses codec loading. Audio encoding stays in the bounded SDK worker.
