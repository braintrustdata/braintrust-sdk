# Voice schema option: call timeline

> AI-created or modified and not human-reviewed in its current form; treat this artifact as provisional. Updated 2026-10-12.

In this option, integrations log what they observe during a call as an append-only event log. Each event records a speech segment boundary, a transcript, an end-of-turn decision, a generation, a tool call or a playout stop.

- **The SDK** emits one caller utterance per voice-activity-detection (VAD) speech segment. It never builds turns.
- **Lingua** groups utterances into turns at `end_of_turn` events. It links speech to steps and cuts audio selections.
- **The app** computes latencies and overlaps from the log.

**Implemented in this PR:**

- the zod schema (`js/src/instrumentation/livekit/voice-schema/call-timeline.ts`)
- the two example traces (`examples/`)
- a test that parses them and checks versioning, `seq`, start/end pairing and utterance references

**Sketched only:** LiveKit and Pipecat capture, and the Lingua mapping. The Lingua side is in the companion Lingua PR (`specs/voice-schema-call-timeline.md`).

## Customer problem

A customer debugging a voice agent needs to answer five questions:

- What did each side say?
- What did it sound like?
- Where did time go between the caller finishing and the agent speaking?
- Who talked over whom?
- Which tool call caused a pause?

Today that evidence is scattered. It sits in span names (`user_turn`, `livekit.agent_speaking`), in vendor keys (`contrib.livekit.*`, `contrib.pipecat.*`), in span times on different clocks, and in selections that exist only after upload. Realtime pipelines add transcripts that arrive late or never, and an interruption point reported by the provider that differs from what the caller heard.

## Contract

### Call span

The call span is the span that logs `audio.recordings`, or the session span when there is no recording.

| Metadata key                    | Type                                         | Req.                     | Meaning                                                                                                                                  |
| ------------------------------- | -------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `voice.timeline_version`        | `1`                                          | yes                      | Marks the call as using this contract. Lingua builds timeline speech only when it is present; otherwise it uses the #486 turn-span path. |
| `voice.pipeline`                | `"cascaded" \| "realtime" \| "half_cascade"` | yes                      | Pipeline shape, set at session start. `half_cascade` is a text realtime model plus TTS.                                                  |
| `voice.timeline_origin_unix_ms` | number                                       | only without a recording | Origin of the call clock when `audio.recordings` is absent.                                                                              |

### Timeline rows

The integration buffers events and flushes them as **timeline rows**: child spans of the call span.

| Field            | Location                        | Type                         | Req. | Meaning                                                                            |
| ---------------- | ------------------------------- | ---------------------------- | ---- | ---------------------------------------------------------------------------------- |
| name, type       | `span_attributes`               | `"voice.timeline"`, `"task"` | yes  | One row per chunk                                                                  |
| parent           | `span_parents[0]`               | span id                      | yes  | The call span                                                                      |
| `voice.timeline` | `metadata`                      | object                       | yes  | `{ call_span_id, chunk_index, final }`, described below                            |
| `voice.events`   | `metadata`                      | `VoiceEvent[]`, 1–256        | yes  | Events with consecutive `seq`                                                      |
| start, end       | `metrics.start` / `metrics.end` | unix s                       | yes  | Min and max event time in the chunk. Used only to place the row in the trace tree. |

The `voice.timeline` object:

- `call_span_id` (string): span id of the call span, repeated so Lingua can index chunks from headers.
- `chunk_index` (int ≥ 0): 0, 1, 2… per call.
- `final` (bool): `true` only on the chunk written at call end.

**Flush and retry:**

- **Flush:** at 64 buffered events, when the oldest buffered event is 5 s old, or at call end.
- **Backlog:** if a flush is still in flight, the buffer keeps growing up to 256 events and the next chunk carries the backlog. Past 256, the SDK drops new events and logs a `missing{evidence: "timeline"}` event in the next chunk.
- **Retry:** a retried chunk reuses its `chunk_index` and `seq` values, so Lingua drops identical duplicates.
- **Immutability:** chunks are never rewritten, and late facts become new events.

**Placement:**

- **Child rows, not the call span:** a growing array on the call span would cost O(n) per merge, hit row limits on long calls, and hide the log until the call ends.
- **`metadata`, not `input`:** Lingua builds `voice_calls` from headers without fetching payloads. A 64-event chunk is about 15–25 KB with transcripts and about 8 KB without.

### `VoiceEvent`

| Common field | Type                               | Req. | Meaning                                                                                      |
| ------------ | ---------------------------------- | ---- | -------------------------------------------------------------------------------------------- |
| `seq`        | int ≥ 0                            | yes  | Emission order, consecutive per call across chunks. A gap means a lost or unflushed chunk.   |
| `at_ms`      | number                             | yes  | When the thing happened, in **call ms** (see Timing). Not necessarily increasing with `seq`. |
| `basis`      | `"audio" \| "local" \| "provider"` | yes  | How `at_ms` was obtained                                                                     |
| `kind`       | enum below                         | yes  |                                                                                              |

| `kind`           | Extra fields (`?` = optional)                                        | Meaning and timing                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `speech_start`   | `speaker`, `utterance_id`, `response_id?`                            | Start of one VAD speech segment (caller) or of playout (agent)                                                                                                  |
| `speech_end`     | `speaker`, `utterance_id`, `interrupted?`, `played_ms?`              | Real end of that segment: for the caller, the VAD stop time minus the VAD silence delay; for the agent, the playout stop. `played_ms` is audio actually played. |
| `transcript`     | `speaker`, `utterance_id`, `final`, `source`, `text?`, `message_id?` | Text for one utterance. `at_ms` is when the text arrived. `source` is `stt`, `provider` or `playout`.                                                           |
| `message`        | `speaker`, `message_id`, `utterance_ids[]`                           | The framework committed a chat item made from these utterances                                                                                                  |
| `end_of_turn`    | `utterance_ids[]`                                                    | The turn detector committed the caller's turn; lists the caller utterances since the previous `end_of_turn`                                                     |
| `response_start` | `response_id`, `span_id`, `in_reply_to?[]`                           | An LLM or realtime generation started. `span_id` is its `llm_response` span.                                                                                    |
| `tool_call`      | `response_id`, `tool_call_id`, `name`, `span_id`                     | A tool started                                                                                                                                                  |
| `tool_result`    | `tool_call_id`, `span_id`, `outcome`                                 | The tool finished. `outcome` is `ok`, `error` or `cancelled`.                                                                                                   |
| `truncate`       | `utterance_id`, `audio_end_ms`                                       | Marker: the SDK told a realtime provider the agent item was cut at `audio_end_ms`, relative to the item. It does not end speech.                                |
| `missing`        | `evidence`, `reason`, `utterance_id?`                                | Expected evidence will never arrive. `evidence` is `transcript`, `speech_end`, `audio`, `tool_result` or `timeline`.                                            |
| `call_end`       | `reason`                                                             | Session closed. This is the last event emitted.                                                                                                                 |

`text` is omitted when content capture is off. All other fields carry timing or identity and are always logged.

## IDs and relationships

**`utterance_id`: one speaker, one contiguous speech segment, unique per call.**

- **Caller, realtime with item ids (OpenAI):** the provider input item id.
- **Caller, Gemini Live and all cascaded pipelines:** an SDK counter `u<n>`. The provider id, if any, arrives later through `message`.
- **Agent, realtime:** the output item id.
- **Agent, LiveKit cascaded:** `<speech_id>/<n>`, with `n` counting playout segments of one speech handle.
- **Agent, Pipecat:** `<context_id>/<n>`.

**A caller turn is one or more utterances.** `end_of_turn.utterance_ids` lists them. The SDK does not merge VAD segments.

**Transcript to utterance, when the provider gives no item id** (cascaded STT, Gemini Live):

- Each final transcript attaches to the caller utterance that is open at arrival, or else to the most recently ended one, within the current uncommitted turn.
- Several finals for one utterance are joined in `seq` order.
- A final that arrives after `end_of_turn` attaches to the last utterance of that turn.

**`message_id`:**

- Set on `transcript` when the provider supplies the item id with the text (OpenAI realtime).
- Otherwise a `message` event links it when the chat item is committed: LiveKit `_conversationItemAdded`, or the Pipecat context aggregator push.
- Lingua uses it to match conversation messages.

**`response_id`:**

- LiveKit cascaded: `generation_id`.
- Realtime: the provider response id.
- Pipecat: an SDK counter.
- `response_start.span_id` is the only link from the timeline to the step tree.

**Agent speech to its generation:** `speech_start.response_id`.

**`in_reply_to`:** an optional hint naming the caller utterances the framework handed to this generation. Lingua's turn windows decide linking, and Lingua warns when the hint disagrees.

## Timing semantics

- **Order versus time:**
  - `seq` is emission order and defines log order.
  - `at_ms` is when the thing happened. For example, a VAD `speech_end` is emitted after the silence delay but dated at the real end, so it can be smaller than an earlier event's `at_ms`.
  - Lingua orders speech by `at_ms` and uses `seq` only to break ties and to define turn windows.
- **Call clock:** `at_ms` is milliseconds since the recordings' `timeline.origin_unix_ms`, which is `snapshot().origin` in `@braintrust/audio`. Call ms `t` falls in a ready segment `s` at offset `t - s.timeline.recording_start_offset_ms`.
- **`basis` values:**
  - `audio`: computed from sample positions the recorder placed on the timeline, such as playout ranges from `playbackProgressed`. It matches the recording by construction.
  - `local`: `Date.now() - origin`, minus a known framework delay where one applies, such as the VAD silence duration. Expect event-loop jitter under 20 ms.
  - `provider`: a provider time converted to the call clock. The SDK records the call ms of the first audio frame it sends after each input-buffer clear or commit as the buffer's anchor, so `at_ms = anchor + audio_start_ms` (or `audio_end_ms`).
- **Agent speech:** it ends at `speech_end`, the played end. `truncate` only records what the provider was told. In the realtime example they differ by 300 ms (2600 vs 2900).
- **No recording:** without one, `voice.timeline_origin_unix_ms` is the origin, and Lingua treats `audio` basis as `local`.

## What integrations capture, and when

### LiveKit (JS, `js/src/instrumentation/livekit`)

| Event                                | Cascaded (`_pipelineReplyTaskImpl`)                                                                                                                                                                                                                        | Realtime (`_realtimeGenerationTaskImpl`, `RealtimeObserver`)                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| caller `speech_start` / `speech_end` | Per VAD segment: new hooks on `AgentActivity.onStartOfSpeech` / `onEndOfSpeech`. Start = now − `speechDuration`, end = now − `silenceDuration` (`local`). These match the native `livekit.user_speaking` spans, not the whole-turn `EndOfTurnInfo` bounds. | `input_speech_started` / `input_speech_stopped`, using `audio_start_ms` / `audio_end_ms` when exposed (`provider`)           |
| caller `transcript`                  | `user_input_transcribed` finals, `source: stt`, attached by the rule above                                                                                                                                                                                 | `input_audio_transcription_completed`, `source: provider`, with `message_id = itemId`. It may arrive after `response_start`. |
| `message`                            | `_conversationItemAdded` (user and assistant items)                                                                                                                                                                                                        | Only needed for Gemini Live                                                                                                  |
| `end_of_turn`                        | `onEndOfTurn`, with the utterances since the previous commit                                                                                                                                                                                               | `userTurnCompleted` / buffer commit                                                                                          |
| `response_start`                     | `llm_response` span `onStart`, `response_id = generation_id`                                                                                                                                                                                               | realtime `llm_response` `onStart`, `response_id = contrib.livekit.response_id`                                               |
| `tool_call` / `tool_result`          | `function_tool` span start and end. `cancelled` when the speech handle was interrupted first.                                                                                                                                                              | same                                                                                                                         |
| agent `speech_start` / `speech_end`  | `playback.ts` `settle`: first played range start and last played range end (`audio`), plus `interrupted` and `played_ms`                                                                                                                                   | same                                                                                                                         |
| agent `transcript`                   | `playbackFinished.synchronizedTranscript` (`source: playout`), else assistant item text (`provider`)                                                                                                                                                       | same                                                                                                                         |
| `truncate`                           | —                                                                                                                                                                                                                                                          | the truncate request to the provider                                                                                         |
| `missing`                            | At close: caller utterances in a committed turn with no final transcript, and starts without ends                                                                                                                                                          | same                                                                                                                         |
| `call_end`                           | `closeImpl`                                                                                                                                                                                                                                                | same                                                                                                                         |

Starting point: add `timeline.ts` beside `turns.ts`. It owns `seq`, the buffer, the flush and retry rules, and the transcript-attachment rule. Keep it on the per-session state in `processor.ts`.

### Pipecat (Python, sketch against `sdk-python` `delner/pipecat-voice-recording`)

The timeline observer sits at the transport output processor, so agent events reflect audio actually written.

| Event                                | Cascaded                                                                                                                                                                                                                                                            | Realtime (OpenAI / Gemini services)                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| caller `speech_start` / `speech_end` | `VADUserStartedSpeakingFrame` / `VADUserStoppedSpeakingFrame`, end dated stop time − VAD `stop_secs` (`local`); `audio` when the input sample clock is aligned                                                                                                      | provider speech start/stop (`provider`, anchored as above)        |
| caller `transcript`                  | `TranscriptionFrame` (finalized), attached by the rule above, `source: stt`                                                                                                                                                                                         | the service's input transcription, `source: provider`             |
| `message`                            | context aggregator push of the user or assistant message                                                                                                                                                                                                            | Gemini only                                                       |
| `end_of_turn`                        | `UserStoppedSpeakingFrame` after the turn strategy commits; `utterance_ids` = VAD utterances since the previous `end_of_turn`                                                                                                                                       | the service's commit event                                        |
| `response_start`                     | `LLMFullResponseStartFrame`; `span_id` is the SDK's own `llm_response` span id, known when the span is created; `in_reply_to` = the same VAD utterances                                                                                                             | same                                                              |
| `tool_call` / `tool_result`          | `FunctionCallInProgressFrame` / `FunctionCallResultFrame` / `FunctionCallCancelFrame`                                                                                                                                                                               | same                                                              |
| agent `speech_start` / `speech_end`  | `TTSAudioRawFrame` bytes written by the output transport: start = call ms of the first write of a `context_id`; end = start + bytes written / (sample rate × channels × 2) × 1000, which also gives `played_ms`; `interrupted` when an `InterruptionFrame` stops it | same, per output item                                             |
| agent `transcript`                   | `TTSTextFrame` words written before the stop, `source: playout`                                                                                                                                                                                                     | same; provider transcript only as a fallback (`source: provider`) |

## What Lingua records versus infers

- **Records:** the events in `seq` order in `VoiceCall.events`, and recordings as in #486.
- **Infers** (algorithm in the Lingua spec):
  - one `Speech` per utterance, with selections and `interrupted`;
  - turns as `end_of_turn` windows;
  - `step_ids` from those windows and from `response_id`;
  - warnings.
- **Does not infer:**
  - **Latencies and overlaps:** the app computes them from `events`; Lingua stores no derived numbers.
  - **Untranscribed text:** text that was never transcribed stays missing.

## Trajectory and app mapping

`Trajectory.voice_calls[*]` keeps the #486 fields. `speech` and `recordings` are built from the timeline, so #22034 and #22036 work unchanged: the voice bar, click-to-step, play-from-message and highlighting.

`VoiceCall.events` exposes the log for a latency strip:

- caller `speech_end` → `end_of_turn` → `response_start` → first agent `speech_start` in the window
- overlap shading
- `missing` badges
- truncate-versus-played markers

Thread messages still come from LLM span inputs and outputs.

## Worked example

`examples/cascaded.json` and `examples/realtime.json` encode the same fictional call. Row tree:

```
livekit.agent_session            audio.recordings: call-0000 (13 s); voice.timeline_version 1
├── llm_response  llm-1 / rt-1   → find_slots
├── find_slots    tool-1
├── llm_response  llm-2 / rt-2   "I have nine thirty or eleven on Friday…"
├── tts           tts-1          (cascaded only)
├── llm_response  llm-3 / rt-3   → reschedule
├── reschedule    tool-2
├── llm_response  llm-4 / rt-4   "Done — you're booked…"
├── tts           tts-2          (cascaded only)
├── voice.timeline timeline-0
└── voice.timeline timeline-1    final
```

Concrete differences, same audio:

|                                                   | Cascaded                                                                                            | Realtime                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Caller utterance ids                              | `u1`, `u2` (SDK)                                                                                    | `item_u1`, `item_u2` (provider)                                                                  |
| Caller transcript of turn 1                       | `stt` at 3450; `message` links `item_u1` at commit                                                  | `provider` at 4300, after `tool_call` at 4100, carrying `message_id`                             |
| Turn-1 latency, `end_of_turn` → first agent audio | 3400 → 5300 = 1900 ms: 50 ms STT, 650 ms LLM, 500 ms tool, 500 ms LLM, 200 ms TTS                   | 3400 → 5000 = 1600 ms: 200 ms to response, 500 ms to the tool call, 500 ms tool, 400 ms to audio |
| Barge-in                                          | agent `speech_end` 7900, `played_ms` 2600                                                           | `truncate` marker at 7600 (`audio_end_ms` 2600), then `speech_end` 7900 with `played_ms` 2900    |
| Out-of-order evidence                             | `u2` STT final arrives at 8520, before the VAD stop is emitted; `speech_end` (seq 15) is dated 8500 | the `item_u1` transcript arrives mid-response                                                    |
| Caller's barge-in text                            | `stt` "Nine thirty works."                                                                          | none: `missing{evidence: transcript}`, and the `rt-3` input user content is `""`                 |
| Agent text actually said                          | `playout` "…on Fri"; `llm-2` output holds the planned sentence                                      | `playout` "…on Fri"; `rt-2` output already truncated                                             |
| STT/TTS steps                                     | `tts-1`, `tts-2`                                                                                    | none                                                                                             |

## Customer usefulness

- **What was said: good.** Finals carry their source, the agent's played text is kept separate from generated text, and missing transcripts are explicit.
- **Playing matching audio: good.** Every interval is on the recording clock. Lingua cuts selections per segment and per channel.
- **Diagnosing delays: strongest of the options.** Each stage is a subtraction on one clock, in realtime too.
- **Interruptions and overlap: strong.** Overlap comes from intervals and interruption from `speech_end`, and the truncate-versus-played gap is visible.
- **Following tools: adequate.** Tools are placed in time and linked to spans; arguments and results stay on the spans.
- **Missing or uncertain evidence: strong.** Every time has a `basis`, plus `missing` events, `seq` gaps, and a missing `final` chunk.

## Edge cases and weaknesses

- **Barge-in truncation:** handled. The planned text stays only on the LLM span.
- **Overlap:** intervals overlap freely.
- **Late or missing realtime transcripts:** a late final attaches by `message_id`, or by the attachment rule when there is none. A missing one gets a `missing` event. Weakness: without item ids (Gemini Live, cascaded STT), attachment is a heuristic and can pick the wrong segment of a multi-segment turn.
- **Failed or omitted segments:** speech keeps its times but has no selection over the gap.
- **Unknown clock offset:** `local` events skew against `audio` events unmeasured. A `clock_offset` event is left as an open question.
- **Call in progress, or a crash:** the latest ≤5 s are not yet flushed. With no `final` chunk, Lingua warns and closes open speech.
- **Content capture off:** `text` is dropped, but timing analysis still works.
- **Tool cancelled by interruption:** `tool_result{outcome: cancelled}`. The cause is inferred only from a nearby interrupted agent `speech_end`.
- **Agent handoff:** not modeled. A new agent activity continues the same log, and nothing records which agent spoke.
- **Duplicate observers:** the SDK must emit one event per moment, such as LiveKit's native `user_turn` plus realtime events. Lingua deduplicates only identical retried chunks.
- **Overall weakness, indirection:** speech, turns and step links depend on Lingua's derivation, and the trace tree alone no longer shows speech.

## Implementation starting point

1. Lock the schema in `call-timeline.ts`, including `basis`, flush and retry, and the transcript-attachment rule.
2. LiveKit: add `timeline.ts` and the VAD hooks (`onStartOfSpeech` / `onEndOfSpeech`). Emit from `onEndOfTurn`, the `RealtimeObserver` listeners, `playback.ts` `settle`, `_conversationItemAdded`, and `onStart`/`onEnd` for `llm_response` and `function_tool`. Set `voice.timeline_version` and `voice.pipeline` at `_startImpl`. Keep existing spans and selections during the transition.
3. At close, emit `missing` events, then `call_end`, and flush the `final` chunk.
4. Lingua: implement `specs/voice-schema-call-timeline.md`.
5. Pipecat: port `timeline.ts` to the Python voice package following the table above.

## Open questions

- Should `end_of_turn` carry the detector's delay and probability (LiveKit `eou.*`)?
- Are 5 s and 64 events the right flush defaults?
- Should agent `transcript` carry word timings when the TTS provides alignments?
- Is a `clock_offset` event worth adding, to measure `local` against `audio`?
