# Voice schema option: call timeline

> AI-created or modified and not human-reviewed in its current form; treat this artifact as provisional. Updated 2026-10-12.

In this option, integrations log what they observe during a call as an ordered, append-only list of timestamped events. Lingua builds speech, turns, latencies and overlaps from that list. The SDK records observations only; it does not decide what a turn or an utterance is.

Implemented in this PR: the zod schema (`js/src/instrumentation/livekit/voice-schema/call-timeline.ts`), the two example traces (`examples/`), and a test that parses them and checks ordering and start/end pairing. Everything else here is a sketch: the LiveKit and Pipecat capture, and the Lingua mapping. The Lingua side is specified in the companion Lingua PR (`specs/voice-schema-call-timeline.md`).

## Customer problem

A customer debugging a voice agent needs to answer five questions:

- What did each side say?
- What did it sound like?
- Where did time go between the caller finishing and the agent speaking?
- Who talked over whom?
- Which tool call caused a pause?

Today the evidence is scattered. It sits in span names (`user_turn`, `livekit.agent_speaking`), vendor keys (`contrib.livekit.*`, `contrib.pipecat.*`), span start times on different clocks, and selections that exist only after upload. Realtime pipelines make this worse: transcripts arrive late or never, and the provider's view of an interruption differs from what the caller heard.

## Contract

### Where it lives

The integration buffers events and flushes them as **timeline rows**. These are child spans of the call span (the span that logs `audio.recordings`).

| Field                           | Location               | Type                  | Req. | Meaning                                                                           |
| ------------------------------- | ---------------------- | --------------------- | ---- | --------------------------------------------------------------------------------- |
| span name                       | `span_attributes.name` | `"voice.timeline"`    | yes  | Stable name; one row per chunk                                                    |
| span type                       | `span_attributes.type` | `"task"`              | yes  |                                                                                   |
| parent                          | `span_parents[0]`      | span id               | yes  | The call span                                                                     |
| `voice.timeline.call_span_id`   | `metadata`             | string                | yes  | Span id of the call span (repeated so Lingua can index chunks from headers alone) |
| `voice.timeline.chunk_index`    | `metadata`             | int ≥ 0               | yes  | 0, 1, 2… per call, no gaps                                                        |
| `voice.timeline.final`          | `metadata`             | bool                  | yes  | `true` only on the last chunk, written at call end                                |
| `voice.events`                  | `metadata`             | `VoiceEvent[]`, 1–256 | yes  | Events with consecutive `seq`                                                     |
| `metrics.start` / `metrics.end` | row                    | unix s                | yes  | First and last event's wall time; used only for ordering spans in the trace tree  |

**Flush rule:**

- Flush when 64 events are buffered, when the oldest buffered event is 5 s old, or at call end.
- A chunk is never rewritten. Late information becomes a new event in a later chunk.

**Why child rows, not the call span:**

- Rewriting one growing array on the call span would make each merge O(n).
- It would also hit row-size limits on long calls.
- It would also hide the timeline until the call ends.

**Why `metadata`, not `input`/`output`:** Lingua builds `voice_calls` from span headers, without fetching payloads (`TRAJECTORY_METADATA_FIELDS`). A 64-event chunk is about 15–25 KB with transcripts and about 8 KB without.

### `VoiceEvent`

Common fields:

| Field   | Type                               | Req. | Meaning                                                                                                 |
| ------- | ---------------------------------- | ---- | ------------------------------------------------------------------------------------------------------- |
| `seq`   | int ≥ 0                            | yes  | Per-call sequence, consecutive across chunks. Defines order when `at_ms` ties; a gap means a lost chunk |
| `at_ms` | number                             | yes  | **Call ms**: milliseconds since `audio.recordings[*].timeline.origin_unix_ms`                           |
| `basis` | `"audio" \| "local" \| "provider"` | yes  | How `at_ms` was obtained (see Timing)                                                                   |
| `kind`  | enum below                         | yes  |                                                                                                         |

Kinds:

| `kind`           | Extra fields (req. unless `?`)                                                               | Emitted when                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `speech_start`   | `speaker`, `utterance_id`, `response_id?`                                                    | Caller speech detected (VAD), or agent audio starts playing out                                                      |
| `speech_end`     | `speaker`, `utterance_id`, `interrupted?`, `played_ms?`                                      | Caller speech stops, or agent playout stops (finished or cut)                                                        |
| `transcript`     | `speaker`, `utterance_id`, `final`, `source: stt\|provider\|playout`, `text?`, `message_id?` | STT or provider transcription arrives; for the agent, the text actually played                                       |
| `end_of_turn`    | `utterance_ids[]`                                                                            | The turn detector commits the caller's turn                                                                          |
| `response_start` | `response_id`, `span_id`, `in_reply_to?[]`                                                   | An LLM or realtime generation starts                                                                                 |
| `tool_call`      | `response_id`, `tool_call_id`, `name`, `span_id`                                             | A tool starts running                                                                                                |
| `tool_result`    | `tool_call_id`, `span_id`, `outcome: ok\|error\|cancelled`                                   | The tool finishes, fails, or is cancelled                                                                            |
| `truncate`       | `utterance_id`, `audio_end_ms`                                                               | Realtime provider truncation of an agent item; `audio_end_ms` is the item-relative position reported to the provider |
| `missing`        | `evidence: transcript\|speech_end\|audio\|tool_result`, `reason`, `utterance_id?`            | The SDK knows that expected evidence will never arrive                                                               |
| `call_end`       | `reason`                                                                                     | Session closed; must be the last event                                                                               |

`text` is omitted when content capture is off. Every other field is timing or identity and is always logged.

## IDs and relationships

- **`utterance_id`:** one contiguous stretch of speech by one speaker, unique per call. It is the join key for `speech_start`, `speech_end`, `transcript`, `truncate` and `missing`.
  - Caller: the provider item id when one exists (realtime), otherwise an SDK counter `u<n>`.
  - Agent: the realtime item id, or the LiveKit `speech_id` or Pipecat TTS `context_id` with a counter suffix if one handle plays several stretches.
- **`response_id`:** one model generation.
  - Realtime uses the provider response id; LiveKit cascaded uses `generation_id`; Pipecat uses an SDK counter.
  - `response_start.span_id` is the Braintrust span id of the `llm_response` span. This is the only link from the timeline into the step tree.
- **`tool_call_id`:** the provider tool call id. `span_id` on `tool_call` and `tool_result` is the tool span.
- **`in_reply_to`:** the caller utterances whose turn triggered this generation, when the framework knows them. LiveKit knows the committed user message for both pipelines; Pipecat knows the aggregated user turn.
- **Agent speech to a generation:** `speech_start.response_id` ties agent speech to the generation that produced it.
- **Messages:** `message_id` on `transcript` links to the framework chat item (LiveKit `ChatMessage.id`, realtime item id). Lingua can use it to match conversation messages; it is optional.
- **Turns are not emitted.** A turn is inferred by Lingua: one `end_of_turn`, the responses that reply to it, and the agent speech they produce.

## Timing semantics

- **One clock.** `at_ms` is on the call clock, the same one the recording uses: `origin_unix_ms` comes from `snapshot().origin` in `@braintrust/audio`. A call ms `t` maps to segment `s` at offset `t - s.timeline.recording_start_offset_ms` when `s` is ready and covers `t`.
- **`basis` values:**
  - `audio`: derived from sample positions the recorder placed on the timeline (the caller frame anchor plus samples, or playout ranges from `playbackProgressed`). This is the best value and matches the recording by construction.
  - `local`: `Date.now() - origin` when a hook fires. Callbacks are delayed by event-loop latency, typically under 20 ms.
  - `provider`: a provider-reported time converted to the call clock. For example, OpenAI `audio_start_ms`/`audio_end_ms` are relative to the input audio buffer the SDK streamed; the SDK adds the call ms at which that buffer began. Use it when the provider's VAD defines the boundary.
- **Delay meanings:**
  - `played_ms` on an agent `speech_end` is audio actually played out.
  - `truncate.audio_end_ms` is what the provider was told. The two can differ by the output buffer: in the realtime example, 2600 vs 2900.
- **No timeline without a recording.** If no recording exists, there is no origin. Integrations still emit the timeline using `origin = session start Date.now()` and log `voice.timeline_origin_unix_ms` on the call span; without a recording, Lingua treats `audio` basis as `local`.

## What integrations capture, and when

### LiveKit (JS, `js/src/instrumentation/livekit`)

| Event                               | Cascaded (`AgentActivity._pipelineReplyTaskImpl`)                                                                                                    | Realtime (`_realtimeGenerationTaskImpl`, `RealtimeObserver`)                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| user `speech_start` / `speech_end`  | `EndOfTurnInfo.startedSpeakingAt` / `stoppedSpeakingAt` in `onEndOfTurn` (`local`); refined to `audio` from capture anchors when audio capture is on | `input_speech_started` / `input_speech_stopped` (`local`), or provider `audio_start_ms`/`audio_end_ms` (`provider`) when exposed |
| user `transcript`                   | `user_input_transcribed` (final only), `source: stt`                                                                                                 | `input_audio_transcription_completed`, `source: provider`; may arrive after `response_start`                                     |
| `end_of_turn`                       | `onEndOfTurn` hook                                                                                                                                   | `input_audio_buffer.committed` / `userTurnCompleted`                                                                             |
| `response_start`                    | `llm_response` span start (`processor.ts` `onStart`), `response_id = generation_id`                                                                  | realtime `llm_response` start, `response_id = contrib.livekit.response_id`                                                       |
| `tool_call` / `tool_result`         | `function_tool` span start / end; `outcome` from `function_tool.is_error`, or `cancelled` when the speech handle was interrupted before the result   | same                                                                                                                             |
| agent `speech_start` / `speech_end` | `playback.ts`: first `playbackProgressed.startedAt` / `playbackFinished` (`audio`), `interrupted`, `played_ms = playbackPosition`                    | same                                                                                                                             |
| agent `transcript`                  | `_conversationItemAdded` assistant item, `source: playout` (synchronized transcript)                                                                 | same, `source: provider`                                                                                                         |
| `truncate`                          | —                                                                                                                                                    | `RealtimeSession.truncate` call (hook)                                                                                           |
| `missing`                           | at close: user utterances with no final transcript                                                                                                   | same; common for barge-ins                                                                                                       |
| `call_end`                          | `closeImpl`                                                                                                                                          | same                                                                                                                             |

Starting point: add a `Timeline` class beside `turns.ts`. It holds `seq`, a buffer and the flush rule, and is owned by the per-session `Capture`/processor state. `TurnTracker` grouping is no longer needed for emission: the timeline logs raw fragments and Lingua groups them.

### Pipecat (Python, sketch against `sdk-python` `delner/pipecat-voice-recording`)

| Event                               | Cascaded                                                                                                                                                                       | Realtime (OpenAI/Gemini realtime services)                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| user `speech_start` / `speech_end`  | `VADUserStartedSpeakingFrame` / `VADUserStoppedSpeakingFrame`; `audio` basis from input sample clock (`_audio` alignment)                                                      | provider `input_audio_buffer.speech_started/stopped` (`provider`)               |
| user `transcript`                   | `TranscriptionFrame` (`finalized`), `source: stt`                                                                                                                              | `TranscriptionFrame` from the service's input transcription, `source: provider` |
| `end_of_turn`                       | `UserStoppedSpeakingFrame` after the turn strategy commits                                                                                                                     | service commit event                                                            |
| `response_start`                    | `LLMFullResponseStartFrame` (`llm_response` span)                                                                                                                              | same                                                                            |
| `tool_call` / `tool_result`         | `FunctionCallInProgressFrame` / `FunctionCallResultFrame` / `FunctionCallCancelFrame`                                                                                          | same                                                                            |
| agent `speech_start` / `speech_end` | `BotStartedSpeakingFrame` / `BotStoppedSpeakingFrame` at transport output (`audio` from output write observation); `interrupted` when an `InterruptionFrame` preceded the stop | same                                                                            |
| agent `transcript`                  | `TTSTextFrame` text accumulated per `context_id`, cut at interruption, `source: playout`                                                                                       | provider transcript, `source: provider`                                         |
| `truncate`                          | —                                                                                                                                                                              | service truncation call                                                         |

## What Lingua records versus infers

**Recorded (copied, normalized):**

- Events sorted by `seq` into `VoiceCall.events`.
- Recordings, unchanged from #486.

**Inferred:**

- `Speech` entries: one per `utterance_id` with a `speech_start`. Selections come from `[start, end]` intersected with ready recordings. `interrupted` comes from `speech_end`.
- `Speech.step_ids`:
  - Agent: the `response_start.span_id` of its `response_id`.
  - Caller: the `span_id` of each `response_start` whose `in_reply_to` contains it.
  - Without `in_reply_to`: the first `response_start` after its `end_of_turn`, flagged as inferred.
- Latencies and overlaps (see `VoiceCall.events` consumers below).

**Not inferred:**

- Text that was never transcribed.
- A `speech_end` that never arrived. Lingua reports a warning and clips the speech at the next event or at `call_end`.

## Trajectory and app mapping

`Trajectory.voice_calls[*]` keeps the #486 fields. `speech` and `recordings` are built from the timeline instead of turn spans, so #22034 and #22036 work unchanged: the voice bar, click-to-step, play-from-message and highlighting all read `speech[].step_ids` and `selections`.

The new field `VoiceCall.events` exposes the normalized log for:

- a latency strip showing caller end → `end_of_turn` → `response_start` → first agent `speech_start`;
- overlap shading, from intersecting caller and agent speech;
- "no transcript" badges, from `missing` events.

Thread messages still come from the LLM spans' inputs and outputs, as today.

## Worked example

`examples/cascaded.json` and `examples/realtime.json` encode the same fictional call (see the scenario in the comparison note). Row tree:

```
livekit.agent_session            audio.recordings: call-0000 (13 s)
├── llm_response  llm-1 / rt-1   → find_slots
├── find_slots    tool-1
├── llm_response  llm-2 / rt-2   "I have nine thirty or eleven on Friday…"
├── tts           tts-1          (cascaded only)
├── llm_response  llm-3 / rt-3   → reschedule
├── reschedule    tool-2
├── llm_response  llm-4 / rt-4   "Done — you're booked…"
├── tts           tts-2          (cascaded only)
├── voice.timeline timeline-0    seq 0–11
└── voice.timeline timeline-1    seq 12–22/23, final
```

Concrete differences, same audio:

|                                                  | Cascaded                                                                          | Realtime                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Caller transcript of turn 1                      | `transcript` at 3450 (`stt`), before `response_start`                             | `transcript` at 4300 (`provider`), **after** `tool_call` at 4100                                                           |
| Turn-1 latency (end_of_turn → first agent audio) | 3400 → 5300 = 1900 ms: 50 ms STT, 650 ms LLM, 500 ms tool, 500 ms LLM, 200 ms TTS | 3400 → 5000 = 1600 ms: 200 ms to response, 500 ms to the tool call, 500 ms tool, 400 ms to audio                           |
| Barge-in                                         | agent `speech_end` 7900, `interrupted`, `played_ms` 2600                          | `truncate` at 7600 (`audio_end_ms` 2600) **and** `speech_end` at 7900 (`played_ms` 2900); a 300 ms disagreement is visible |
| Agent text actually said                         | `playout` transcript "…on Fri" vs planned text in `llm-2` output                  | provider transcript of the truncated item; `rt-2` output already holds the truncated text                                  |
| Caller's barge-in text                           | `stt` transcript at 8600                                                          | **none**: `missing{evidence: transcript}` at 13000; `rt-3` input user content is `""`                                      |
| IDs                                              | `u1`, `a1`, `r1` SDK ids                                                          | provider item and response ids (`item_u1`, `resp_1`)                                                                       |
| Separate STT/TTS steps                           | `tts-1`, `tts-2`                                                                  | none                                                                                                                       |

## Customer usefulness

- **What was said: good.**
  - Final transcripts with provenance.
  - Agent text that was actually played, separate from generated text.
  - Missing transcripts are explicit.
- **Playing matching audio: good.**
  - Every speech interval is on the recording clock.
  - Selections are computed by Lingua, so they work across segment boundaries and before upload metadata exists.
- **Diagnosing delays: strongest of the options.**
  - Every gap between caller end, end-of-turn, generation, tool and first audio is a subtraction on one clock, including realtime.
- **Interruptions and overlap: strong.**
  - Overlap comes from intervals, interruption from `speech_end`.
  - The provider-versus-playout truncation gap is visible.
- **Following tools: adequate.**
  - The timeline places tools in time and links them to spans.
  - Tool arguments and results stay on tool spans.
- **Missing or uncertain evidence: strong.**
  - `basis` on every timestamp.
  - `missing` events.
  - `seq` gaps reveal lost chunks.
  - `final` reveals an in-progress call.

## Edge cases and weaknesses

- **Barge-in truncation:** handled, as above. The planned text remains only on the LLM span.
- **Overlap:** intervals can overlap freely, and Lingua does not merge them.
- **Late or missing realtime transcripts:** a late transcript is a later event with the same `utterance_id`. Missing ones get `missing`. Weakness: if the provider never reports which item was being transcribed, the SDK must guess the `utterance_id`, as `TurnTracker.transcript` does today.
- **Failed or omitted segments:** speech still has times but no selection in that range. Lingua emits partial selections and the app shows silence. This is better than #486, where a failed segment drops the turn's selections.
- **Unknown clock offset:** `basis: local` events skew relative to `audio` events, and nothing measures that skew. A `clock_offset` event (local vs audio at the same instant) could carry it; this is not specified.
- **Call in progress:** chunks appear every 5 s or 64 events, so the latest ≤5 s are invisible. Lingua warns when no chunk is `final`.
- **Content capture off:** `text` is dropped and everything else stays, so timing analysis still works.
- **Tool cancelled by interruption:** `tool_result{outcome: cancelled}`. The cancellation's cause is not linked; it is inferred from an agent `speech_end{interrupted}` near the same time.
- **Agent handoff:** handoffs are not modeled. Events from a new agent activity continue the same log. A `speaker`-level agent name would be needed to show which agent spoke. This is a weakness.
- **Duplicate observers:** two hooks for the same moment (LiveKit native `user_turn` plus realtime events) must emit one event. The SDK owns dedup, and Lingua does not dedup.
- **Main weakness overall: indirection.** Speech, turns and the step links all depend on Lingua's derivation being right, and the raw spans in the trace tree no longer show speech on their own. Debugging the derivation means reading an event log. Row volume is low (one row per 64 events), but it is a new kind of row in the trace tree.

## Implementation starting point

1. Lock the event schema from `call-timeline.ts`, including `basis` and the flush rule.
2. LiveKit: add `timeline.ts` (buffer, `seq`, flush) to the session state in `processor.ts`. Emit from the hooks already present: `onEndOfTurn`, `RealtimeObserver` listeners, `playback.ts` `settle`, `_conversationItemAdded`, and `onStart`/`onEnd` for `llm_response` and `function_tool`. Keep existing spans and selections during the transition.
3. Add `missing` at close: utterances without a final transcript, and starts without ends.
4. Lingua: implement `specs/voice-schema-call-timeline.md`, starting with speech and selections from the timeline, then `step_ids`, then `events` on `VoiceCall`.
5. Pipecat: port `timeline.ts` to the Python `voice` package using the frame table above.

## Open questions

- Should `end_of_turn` carry the detector's delay and probability (LiveKit `eou.*`), or should those stay on the native `eou` spans?
- Are 5 s and 64 events the right flush defaults for live viewing versus row count?
- Should agent `transcript` events carry word-level timings when the TTS provides alignments?
