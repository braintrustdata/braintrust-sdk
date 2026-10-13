# Voice schema option: span points

> AI-created or modified and not human-reviewed in its current form; treat this artifact as provisional. Updated 2026-10-13.

Integrations log each voice observation as a **point** on the ordinary span that made it:

- caller speech on `user_turn`;
- agent playout on `assistant_turn`;
- generation start on `llm_response`;
- tool start and end on the tool span;
- call end on the call span.

Points use the call-timeline event vocabulary and call clock ([#2612](https://github.com/braintrustdata/braintrust-sdk-javascript/pull/2612) / [lingua#490](https://github.com/braintrustdata/lingua/pull/490)). Only the placement differs. There are no `voice.timeline` rows and no buffer or flush policy: the SDK merges each point into its owner span with `span.log`. Lingua puts the points back together into the same `VoiceCall.events` and `Speech` that #490 builds.

This branch is stacked on #2612, so its diff is only the span-points contract.

## Customer problem

A customer debugging a voice agent needs to answer five questions:

- What did each side say?
- What did it sound like?
- Where did time go between the caller finishing and the agent speaking?
- Who talked over whom?
- Which tool call caused a pause?

Call timeline answers all five from one log, but that log sits in rows of its own, away from the spans a customer browses. Span points keep the same evidence on the turn, LLM and tool spans the customer already opens. They also make two cases explicit:

- **Speech no operation answered:** a `user_turn` with no `end_of_turn`.
- **Barge-in versus talk-over:** `interrupted_by` on the interrupted agent speech.

## Schema at a glance

Each point lives in `metadata["voice.points"]` on its owner span, keyed by its `seq`. The call span carries the recordings, two required keys and the `call_end` point. Step spans keep their normal input, output and metrics.

<!-- prettier-ignore -->
```ts
// Call span (root). span_attributes = { name: "livekit.agent_session", type: "task" }
type CallRow = {
  input?: { audio: Record<RecordingId, Attachment> }          // shared @braintrust/audio, ready segments; absent when capture is off
  metadata: {
    "audio.recordings"?: AudioRecording[]                     // shared; absent when audio capture is off
    "voice.points_version": 1                                 // required; selects the points path in Lingua
    "voice.pipeline": "cascaded" | "realtime" | "half_cascade" // required; pipeline at call start
    "voice.origin_unix_ms"?: number                           // unix ms; required iff "audio.recordings" is absent
    "voice.server_vad_silence_ms"?: number                    // ms already subtracted from realtime caller speech_end
    "voice.points"?: Points                                   // call_end, and turn points whose turn span does not exist
  }
}
type AudioRecording = {                                       // shared layer, unchanged
  id: RecordingId; state: "ready" | "pending" | "omitted"; duration_ms?: number   // duration_ms: ready only
  attachment?: { span_id: string; ref: string }               // ready only; ref = "/input/audio/<id>"
  sources?: { channel_index: number; boundary: string }[]     // "session_input" = ch 0 caller, "local_audio_output" = ch 1 agent
  timeline?: { origin_unix_ms: number; recording_start_offset_ms: number } // unix ms; call ms
}
// "audio.selections" is not logged by this option: Lingua cuts selections from speech intervals.

// Owner span: user_turn, assistant_turn, llm_response or a tool. Its own fields are unchanged.
type OwnerRow = { metadata: { "voice.points": Points } }      // merged with span.log, also after the span ended
type Points = Record<Seq, Point>                              // <= 256 keys per span
type Seq = string          // decimal int >= 0; consecutive per call across all spans; emission order
type Point = { at_ms: number; basis: "audio" | "local" | "provider" } & (  // at_ms: call ms >= 0
  // user_turn (caller) or assistant_turn (agent playout)
  | { kind: "speech_start"; speaker: Speaker; utterance_id: UtteranceId; response_id?: ResponseId } // response_id: agent only
  | { kind: "speech_end"; speaker: Speaker; utterance_id: UtteranceId
      interrupted?: boolean; played_ms?: number               // agent only; played_ms: ms since speech_start
      interrupted_by?: UtteranceId }                          // agent only; the caller utterance that cut it off
  | { kind: "transcript"; speaker: Speaker; utterance_id: UtteranceId; final: boolean
      source: "stt" | "provider" | "playout"; text?: string; message_id?: MessageId } // at_ms = arrival
  | { kind: "message"; speaker: Speaker; message_id: MessageId; utterance_ids: UtteranceId[] }
  | { kind: "missing"; evidence: "transcript" | "speech_end" | "audio" | "tool_result" | "timeline"
      reason: string; utterance_id?: UtteranceId }
  | { kind: "end_of_turn"; utterance_ids: UtteranceId[] }     // user_turn only; absent = turn never committed
  | { kind: "response_start"; response_id: ResponseId; in_reply_to?: UtteranceId[] } // llm_response only
  | { kind: "tool_call"; response_id: ResponseId; tool_call_id: string }  // tool span only
  | { kind: "tool_result"; tool_call_id: string; outcome: "ok" | "error" | "cancelled" } // tool span only
  | { kind: "truncate"; utterance_id: UtteranceId; audio_end_ms: number } // assistant_turn only; marker
  | { kind: "call_end"; reason: string }                      // call span only; highest seq
)
type Speaker = "user" | "agent"
type UtteranceId = string  // caller "u<n>"; agent "<SpeechHandle.id>/<n>"
type ResponseId = string   // LiveKit SpeechHandle.id; Pipecat SDK counter
type MessageId = string    // framework chat item id (realtime: provider item id)
// The owner supplies what call-timeline events carried as fields: response_start.span_id and
// tool_call / tool_result span_id (the owner's span_id), tool_call.name (the owner's name).
```

**Time.**

- `at_ms` is call ms: milliseconds since `audio.recordings[].timeline.origin_unix_ms` (or `voice.origin_unix_ms` without a recording). Call ms `t` is offset `t - recording_start_offset_ms` inside a segment.
- `basis` is as in #2612:
  - `audio`: recorder sample positions (agent playout);
  - `local`: hook wall clock minus a known delay;
  - `provider`: provider ms on a known anchor.
- `played_ms` and `truncate.audio_end_ms` are durations from the agent `speech_start`.
- Owner spans keep their own `metrics.start` / `metrics.end` (unix s), which are never mixed with `at_ms`. A point can fall outside its owner's span times. For example, a transcript can arrive after its `user_turn` ended, and playout can start after its `llm_response` ended.

**Relationships.** These are the #2612 links, with the owner span standing in for the `span_id` fields:

```
transcript / speech_end / truncate .utterance_id  -> speech_start.utterance_id (same owner span)
end_of_turn.utterance_ids[], response_start.in_reply_to[] -> caller utterance ids
speech_end.interrupted_by         -> the caller speech_start that cut that agent speech off
speech_start.response_id (agent)  -> response_start.response_id -> owner llm_response span
tool_call.response_id             -> response_start.response_id;  tool_call.tool_call_id -> tool_result.tool_call_id
tool_call / tool_result owner     = tool span; its "gen_ai.tool.call.id" = tool_call_id
assistant_turn "turn.reply_to"    = user_turn span id (existing reference-SDK metadata, not part of this contract)
```

**One point or many per span?** Many. A singular `voice.point_in_time` is coherent only if every fact gets its own span:

- One point per span would need about 30 rows for this 13 s call, which is the timeline split into more rows than #2612 has chunks.
- Otherwise the span keeps only one fact. A `user_turn` then cannot hold both its speech start and its end of turn, so the latency chain breaks.

In the examples, `user_turn` spans hold 3–5 points, `assistant_turn` spans 4–5, `llm_response` 1, and tools 2.

**A map keyed by `seq`, not an array.** Braintrust merges a span's later writes object by object, but replaces arrays. This holds in the SDK (`mergeDictsWithPaths`, `js/util/object_util.ts`) and on ingest (`api-ts/src/run_log_data.ts` uses the same helper).

- **Array:** every write would have to resend all of the span's points. A retried older write could then land after a newer one and drop points.
- **Keyed map:** each write adds one key. Retries are idempotent and arrival order does not matter.

**Scenario excerpt.** Selected points from [`examples/cascaded.json`](examples/cascaded.json), grouped by owner. Realtime differences follow.

<!-- prettier-ignore -->
```jsonc
// call span: { "voice.points_version": 1, "voice.pipeline": "cascaded", "voice.points": { "29": call_end } }
// user_turn ut-2 (barge-in; opened at 7600 while at-1 was playing)
"10": { "at_ms": 7600, "basis": "local", "kind": "speech_start", "speaker": "user", "utterance_id": "u2" },
"16": { "at_ms": 8700, "basis": "local", "kind": "end_of_turn", "utterance_ids": ["u2"] },
// assistant_turn at-1 (speech_1: llm-1 -> find_slots -> llm-2 on one handle)
"9":  { "at_ms": 5300, "basis": "audio", "kind": "speech_start", "speaker": "agent", "utterance_id": "speech_1/0", "response_id": "speech_1" },
"11": { "at_ms": 7900, "basis": "audio", "kind": "speech_end", "speaker": "agent", "utterance_id": "speech_1/0",
        "interrupted": true, "played_ms": 2600, "interrupted_by": "u2" },               // barge-in: 300 ms overlap, then cut
// llm_response llm-2: span_id comes from the owner
"8":  { "at_ms": 4600, "basis": "local", "kind": "response_start", "response_id": "speech_1", "in_reply_to": ["u1"] },
// tool find_slots tool-1: span_id and name come from the owner
"6":  { "at_ms": 4100, "basis": "local", "kind": "tool_call", "response_id": "speech_1", "tool_call_id": "call_1" },
// user_turn ut-3 (talk-over under a non-interruptible reply; no end_of_turn: LiveKit skipped the turn)
"23": { "at_ms": 10800, "basis": "local", "kind": "speech_start", "speaker": "user", "utterance_id": "u3" },
"24": { "at_ms": 11650, "basis": "local", "kind": "transcript", "speaker": "user", "utterance_id": "u3", "final": true,
        "text": "Mm-hm, perfect.", "source": "stt" },
"25": { "at_ms": 11500, "basis": "local", "kind": "speech_end", "speaker": "user", "utterance_id": "u3" },
// assistant_turn at-2: the agent kept talking through u3
"26": { "at_ms": 12600, "basis": "audio", "kind": "speech_end", "speaker": "agent", "utterance_id": "speech_2/0",
        "interrupted": false, "played_ms": 2700 }                                       // no interrupted_by
```

<!-- prettier-ignore -->
```jsonc
// realtime (examples/realtime.json): user_turn ut-1, written after the turn span ended at 3600
"6":  { "at_ms": 4300, "basis": "local", "kind": "transcript", "speaker": "user", "utterance_id": "u1", "final": true,
        "text": "Hi, can I move my Thursday cleaning to Friday morning?", "source": "provider", "message_id": "item_u1" },
// assistant_turn at-1 owns speech_1 (rt-1, tool) and its tool reply speech_2 (rt-2, playout): one continued turn span
"11": { "at_ms": 7900, "basis": "audio", "kind": "speech_end", "speaker": "agent", "utterance_id": "speech_2/0",
        "interrupted": true, "played_ms": 2900, "interrupted_by": "u2" },
"12": { "at_ms": 7900, "basis": "local", "kind": "truncate", "utterance_id": "speech_2/0", "audio_end_ms": 2900 },
// user_turn ut-2, written at close
"26": { "at_ms": 13000, "basis": "local", "kind": "missing", "utterance_id": "u2", "evidence": "transcript",
        "reason": "input_transcription_not_received" }
```

Cascaded vs realtime: what changes in the payload

|                            | Cascaded                                                                                      | Realtime                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Call span                  | `voice.pipeline: "cascaded"`                                                                  | `"realtime"`; `voice.server_vad_silence_ms` only when the integration is given it (not in the example)                    |
| Tool reply handle          | same handle: `llm-1` and `llm-2` both start `speech_1`; playout `speech_1/0`                  | new handle `speech_2`, which continues `speech_1`'s `assistant_turn` span; playout `speech_2/0`                           |
| Caller transcript          | `stt`, on the `user_turn` at 3450, after `end_of_turn` but before the span ends at the commit | `provider` with `message_id`, written to the ended `user_turn` (4300), or a `missing` point at close                      |
| `end_of_turn.at_ms`        | turn detector resolve time (3400)                                                             | entry of the answering generation (3600)                                                                                  |
| Interrupted agent speech   | `speech_end` with `played_ms` and `interrupted_by`                                            | same, plus a `truncate` point equal to `played_ms` on the same `assistant_turn`                                           |
| Talk-over without barge-in | `u3` under a non-interruptible reply (`ut-3`, no `end_of_turn`)                               | not in the example: with server turn detection, LiveKit warns that `allowInterruptions` cannot be false (`aa.ts:712-716`) |
| Step rows                  | `llm_response` + `tts` rows under the `assistant_turn`                                        | `llm_response` rows only                                                                                                  |

Implemented: zod types (`js/src/instrumentation/livekit/voice-schema/span-points.ts`), the examples, and the test. Sketch: LiveKit and Pipecat emission. The Lingua mapping is implemented in the companion Lingua PR (`specs/voice-schema-span-points.md`, branch `kevchoi/voice-schema-span-points`).

### What changes from call timeline (#2612 / lingua#490)

|                           | Call timeline                                                            | Span points                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Where evidence lives      | `voice.events` arrays on `voice.timeline` child rows, ≤256 per chunk     | `voice.points` maps on `user_turn`, `assistant_turn`, `llm_response`, tool and call spans, ≤256 per span; 1–5 in practice |
| How it is written         | buffer, then flush at 64 events / 5 s / call end; retry by `chunk_index` | one `span.log` merge per point, on the SDK logger's normal batching                                                       |
| Order and completeness    | `seq` across chunks; a `final` chunk                                     | `seq` across spans; a `call_end` point on the call span                                                                   |
| Step links                | `span_id` fields on `response_start`, `tool_call`, `tool_result`         | the owner span                                                                                                            |
| Speech in the trace tree  | only inside timeline rows                                                | on the turn spans a customer already opens                                                                                |
| Speech no one answered    | utterance joins the open `end_of_turn` window and its steps              | its `user_turn` has no `end_of_turn`, so it links to no step                                                              |
| Barge-in vs talk-over     | inferred from an interrupted `speech_end` near caller speech             | `interrupted_by` on the agent `speech_end` (also usable in call timeline)                                                 |
| Dependence on other spans | none: the timeline stands alone                                          | needs the turn spans to exist; points fall back to the call span when they don't                                          |

**SDK changes from #2612:**

- **Replaced:** #2612's planned `timeline.ts` (buffer, flush and chunk rows; no emission code exists yet) becomes a planned `points.ts`. It owns the `seq` counter, the owner lookup and one `span.log` per point.
- **Renamed:** `voice.timeline_version` becomes `voice.points_version`, and `voice.timeline_origin_unix_ms` becomes `voice.origin_unix_ms`.
- **Dropped fields:** points drop `span_id` and `name`.

The capture hooks are the same.

**Lingua changes from #490** are listed under "What Lingua records versus infers".

## Contract

**Implemented** as zod in `span-points.ts` (`voicePointSchema`, `callSpanMetadataSchema`, `spanMetadataSchema`, `pointOwners`), exercised by both examples and the test. Rules the zod cannot express are stated here.

### Call span

The call span is the span that logs `audio.recordings`, or the session span when there is no recording.

| Metadata key                  | Type                                         | Req.                                  | Meaning                                                                                                           |
| ----------------------------- | -------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `voice.points_version`        | `1`                                          | yes                                   | Marks the call as using this contract. Lingua then builds speech from points and ignores turn-span selections.    |
| `voice.pipeline`              | `"cascaded" \| "realtime" \| "half_cascade"` | yes                                   | As in #2612.                                                                                                      |
| `voice.origin_unix_ms`        | number, unix ms                              | yes when `audio.recordings` is absent | Origin of the call clock when there is no recording.                                                              |
| `voice.server_vad_silence_ms` | number, ms                                   | no                                    | As in #2612.                                                                                                      |
| `voice.points`                | `Points`                                     | yes at close                          | `call_end` (always the highest `seq`), overflow `missing` points, and turn points whose turn span does not exist. |

### Owner spans

| Point                                                                              | Owner span                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| caller `speech_start`, `speech_end`, `transcript`, `missing`                       | The `user_turn` that was open when the utterance **started**. Later points for that utterance, such as a late transcript or a close-time `missing`, go to the same span.                                                                   |
| `end_of_turn`, caller `message`                                                    | The `user_turn` of that turn                                                                                                                                                                                                               |
| agent `speech_start`, `speech_end`, `transcript`, `truncate`, `message`, `missing` | The `assistant_turn` span of the speech handle that is playing (`SpeechHandle._agentTurnSpan` when playout starts)                                                                                                                         |
| `response_start`                                                                   | The `llm_response` span itself                                                                                                                                                                                                             |
| `tool_call`, `tool_result`                                                         | The tool span itself                                                                                                                                                                                                                       |
| `call_end`; caller or agent points whose turn span does not exist                  | The call span. Step points (`response_start`, `tool_*`) are written from their own span's hooks, so their owner always exists. If a step span is not exported, there is no step to link, and the SDK writes no point and assigns no `seq`. |

Ownership follows **who observed the fact**, never which operation happened to be running.

- **Caller speech:** it goes to a `user_turn` even while a tool, a TTS stream or agent playout overlaps it. A caller utterance never goes on an LLM, tool or TTS span.
- **Playout:** it goes to the `assistant_turn`, never on `llm_response` (generation) or `tts` (synthesis). The three time ranges stay separate.

`pointOwners` in the zod file encodes this table. Lingua warns about a point on the wrong kind of span but keeps it.

### Writing points

- **One write per point:** `span.log({ metadata: { "voice.points": { [seq]: point } } })` on the owner. Logging after `span.end()` is allowed (`SpanImpl.logInternal` has no ended check). `updateSpan` with the exported span id does the same from another context.
- **Immutable:** a point is never rewritten. Later facts are new points with a higher `seq`. MVP integrations log finals only, and several finals for one utterance are joined in `seq` order, as in #2612.
- **Retry:** the background logger may resend a batch. The same key with the same value merges to the same row.
- **Limit:** 256 points per span. Past that, the SDK drops new points for that span and writes `missing{evidence: "timeline", reason: "span_point_limit"}` on the call span. `timeline` here means "the call's point log", reusing #2612's value.
- **At close:** the SDK writes the close-time `missing` points, then `call_end`, then flushes. It drops anything that arrives after `call_end`.

### `Point`

The fields and meanings are #2612's `VoiceEvent`, minus `seq` (the map key) and minus the owner-supplied `span_id` and `name`, plus:

| Field                       | Type          | Req. | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `speech_end.interrupted_by` | `UtteranceId` | no   | Agent speech only: the caller utterance whose speech caused the interruption. LiveKit records the first cause on the speech handle (`SpeechHandle._interruptSource`, `speech_handle.ts:217`, set on the first interrupt only at `:401` and `:505`; values at `:96-100`). For `audio_activity`, the SDK sets the caller utterance open at that moment; for `user_turn`, the last utterance of the committed turn. It stays absent for `programmatic` interruptions and whenever the agent was not interrupted. |

## IDs and relationships

The IDs are the same as in #2612: `u<n>` caller counters, `<SpeechHandle.id>/<n>` agent utterances, `SpeechHandle.id` response ids, and framework chat item ids. That README has the transcript-attachment and `message` rules, including decision E for realtime caller items. Two LiveKit 1.9.2 facts decide identity versus ownership here:

- **Cascaded tool replies reuse the speech handle.** `_pipelineReplyTaskImpl` increments `speechHandle._numSteps` and reruns the reply task on the same handle (`aa.ts:4391-4421`). Both `llm-1` and `llm-2` therefore start `speech_1`, and playout is `speech_1/0`. Lingua links agent speech to the handle's **latest** generation that started at or before playback, which is `llm-2`. #2612's cascaded example gives the reply its own handle (`speech_2`), which LiveKit 1.9.2 does not do.
- **Realtime tool replies get a new handle but continue the turn span.** `continueToolReplyTurn` (`aa.ts:492-496`, called at `aa.ts:5103`) moves `speech_1`'s open `agent_turn` to the reply handle `speech_2`. One `assistant_turn` span (`at-1`) therefore owns playout `speech_2/0`, while its children `rt-1` and `rt-2` start `speech_1` and `speech_2`.

Identity always comes from the point's ids. The owner is only placement, and Lingua never infers an id from it, except the step `span_id` and tool `name` it supplies.

## Timing semantics

These are the same as in #2612: call clock, `basis`, `seq` for order, `at_ms` for time, and agent speech ending at the played end. Additions:

- **Owner times are span-clock times:** a `user_turn` runs from LiveKit's first speech or transcript to its end-of-turn handling. An `assistant_turn` runs from the reply task's start to the speech's end. The points inside are not clipped to those ranges.
- **Ordering is global:** `seq` is one counter per call, so Lingua can merge points from any number of spans into one order and detect gaps.
- **Latency arithmetic crosses spans:** caller `speech_end` (`user_turn`) → `end_of_turn` (`user_turn`) → `response_start` (`llm_response`) → agent `speech_start` (`assistant_turn`). All four are on the call clock.

## What integrations capture, and when

**Sketch.** No emission code exists yet. The hooks are those of the #2612 LiveKit and Pipecat tables. Only the destination changes.

### LiveKit (JS, `js/src/instrumentation/livekit`)

- **Owner lookup:** `processor.ts` already maps every exported native span to a Braintrust row (`rows`, keyed by native span id). The points writer resolves owners as follows:
  - **`user_turn`:** the row of the recognition's open `user_turn`. LiveKit opens it at the first speech or transcript (`audio_recognition.ts:1172-1194`, `ensureUserTurnSpan`), including a barge-in during agent playout. In realtime, the reference SDK's own `user_turn` (`realtime.ts`) is used.
  - **`assistant_turn`:** the row of `activity.currentSpeech._agentTurnSpan` when playout starts.
  - **`llm_response` and tool:** the row being started or ended in `onStart` / `onEnd`.
  - **No row:** a turn span sampled out or not yet exported. Caller and agent points go on the call span. A step with no row gets no point (see the owner table).
- **Caller hooks:** VAD start and end, STT finals, and `onEndOfTurn` record a caller utterance's owner at `speech_start` and reuse it for that utterance's later points.
- **Talk-over:** a dropped turn (`aa.ts:3328-3333`, the speech is not interruptible) leaves its `user_turn` without `end_of_turn`, which needs no extra point. LiveKit sees the caller only when `turnHandling.interruption.discardAudioIfUninterruptible` is `false`. The default `true` drops input audio while non-interruptible speech plays (`aa.ts:1795-1810`, `turn_config/interruption.ts:65`). The caller is then on recording channel 0, but there are no points. The cascaded example assumes `false`.
- **`interrupted_by`:** read `speechHandle._interruptSource` at the agent's `playbackFinished`.

### Pipecat (Python, sketch against `sdk-python` `delner/pipecat-voice-recording`)

The reference integration already opens its own `user_turn` and `assistant_turn` spans (`voice/turns.py:20-27`). It parents `llm_response` and `tts` / `pipecat.audio_output` under the assistant turn (`voice/instrumentation.py:405-407`, `496-497`), and each tool span under the `llm_response` that requested it, or the pipeline root without one (`voice/instrumentation.py:434-449`). The owner table therefore applies unchanged:

- **Caller points:** on the user turn open when VAD started.
- **Playout:** on the assistant turn whose `context_id` is being written to the output transport.
- **`response_start` and tools:** on the `llm_response` and tool spans.

## What Lingua records versus infers

**Implemented** in the companion Lingua PR (`kevchoi/voice-schema-span-points`, stacked on #490).

- **Records:** every point as a `VoiceEvent` in `VoiceCall.events`, in `seq` order. `seq` comes from the key, `span_id` from the owner for `response_start` / `tool_call` / `tool_result`, and `name` from the tool span.
- **Infers:** speech, turns, `step_ids` and selections, using #490's `timeline_speech`, with two changes below.
- **Warns:**
  - a `seq` gap;
  - no `call_end`, or points after it;
  - a point on a span that cannot own it;
  - points with no versioned call above them.
- **Fails:** the same `seq` with different content on two spans.

Conversion code that changes from #490:

1. `import/span.rs` and `import/voice.rs` parse `voice.points_version` and `voice.points` (kept as JSON per span).
2. `voice_calls` finds each span's nearest versioned ancestor and calls `build_points`. `build_points` assembles events and then hands them to `timeline_speech`.
3. In `timeline_speech`:
   - **Uncommitted utterances:** a caller utterance whose `user_turn` has no `end_of_turn` links to no step. #490 still puts such utterances in the open window.
   - **Latest generation:** agent speech links to its handle's latest generation that started at or before the playback start. #490 took the first generation, which is the same result whenever a handle runs one generation, as in #490's own examples.
4. `VoiceEventDetail::SpeechEnd` gains an optional `interrupted_by`. Trajectory types are otherwise unchanged.

## Trajectory and app mapping

**Implemented in Lingua**, with the app as a sketch.

`VoiceCall.events` and `Speech` have the same shape as in #490, so #22034 and #22036 work unchanged, and the latency strip sketched in #2612 applies as is.

- **Turns:** the `user_turn` rows now come from the integration itself. A thread turn starts at a `user_turn` that logs the caller's text. The cascaded example therefore yields a third turn, `ut-3` "Mm-hm, perfect.", with no response. Realtime `ut-2` has no transcript, so, as in #490, that turn starts at `rt-3` with an empty user message.
- **Overlap shading:** the app can draw it from intervals, as in #490. It can colour overlap ending in an agent `speech_end` with `interrupted_by` as barge-in, and other overlap as talk-over.

## Worked example

**Implemented:** `examples/cascaded.json` (14 rows, 30 points) and `examples/realtime.json` (11 rows, 28 points) encode the #2612 call. Their payloads use the normal LLM and tool inputs and outputs, and the call span carries the recording attachment and channel sources. The cascaded example adds one talk-over. Row tree, cascaded:

```
livekit.agent_session call-span   audio.recordings: call-0000 (13 s, ch 0 caller, ch 1 agent); points: call_end
├── user_turn       ut-1   u1 start/end, transcript, end_of_turn, message          (5 points)
├── assistant_turn  at-1   speech_1: playout speech_1/0, interrupted_by u2          (4)
│   ├── llm_response llm-1   response_start speech_1 → find_slots                  (1)
│   ├── find_slots   tool-1  tool_call, tool_result                                (2)
│   ├── llm_response llm-2   response_start speech_1 "I have nine thirty…"          (1)
│   └── tts          tts-1                                                         (0)
├── user_turn       ut-2   u2 barge-in at 7600 while at-1 plays                     (5)
├── assistant_turn  at-2   speech_2: llm-3 → reschedule → llm-4, tts-2; playout speech_2/0 (4 + children)
└── user_turn       ut-3   u3 "Mm-hm, perfect." 10800–11500 under at-2; no end_of_turn (3)
```

|                       | Cascaded                                                                                                     | Realtime                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Turn-1 latency        | 2900 → 5300 = 2400 ms: `ut-1` end → `ut-1` end_of_turn 3400 → `llm-1` 3450 → `at-1` playout                  | 3400 (padded) → 5000 = 1600 ms: `ut-1` → `rt-1` 3600 → `at-1` playout                          |
| Barge-in              | `u2` 7600–8500 against `speech_1/0` 5300–7900: 300 ms overlap, `interrupted_by: "u2"`                        | `u2` 7600–9000 against `speech_2/0` 5000–7900: 300 ms, `interrupted_by: "u2"`, `truncate` 2900 |
| Talk-over             | `u3` 10800–11500 against `speech_2/0` 9900–12600: 700 ms, `interrupted: false`; `ut-3` without `end_of_turn` | —                                                                                              |
| Late evidence         | `u1` transcript and `message` at 3450, after `end_of_turn` (3400) and before `ut-1` ends at the commit       | `u1` transcript at 4300 on `ut-1`, which ended at 3600; `missing` for `u2` at close on `ut-2`  |
| Lingua speech → steps | `u1` → llm-1, llm-2; `speech_1/0` → llm-2; `u2` → llm-3, llm-4; `speech_2/0` → llm-4; `u3` → none            | `u1` → rt-1, rt-2; `speech_2/0` → rt-2; `u2` → rt-3, rt-4; `speech_4/0` → rt-4                 |

## Customer usefulness

The evidence is #2612's, so the answers match call timeline. The differences are where a customer finds them, and two cases that become explicit.

- **What was said: good.** Same sources and `missing` points. Caller text sits on the turn span the customer clicks.
- **Playing matching audio: good.** Same intervals, so Lingua cuts selections the same way.
- **Diagnosing delays: strong.** The same subtraction on one clock, read across three or four spans instead of one log.
- **Interruptions and overlap: strong.** Option 2's intervals, and `interrupted_by` separates barge-in from talk-over without a heuristic, and an unanswered `user_turn` shows why nothing replied.
- **Following tools: good.** Tool timing sits on the tool span next to its arguments and result.
- **Missing or uncertain evidence: strong.** `basis`, `missing`, `seq` gaps and `call_end`. A missing turn span degrades to the call span, never to a lost point.

## Edge cases and weaknesses

- **Turn spans missing or sampled out:** caller and agent points fall back to the call span. That keeps them, but loses locality for that turn.
- **Point limit:** 256 per span. A long monologue `user_turn` with very many VAD segments could reach it, and overflow is reported, as above.
- **Index cost:** each `seq` key is a distinct JSON path under `metadata["voice.points"]`. Paths are bounded by the longest call's point count, but still more than #2612's one array per row. This needs a Brainstore owner's check (open question).
- **Many small writes:** about 30 merges for a 13 s call instead of 2 chunk rows. They ride the logger's batching, but each lands as its own merge on the row.
- **Reading needs every span header:** Lingua already loads all headers of a trace, so this is no extra fetch. A partial span load would miss points; the `seq` gap warning shows it.
- **Preemptive generation discarded:** its `llm_response` keeps its `response_start` and `in_reply_to`, and its `agent_turn` moves to the successor (`continueDiscardedTurn`, `aa.ts:476-483`). Nothing is rewritten. A `response_start` whose handle never plays links to no speech.
- **Tool cancelled by interruption:** `tool_result{outcome: cancelled}` on the tool span. The cause is the handle's `speech_end.interrupted_by`.
- **Same as #2612:** clock offset between `local` and `audio`, content capture off, agent handoff, and duplicate observers.

## Implementation starting point

Step 1 is implemented (zod, examples, test). Steps 2, 3 and 5 are sketches. Step 4 is implemented in the companion Lingua PR, except the allow-list keys.

1. Lock the schema in `span-points.ts`, including the owner table and the 256 limit.
2. LiveKit: add `points.ts` beside `turns.ts`, with the per-session `seq`, owner lookup through `processor.ts` rows, one `span.log` per point and the fallback to the call span. Wire it to the #2612 hooks. Set `voice.points_version` and `voice.pipeline` at `_startImpl`.
3. At close: write the `missing` points and `call_end` on the call span, then flush.
4. Lingua: `build_points` exists in the companion PR. Extend it with the app allow-list keys after #486 is rebased.
5. Pipecat: the same writer on the reference integration's `user_turn` and `assistant_turn` spans, as above.

## Open questions

- Is one JSON path per `seq` key acceptable for Brainstore's metadata index? The alternative is an array per span, rewritten whole on each write. It needs serialized writes per span, but it is small, because spans hold 1–5 points.
- Should turn spans be required for this option, with a warning when points fall back to the call span?
- Should `interrupted_by` move into call timeline too? It applies there unchanged.
- Should the talk-over case get its own point, such as `turn_dropped{reason}`, instead of an absent `end_of_turn`?
- Message ids on LLM spans: the recommended #2612 extension applies unchanged.
