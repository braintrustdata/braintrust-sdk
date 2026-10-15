---
"braintrust": minor
---

feat(livekit): add automatic voice traces and optional recordings

Add automatic LiveKit Agents tracing through the standard loader and logger for cascade, realtime, duplex, and half-cascade sessions. Use common user_speech and agent_speech spans for recognized and played text, preserving overlap, native grouping, and late transcripts. Keep model, synthesis, and tool operations distinct, with relationship links in metadata.links for observed context and generation relationships (temporary schema v2 prototype transport). Preserve native usage and suppress redundant provider instrumentation within LiveKit inference work.

Support opt-in caller and agent recordings through the optional `@braintrust/audio` package, with playback selections on speech spans. Default recordings to Ogg; preserve text and metadata tracing when the extension is unavailable. Include `braintrust/livekit` APIs for manually managed telemetry.
