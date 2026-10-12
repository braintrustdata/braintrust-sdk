# Voice schema option: call timeline

> AI-created or modified and not human-reviewed in its current form; treat this artifact as provisional. Updated 2026-10-12.

Integrations log what they observe during a call as an append-only event log on child rows of the call span. The SDK never builds speech spans or turns: Lingua groups caller utterances into turns at `end_of_turn` events, links speech to steps and cuts audio selections, and the app computes latencies and overlaps from the log.

## Customer problem

A customer debugging a voice agent needs to answer five questions:

- What did each side say?
- What did it sound like?
- Where did time go between the caller finishing and the agent speaking?
- Who talked over whom?
- Which tool call caused a pause?

Today that evidence is scattered. It sits in span names (`user_turn`, `livekit.agent_speaking`), in vendor keys (`contrib.livekit.*`, `contrib.pipecat.*`), in span times on different clocks, and in selections that exist only after upload. Realtime pipelines add transcripts that arrive late or never, and an interruption point reported by the provider that may differ from what the caller heard.

## Schema at a glance

Evidence lives in `metadata["voice.events"]` on `voice.timeline` child rows; the call span carries only the recordings and two required keys. Step spans (`llm_response`, tools, `tts`) are unchanged.

<!-- prettier-ignore -->
```ts
// Call span (root). span_attributes = { name: "livekit.agent_session", type: "task" }
type CallRow = {
  input: { audio: Record<RecordingId, Attachment> }           // shared @braintrust/audio, ready segments only
  metadata: {
    "audio.recordings"?: AudioRecording[]                     // shared; absent when audio capture is off
    "voice.timeline_version": 1                               // required; selects the timeline path in Lingua
    "voice.pipeline": "cascaded" | "realtime" | "half_cascade" // required; pipeline at call start
    "voice.timeline_origin_unix_ms"?: number                  // unix ms; required iff "audio.recordings" is absent
    "voice.server_vad_silence_ms"?: number                    // ms already subtracted from realtime caller speech_end
  }
}
type AudioRecording = {                                       // shared layer, unchanged
  id: RecordingId; state: "ready" | "pending" | "omitted"; duration_ms?: number   // duration_ms: ready only
  attachment?: { span_id: string; ref: string }               // ready only; ref = "/input/audio/<id>"
  sources?: { channel_index: number; boundary: string }[]     // "session_input" = ch 0 caller, "local_audio_output" = ch 1 agent
  timeline?: { origin_unix_ms: number; recording_start_offset_ms: number } // unix ms; call ms
}
// "audio.selections" is not logged by this option: Lingua cuts selections from speech intervals.

// Timeline row: child of the call span, one per flushed chunk. span_attributes = { name: "voice.timeline", type: "task" }
type TimelineRow = {
  span_parents: [CallSpanId]
  metrics: { start: number; end: number }                     // unix s = (origin_unix_ms + min/max at_ms) / 1000
  metadata: {
    "voice.timeline": { call_span_id: string; chunk_index: number; final: boolean } // final: only the call-end chunk
    "voice.events": VoiceEvent[]                              // 1..256, consecutive seq across chunks
  }
}
type VoiceEvent = { seq: number; at_ms: number; basis: "audio" | "local" | "provider" } & (  // seq: int >= 0; at_ms: call ms >= 0
  | { kind: "speech_start"; speaker: Speaker; utterance_id: UtteranceId; response_id?: ResponseId } // response_id: agent only
  | { kind: "speech_end"; speaker: Speaker; utterance_id: UtteranceId; interrupted?: boolean; played_ms?: number } // agent only; played_ms: ms
  | { kind: "transcript"; speaker: Speaker; utterance_id: UtteranceId; final: boolean
      source: "stt" | "provider" | "playout"; text?: string; message_id?: MessageId } // at_ms = arrival; text absent if capture off
  | { kind: "message"; speaker: Speaker; message_id: MessageId; utterance_ids: UtteranceId[] } // chat item <- utterances, >= 1
  | { kind: "end_of_turn"; utterance_ids: UtteranceId[] }     // caller utterances committed since the previous end_of_turn, >= 1
  | { kind: "response_start"; response_id: ResponseId; span_id: string; in_reply_to?: UtteranceId[] } // span_id of the llm_response row
  | { kind: "tool_call"; response_id: ResponseId; tool_call_id: string; name: string; span_id: string } // span_id of the tool row
  | { kind: "tool_result"; tool_call_id: string; span_id: string; outcome: "ok" | "error" | "cancelled" }
  | { kind: "truncate"; utterance_id: UtteranceId; audio_end_ms: number } // ms after that agent speech_start; marker only
  | { kind: "missing"; evidence: "transcript" | "speech_end" | "audio" | "tool_result" | "timeline"; reason: string
      utterance_id?: UtteranceId }                            // required for transcript / speech_end
  | { kind: "call_end"; reason: string }                      // last event
)
type Speaker = "user" | "agent"
type UtteranceId = string  // caller "u<n>"; agent "<SpeechHandle.id>/<n>" (Pipecat "<context_id>/<n>")
type ResponseId = string   // LiveKit SpeechHandle.id of the reply task; Pipecat SDK counter
type MessageId = string    // framework chat item id (realtime: provider item id)
// Step rows (unchanged): tool row metadata["gen_ai.tool.call.id"] = tool_call_id,
//   metadata["contrib.livekit.request_span_id"] = span_id of the llm_response that requested it.
```

**Time.**

- `at_ms` is call ms: milliseconds since `audio.recordings[].timeline.origin_unix_ms` (or `voice.timeline_origin_unix_ms` without a recording). Call ms `t` is offset `t - recording_start_offset_ms` inside a segment.
- `basis` says how each `at_ms` was obtained: `audio` (recorder sample positions: agent playout), `local` (hook wall clock minus a known delay: caller VAD, transcripts, end of turn, responses, tools), `provider` (provider ms on a known anchor: Pipecat realtime only). `played_ms` and `truncate.audio_end_ms` are durations from the agent `speech_start`.
- `metrics.start` / `metrics.end` are unix seconds. On timeline rows they only place the row; on step rows they are span-clock times and are never mixed with `at_ms`.

**Relationships.**

```
transcript.utterance_id, speech_end.utterance_id, truncate.utterance_id -> speech_start.utterance_id
end_of_turn.utterance_ids[], response_start.in_reply_to[]               -> caller utterance ids
message.utterance_ids[]  -> utterance ids;  message.message_id / transcript.message_id -> chat item id
speech_start.response_id (agent)  -> response_start.response_id -> response_start.span_id = llm_response row
tool_call.response_id             -> response_start.response_id;  tool_call.tool_call_id -> tool_result.tool_call_id
tool_call.span_id / tool_result.span_id -> tool row;  tool row "gen_ai.tool.call.id" = tool_call_id
```

**Scenario excerpt.** Selected `voice.events` from [`examples/cascaded.json`](examples/cascaded.json) and [`examples/realtime.json`](examples/realtime.json), unchanged except for omitted events.

<!-- prettier-ignore -->
```jsonc
// cascaded: call span { "voice.timeline_version": 1, "voice.pipeline": "cascaded" }
{ "seq": 1, "at_ms": 2900, "basis": "local", "kind": "speech_end", "speaker": "user", "utterance_id": "u1" },
{ "seq": 2, "at_ms": 3450, "basis": "local", "kind": "transcript", "speaker": "user", "utterance_id": "u1", "final": true,
  "text": "Hi, can I move my Thursday cleaning to Friday morning?", "source": "stt" },
{ "seq": 3, "at_ms": 3400, "basis": "local", "kind": "end_of_turn", "utterance_ids": ["u1"] },
{ "seq": 4, "at_ms": 3450, "basis": "local", "kind": "message", "speaker": "user", "message_id": "item_u1", "utterance_ids": ["u1"] },
{ "seq": 5, "at_ms": 3450, "basis": "local", "kind": "response_start", "response_id": "speech_1", "span_id": "llm-1", "in_reply_to": ["u1"] },
{ "seq": 6, "at_ms": 4100, "basis": "local", "kind": "tool_call", "response_id": "speech_1", "tool_call_id": "call_1",
  "name": "find_slots", "span_id": "tool-1" },
{ "seq": 9, "at_ms": 5300, "basis": "audio", "kind": "speech_start", "speaker": "agent", "utterance_id": "speech_2/0", "response_id": "speech_2" },
{ "seq": 10, "at_ms": 7600, "basis": "local", "kind": "speech_start", "speaker": "user", "utterance_id": "u2" },
{ "seq": 11, "at_ms": 7900, "basis": "audio", "kind": "speech_end", "speaker": "agent", "utterance_id": "speech_2/0",
  "interrupted": true, "played_ms": 2600 },
{ "seq": 12, "at_ms": 7900, "basis": "local", "kind": "transcript", "speaker": "agent", "utterance_id": "speech_2/0", "final": true,
  "text": "I have nine thirty or eleven on Fri", "source": "playout" },
{ "seq": 14, "at_ms": 8520, "basis": "local", "kind": "transcript", "speaker": "user", "utterance_id": "u2", "final": true,
  "text": "Nine thirty works.", "source": "stt" }
```

<!-- prettier-ignore -->
```jsonc
// realtime: call span adds "voice.server_vad_silence_ms": 500
{ "seq": 1, "at_ms": 2900, "basis": "local", "kind": "speech_end", "speaker": "user", "utterance_id": "u1" }, // receipt 3400 - 500
{ "seq": 2, "at_ms": 3600, "basis": "local", "kind": "end_of_turn", "utterance_ids": ["u1"] }, // generation entry, not a commit
{ "seq": 3, "at_ms": 3600, "basis": "local", "kind": "message", "speaker": "user", "message_id": "item_u1", "utterance_ids": ["u1"] },
{ "seq": 4, "at_ms": 3600, "basis": "local", "kind": "response_start", "response_id": "speech_1", "span_id": "rt-1", "in_reply_to": ["u1"] },
{ "seq": 5, "at_ms": 4100, "basis": "local", "kind": "tool_call", "response_id": "speech_1", "tool_call_id": "call_1",
  "name": "find_slots", "span_id": "tool-1" },
{ "seq": 6, "at_ms": 4300, "basis": "local", "kind": "transcript", "speaker": "user", "utterance_id": "u1", "final": true,
  "text": "Hi, can I move my Thursday cleaning to Friday morning?", "source": "provider", "message_id": "item_u1" }, // after the tool call
{ "seq": 9, "at_ms": 5000, "basis": "audio", "kind": "speech_start", "speaker": "agent", "utterance_id": "speech_2/0", "response_id": "speech_2" },
{ "seq": 10, "at_ms": 7600, "basis": "local", "kind": "speech_start", "speaker": "user", "utterance_id": "u2" },
{ "seq": 11, "at_ms": 7900, "basis": "audio", "kind": "speech_end", "speaker": "agent", "utterance_id": "speech_2/0",
  "interrupted": true, "played_ms": 2900 },
{ "seq": 12, "at_ms": 7900, "basis": "local", "kind": "truncate", "utterance_id": "speech_2/0", "audio_end_ms": 2900 }, // realtime only; = played_ms
{ "seq": 13, "at_ms": 7900, "basis": "local", "kind": "transcript", "speaker": "agent", "utterance_id": "speech_2/0", "final": true,
  "text": "I have nine thirty or eleven on Fri", "source": "playout" },
{ "seq": 17, "at_ms": 8600, "basis": "local", "kind": "message", "speaker": "user", "message_id": "item_u2", "utterance_ids": ["u2"] }, // no transcript
{ "seq": 26, "at_ms": 13000, "basis": "local", "kind": "missing", "utterance_id": "u2", "evidence": "transcript",
  "reason": "input_transcription_not_received" } // replaces the cascaded seq 14 transcript
```

Cascaded vs realtime: what changes in the payload

|                          | Cascaded                                 | Realtime                                                                                   |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Call span                | `voice.pipeline: "cascaded"`             | `"realtime"`, plus `voice.server_vad_silence_ms` when the integration is given it          |
| Caller transcript        | `source: "stt"`, before `response_start` | `source: "provider"` with `message_id`; may arrive after `tool_call`, or never (`missing`) |
| `end_of_turn.at_ms`      | turn detector resolve time (3400)        | entry of the answering generation (3600)                                                   |
| Caller `message`         | at the user commit                       | at generation entry, even without a transcript (`item_u2`)                                 |
| Interrupted agent speech | `speech_end` with `played_ms` only       | same, plus a `truncate` marker equal to `played_ms` (LiveKit)                              |
| Step rows                | `llm_response` + `tts` rows              | `llm_response` rows only (`contrib.livekit.response_id` = provider response id)            |

Implemented: zod types (`js/src/instrumentation/livekit/voice-schema/call-timeline.ts`), examples, test. Sketch: LiveKit/Pipecat emission. Lingua mapping: implemented in the companion Lingua PR (`specs/voice-schema-call-timeline.md`, branch `kevchoi/voice-schema-call-timeline`).

## Contract

**Implemented** as zod in `call-timeline.ts`, exercised by both examples and the test. Field-level rules the zod cannot express are stated here.

### Call span

The call span is the span that logs `audio.recordings`, or the session span when there is no recording.

| Metadata key                    | Type                                         | Req.                                  | Meaning                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice.timeline_version`        | `1`                                          | yes                                   | Marks the call as using this contract. Lingua builds timeline speech only when it is present; otherwise it uses the #486 turn-span path.                                          |
| `voice.pipeline`                | `"cascaded" \| "realtime" \| "half_cascade"` | yes                                   | Pipeline shape, set at session start. `half_cascade` is a text-output realtime model plus TTS: caller events follow the realtime rules, and agent events follow cascaded playout. |
| `voice.timeline_origin_unix_ms` | number, unix ms                              | yes when `audio.recordings` is absent | Origin of the call clock when there is no recording. Omit it when there is a recording.                                                                                           |
| `voice.server_vad_silence_ms`   | number, ms                                   | no                                    | Realtime server-VAD silence that the SDK subtracted from caller `speech_end` receipt times. Set only when the integration was given that value.                                   |

### Timeline rows

The integration buffers events and flushes them as **timeline rows**: child spans of the call span.

| Field            | Location                        | Type                         | Req. | Meaning                                                                                                    |
| ---------------- | ------------------------------- | ---------------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| name, type       | `span_attributes`               | `"voice.timeline"`, `"task"` | yes  | One row per chunk                                                                                          |
| parent           | `span_parents[0]`               | span id                      | yes  | The call span                                                                                              |
| `voice.timeline` | `metadata`                      | object                       | yes  | `{ call_span_id, chunk_index, final }`, described below                                                    |
| `voice.events`   | `metadata`                      | `VoiceEvent[]`, 1–256        | yes  | Events with consecutive `seq`                                                                              |
| start, end       | `metrics.start` / `metrics.end` | unix s                       | yes  | `(origin_unix_ms + min/max at_ms) / 1000` over the chunk's events. Used only to place the row in the tree. |

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

| Common field | Type                               | Req. | Meaning                                                                                                |
| ------------ | ---------------------------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| `seq`        | int ≥ 0                            | yes  | Emission order, consecutive per call across chunks. A gap means a lost or unflushed chunk.             |
| `at_ms`      | number ≥ 0                         | yes  | When the thing happened, in **call ms** (see Timing semantics). Not necessarily increasing with `seq`. |
| `basis`      | `"audio" \| "local" \| "provider"` | yes  | How `at_ms` was obtained                                                                               |
| `kind`       | enum below                         | yes  |                                                                                                        |

| `kind`           | Extra fields (`?` = optional)                                        | Meaning and timing                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `speech_start`   | `speaker`, `utterance_id`, `response_id?`                            | Start of one VAD speech segment (caller) or of playout (agent). `response_id` is set on agent speech when playback was attributed to a reply task, and never on caller speech.                                                                                                                                                                          |
| `speech_end`     | `speaker`, `utterance_id`, `interrupted?`, `played_ms?`              | Real end of that segment. Caller: the VAD stop time minus the known silence delay; LiveKit realtime without `voice.server_vad_silence_ms` uses the receipt time, which includes the padding. Agent: the playout stop. `interrupted` and `played_ms` (ms of audio played since `speech_start`) are always set on agent speech, never on caller.          |
| `transcript`     | `speaker`, `utterance_id`, `final`, `source`, `text?`, `message_id?` | Text for one utterance. `at_ms` is when the text arrived. `source` is `stt`, `provider` or `playout`. MVP integrations emit finals only (`final: true`); `final: false` is reserved for interim text, which Lingua copies but never attaches. `message_id` is set when the transcript event itself carries the chat item id (realtime provider finals). |
| `message`        | `speaker`, `message_id`, `utterance_ids[]`                           | The framework committed a chat item made from these utterances. One per chat item.                                                                                                                                                                                                                                                                      |
| `end_of_turn`    | `utterance_ids[]`                                                    | The turn detector committed the caller's turn; lists the caller utterances since the previous `end_of_turn`.                                                                                                                                                                                                                                            |
| `response_start` | `response_id`, `span_id`, `in_reply_to?[]`                           | An LLM or realtime generation started. `span_id` is the `span_id` of its `llm_response` row.                                                                                                                                                                                                                                                            |
| `tool_call`      | `response_id`, `tool_call_id`, `name`, `span_id`                     | A tool started. `tool_call_id` equals the LLM output `tool_calls[].id` and the tool row's `gen_ai.tool.call.id`; `span_id` is the tool row.                                                                                                                                                                                                             |
| `tool_result`    | `tool_call_id`, `span_id`, `outcome`                                 | The tool finished. `outcome` is `ok`, `error` or `cancelled`.                                                                                                                                                                                                                                                                                           |
| `truncate`       | `utterance_id`, `audio_end_ms`                                       | Marker: the SDK told a realtime provider the agent item was cut at `audio_end_ms`, in ms after that utterance's `speech_start`. It does not end speech.                                                                                                                                                                                                 |
| `missing`        | `evidence`, `reason`, `utterance_id?`                                | Expected evidence will never arrive. `at_ms` is when that was decided (call end for close-time checks). `reason` is a free snake_case string. See the emitter list below.                                                                                                                                                                               |
| `call_end`       | `reason`                                                             | Session closed. This is the last event emitted. `reason` is a free snake_case string such as `participant_disconnected`.                                                                                                                                                                                                                                |

`missing` emitters in the MVP:

- `transcript` (with `utterance_id`): at close, a committed caller utterance with no final and not covered by its group's final.
- `speech_end` (with `utterance_id`): at close, a `speech_start` with no end.
- `timeline` (no `utterance_id`): buffer overflow, as above.
- `audio` and `tool_result`: reserved, with no MVP emitter. Recording gaps live on `audio.recordings[].state`, and a `tool_call` with no `tool_result` is itself the evidence.

`text` is omitted when content capture is off. All other fields carry timing or identity and are always logged.

## IDs and relationships

**`utterance_id`: one speaker, one contiguous speech segment, unique per call.**

- **Caller, all pipelines:** an SDK counter `u<n>`, assigned at `speech_start`. Realtime speech-start and speech-stop events carry no item id (LiveKit `input_speech_started` / `input_speech_stopped`), so the provider input item id arrives later through `message`.
- **Agent, LiveKit (all pipelines):** `<speechHandle.id>/<n>`, where `n` counts playout stretches of one speech handle. Each tool continuation runs its own reply task with its own handle (for example `speech_2/0` after the `speech_1` tool call). Do not use `lk.speech_id`: it is turn-level and is shared across tool continuations. A realtime output item id is linked later through a `message` event, when LiveKit adds the item to the conversation.
- **Agent, Pipecat:** `<context_id>/<n>`, where `n` counts playout stretches within the TTS context: it increments when output resumes after an interruption or a gap.

**A caller turn is one or more utterances.** `end_of_turn.utterance_ids` lists them. The SDK does not merge VAD segments.

**Transcript to utterance.** No caller speech event carries an item id, so the SDK attaches each caller final by one of these rules.

- **STT finals (`source: stt`, cascaded and half-cascade STT):** attach to the caller utterance that is open at arrival, or else to the most recently ended one, within the current uncommitted turn. Several finals for one utterance are joined in `seq` order. A final that arrives after `end_of_turn` attaches to the last utterance of that turn.
- **Provider finals with an item id (`source: provider`, LiveKit realtime, Pipecat with OpenAI):** set `message_id` to the event's item id and attach to the first utterance of the `message` that already mapped that id (see `message_id` below).
- **Provider finals without an item id (Gemini Live), or whose id was never mapped:** attach FIFO to the oldest committed caller utterance group (an `end_of_turn` list) that has no final yet. A provider transcribes committed audio in commit order, often after the next utterance has started, so "open at arrival" would pick the wrong one.
  - **Assumption:** each committed `end_of_turn` group becomes one provider input item, so one provider final arrives per group. The final's text goes on the group's first utterance, and the group's other utterances are marked covered, not missing. That way a multi-utterance group never shifts later turns' finals.
  - If the caller had already barged in, the barge-in utterance would be open, yet the final still goes to the older committed group.
- **No final:** an utterance that never gets a final, and is not covered by its group's final, gets `missing{evidence: transcript}` at close. It still has its `message` when the framework committed an item for it.

**`message_id`:**

- **Caller, cascaded:** a `message` event fires when the user item commits (LiveKit `_conversationItemAdded`, Pipecat context aggregator push).
- **Caller, realtime (decision E):** LiveKit adds the realtime user item to the conversation only when a final transcript arrives, so the SDK does not wait for it. At `_realtimeGenerationTaskImpl` entry it diffs `realtimeSession.chatCtx.items` for new user items and pairs the oldest new item with the oldest committed caller utterance group that has no `message` yet. It emits `message` there, after `end_of_turn`, even when no transcript ever arrives (`item_u2` in the realtime example). The later `_conversationItemAdded` for the same item id emits nothing.
- **Agent:** a `message` event maps `<speechHandle.id>/<n>` to the assistant chat item, which is the realtime output item id in realtime pipelines, when LiveKit adds it (`_conversationItemAdded`).
- **Use:** Lingua and the app use it to match conversation messages; Lingua copies it and derives nothing from it.

**`response_id`:**

- LiveKit (both pipelines): the `SpeechHandle.id` captured at `_pipelineReplyTaskImpl` / `_realtimeGenerationTaskImpl` entry. The provider response id stays on the `llm_response` span (`contrib.livekit.response_id`).
- Pipecat: an SDK counter.
- `response_start.span_id` is the `llm_response` span started inside that handle's reply task. If a reply task starts several, it is the latest one started before playback starts. This is the only link from the timeline to the LLM steps.

**Agent speech to its generation:** `speech_start.response_id`.

**Tools:** `tool_call.response_id` is the generation that requested the tool. `tool_call_id` joins `tool_call`, `tool_result`, the tool row (`gen_ai.tool.call.id`) and the LLM `tool_calls[].id`.

**`in_reply_to`:** the caller utterances the framework handed to this generation.

- **Required on preemptive generations,** meaning any `response_start` emitted before its turn's `end_of_turn`. LiveKit: snapshot the uncommitted caller utterance ids in `onPreemptiveGeneration`, then attach them to the `response_start` of that preemptive speech handle's `llm_response` span, including preemptive responses that are later discarded. Otherwise it is recommended, and both examples set it.
- **Linking:** Lingua uses `in_reply_to` whenever it is present, and falls back to the `end_of_turn` window only when it is absent.

## Timing semantics

- **Order versus time:**
  - `seq` is emission order and defines log order.
  - `at_ms` is when the thing happened. For example, a VAD `speech_end` is emitted after the silence delay but dated at the real end, so it can be smaller than an earlier event's `at_ms`.
  - Lingua orders speech by `at_ms` and uses `seq` only to break ties and to define turn windows.
- **Call clock:** `at_ms` is milliseconds since the recordings' `timeline.origin_unix_ms`, which is `snapshot().origin` in `@braintrust/audio`. Call ms `t` falls in a ready segment `s` at offset `t - s.timeline.recording_start_offset_ms`.
- **Span clock:** `metrics.start` / `metrics.end` on every row are unix seconds. On timeline rows they are derived from `at_ms`. On step rows they are the span's own wall-clock times; `metrics.start * 1000 - origin_unix_ms` approximates call ms, but Lingua never mixes the two.
- **`basis` values:**
  - `audio`: computed from sample positions the recorder placed on the timeline, such as playout ranges from `playbackProgressed`. It matches the recording by construction.
  - `local`: `Date.now() - origin`, minus a known framework delay where one applies, such as the VAD silence duration. Expect event-loop jitter under 20 ms.
  - `provider`: a provider time converted to the call clock. Use it only when the anchor is known; otherwise use `local`.

    | Provider        | Provider time                                                                                                      | Anchor                                               | Result                                     |
    | --------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------ |
    | OpenAI Realtime | `audio_start_ms` / `audio_end_ms`, cumulative from the start of all audio written to the input buffer this session | call ms of the first audio frame sent in the session | `at_ms = anchor + audio_*_ms` (`provider`) |
    | Gemini Live     | none                                                                                                               | —                                                    | receipt time (`local`)                     |

    LiveKit's realtime events do not expose these fields today, so LiveKit realtime uses `local`.

- **Agent speech:** it ends at `speech_end`, the played end. `truncate` only records what was sent to the provider.
  - **LiveKit:** it computes `audioEndMs` from the same local `playbackPosition` (`agent_activity.ts:4789-4802`), so `truncate.audio_end_ms` always equals `played_ms`. In the realtime example both are 2900.
  - **Pipecat:** only integrations that observe the provider independently, such as Pipecat reading raw provider events, can show a provider-versus-playout disagreement.
- **No recording:** without one, `voice.timeline_origin_unix_ms` is the origin, and Lingua treats `audio` basis as `local`.

## What integrations capture, and when

**Sketch.** No emission code exists yet; these tables are the plan, checked against `@livekit/agents` 1.9.2 sources.

### LiveKit (JS, `js/src/instrumentation/livekit`)

Citations are `@livekit/agents` 1.9.2 `src/` paths; `aa.ts` is `voice/agent_activity.ts`.

| Event                                | Cascaded (`_pipelineReplyTaskImpl`, `aa.ts:3747`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Realtime (`_realtimeGenerationTaskImpl`, `aa.ts:4496`)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| caller `speech_start` / `speech_end` | Per VAD segment: hook `onStartOfSpeech` (`aa.ts:2108`) / `onEndOfSpeech` (`aa.ts:2152`). Start = now − `speechDuration` − `inferenceDuration`; end = now − `silenceDuration` − `inferenceDuration`, as LiveKit computes for native `user_speaking` (`aa.ts:2111-2112`, `2156-2157`). `local`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Server turn detection on:** `onInputSpeechStarted` / `onInputSpeechStopped` (`aa.ts:1967`, `2000`); the events carry no provider ms (`llm/realtime.ts:16-18`). `u<n>` at receipt (`local`); end = receipt − `voice.server_vad_silence_ms` only when that option is passed to the integration, else receipt, which includes the silence padding. Local VAD hooks are not used. **Server turn detection off:** local VAD hooks as in cascaded.                                                   |
| caller `transcript`                  | `user_input_transcribed` finals (`onFinalTranscript`, `aa.ts:2369`), `source: stt`, STT rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `input_audio_transcription_completed`, `source: provider`, `message_id` = its `itemId`, attached through the earlier `message` (FIFO rule as fallback); may arrive after `response_start`                                                                                                                                                                                                                                                                                                        |
| `message`                            | Emitted only from the `AgentSession._conversationItemAdded` hook. The user item comes from the normal commit inside `_pipelineReplyTaskImpl` (`aa.ts:3975`, only when `speechHandle.scheduled`); a skipped turn (`commitSkippedUserTurn`, `aa.ts:3272`) emits no `message`. Assistant items also come through this hook (`aa.ts:4273`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Caller: at `_realtimeGenerationTaskImpl` entry, after `end_of_turn`, from the diff of `realtimeSession.chatCtx.items` (decision E), so items without a transcript still get one; the later `_conversationItemAdded` for that id (`aa.ts:2054`) is deduplicated. Agent: `_conversationItemAdded` (`aa.ts:4827`). The transcription event emits only `transcript`.                                                                                                                                 |
| `end_of_turn`                        | Committed turns only. At `onEndOfTurn` (`aa.ts:2690`), record the resolve time if the call returned `true` and neither `schedulingPaused` (`aa.ts:1230`) nor `newTurnsBlocked` (`aa.ts:550`) was set before it (the paused branch is `aa.ts:2700-2711`). Emit the event, with `at_ms` = that resolve time, when the turn's reply is scheduled (the user commit at `aa.ts:3975`). Turns that `userTurnCompleted` later drops emit **no** `end_of_turn`: the AMD `skipReply` (`aa.ts:2697`, committed via `aa.ts:3316-3319`), the non-interruptible drop (`aa.ts:3328-3333`), and `StopResponse` (`aa.ts:3388-3390`). Their utterances leave the pending list and appear in no `end_of_turn`, so Lingua attaches them to the turn open at their start. Lists the caller utterances since the previous `end_of_turn`. | **Server turn detection on:** there is no commit event (`userTurnCompleted` returns early, `aa.ts:3301-3302`). Emit at `_realtimeGenerationTaskImpl` entry for a generation that answers caller input, listing caller utterances since the previous `end_of_turn` that are already closed. Utterances still open at task entry are excluded and go to the next `end_of_turn`. Tool-continuation generations have no new utterances and emit none. **Server turn detection off:** as in cascaded. |
| `response_start`                     | `llm_response` span start inside the handle's reply task. LiveKit's `speechHandleStorage` (`agent.ts:70`) is not exported, so the SDK sets its own async-local context with the `SpeechHandle` at `_pipelineReplyTaskImpl` entry and reads it in the span processor's `onStart`. `response_id` = `SpeechHandle.id`. For preemptive handles, `in_reply_to` comes from the `onPreemptiveGeneration` snapshot (`aa.ts:2433`, guard at `aa.ts:2440`).                                                                                                                                                                                                                                                                                                                                                                  | The `_realtimeGenerationTaskImpl` hook reads its `inferenceSpan` argument (the `realtime_inference` span started at `aa.ts:4478`, exported as `llm_response`) and its handle; `response_id` = `SpeechHandle.id`. Preemptive generation is cascaded only (`aa.ts:2441`).                                                                                                                                                                                                                          |
| `tool_call` / `tool_result`          | `function_tool` span start and end; `cancelled` when the handle was interrupted first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | same                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| agent `speech_start` / `speech_end`  | Playback hook on `AudioOutput`, installed independently of audio capture so audio-off calls still get bounds. Start = first `playbackStarted` (`voice/io.ts:118`, `210`) / `captureFrame`, attributed to `activity.currentSpeech` (`aa.ts:1168`). End = `playbackFinished` with `playbackPosition` (`interrupted`, `played_ms`). `audio` when capture places frames, else `local`.                                                                                                                                                                                                                                                                                                                                                                                                                                 | same                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| agent `transcript`                   | `playbackFinished.synchronizedTranscript`, `source: playout`; else assistant item text (`provider`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | same                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `truncate`                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Only when `capabilities.messageTruncation` and the output was cut (`aa.ts:4789`). `audio_end_ms` = `playbackPosition` (`aa.ts:4797-4802`), so it equals `played_ms`.                                                                                                                                                                                                                                                                                                                             |
| `missing`                            | At close: caller utterances in a committed turn with no final transcript, and starts without ends                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | same                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `call_end`                           | `closeImpl`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | same                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Starting point: add `timeline.ts` beside `turns.ts`. It owns `seq`, the buffer, the flush and retry rules, and the transcript-attachment rule. Keep it on the per-session state in `processor.ts`.

### Pipecat (Python, sketch against `sdk-python` `delner/pipecat-voice-recording`)

The timeline observer sits at the transport output processor, so agent events reflect audio actually written.

| Event                                | Cascaded                                                                                                                                                                                                                                                                                      | Realtime (OpenAI / Gemini services)                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| caller `speech_start` / `speech_end` | `VADUserStartedSpeakingFrame` / `VADUserStoppedSpeakingFrame`, end dated stop time − VAD `stop_secs` (`local`); `audio` when the input sample clock is aligned                                                                                                                                | provider speech start/stop (`provider`, anchored as above)                                                                                                                 |
| caller `transcript`                  | `TranscriptionFrame` (finalized), attached by the STT rule, `source: stt`                                                                                                                                                                                                                     | the service's input transcription, attached FIFO by the provider rule, `source: provider`                                                                                  |
| `message`                            | context aggregator push of the user or assistant message                                                                                                                                                                                                                                      | caller: at the provider's commit event with its item id (OpenAI `input_audio_buffer.committed`), with or without a transcript; none for Gemini Live, which has no item ids |
| `end_of_turn`                        | `UserStoppedSpeakingFrame` after the turn strategy commits; `utterance_ids` = VAD utterances since the previous `end_of_turn`                                                                                                                                                                 | the service's commit event                                                                                                                                                 |
| `response_start`                     | `LLMFullResponseStartFrame`; `span_id` is the SDK's own `llm_response` span id, known when the span is created; `in_reply_to` = the same VAD utterances                                                                                                                                       | same                                                                                                                                                                       |
| `tool_call` / `tool_result`          | `FunctionCallInProgressFrame` / `FunctionCallResultFrame` / `FunctionCallCancelFrame`                                                                                                                                                                                                         | same                                                                                                                                                                       |
| agent `speech_start` / `speech_end`  | `TTSAudioRawFrame` bytes written by the output transport: start = call ms of the first write of a `context_id`; end = start + bytes written / (sample rate × channels × 2) × 1000, which also gives `played_ms`, both with `basis: audio`; `interrupted` when an `InterruptionFrame` stops it | same, per output item                                                                                                                                                      |
| agent `transcript`                   | `TTSTextFrame` words written before the stop, `source: playout`                                                                                                                                                                                                                               | same; provider transcript only as a fallback (`source: provider`)                                                                                                          |

## What Lingua records versus infers

**Implemented** in the companion Lingua PR (builder, fixtures from these examples).

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

**Implemented in Lingua** (`VoiceCall.events`, `Speech` from the timeline); the app strip is a sketch.

`Trajectory.voice_calls[*]` keeps the #486 fields. `speech` and `recordings` are built from the timeline, so #22034 and #22036 work unchanged: the voice bar, click-to-step, play-from-message and highlighting.

`VoiceCall.events` exposes the log for a latency strip:

- caller `speech_end` → `end_of_turn` → `response_start` → first agent `speech_start` in the window
- overlap shading
- `missing` badges
- truncate markers

Thread messages still come from LLM span inputs and outputs.

## Worked example

**Implemented:** `examples/cascaded.json` and `examples/realtime.json` encode the same fictional call and are parsed by the test. Row tree:

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

|                                                | Cascaded                                                                                                   | Realtime                                                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caller utterance ids                           | `u1`, `u2`                                                                                                 | `u1`, `u2`; `message` maps `u1` → `item_u1` at 3600 (generation entry)                                                                                                                       |
| Caller transcript of turn 1                    | `stt` at 3450; `message` links `item_u1` at commit                                                         | `provider` at 4300 with `message_id: item_u1`, after `tool_call` at 4100                                                                                                                     |
| Turn-1 latency, caller end → first agent audio | 2900 → 5300 = 2400 ms: 500 ms end-of-turn wait, 50 ms STT, 650 ms LLM, 500 ms tool, 500 ms LLM, 200 ms TTS | 2900 → 5000 = 2100 ms: 700 ms to generation entry (`end_of_turn` at 3600; server-VAD silence and commit are not separable in LiveKit), 500 ms to the tool call, 500 ms tool, 400 ms to audio |
| Agent utterance ids                            | `speech_2/0`, `speech_4/0`; `message` links `item_a1`, `item_a2`                                           | same handle-based ids; `message` links the realtime output items `item_a1`, `item_a2`                                                                                                        |
| Barge-in                                       | agent `speech_end` 7900, `played_ms` 2600                                                                  | `speech_end` 7900 with `played_ms` 2900, and a `truncate` marker at 7900 with the same 2900                                                                                                  |
| Out-of-order evidence                          | `u2` STT final arrives at 8520, before the VAD stop is emitted; `speech_end` (seq 15) is dated 8500        | caller `speech_end` is dated receipt 3400 − 500 ms server-VAD silence = 2900                                                                                                                 |
| Caller's barge-in text                         | `stt` "Nine thirty works."                                                                                 | none: `message` `item_u2` at 8600 but `missing{evidence: transcript}`; the `rt-3` input user content is `""`                                                                                 |
| Agent text actually said                       | `playout` "…on Fri"; `llm-2` output holds the planned sentence                                             | `playout` "…on Fri"; `rt-2` output already truncated                                                                                                                                         |
| STT/TTS steps                                  | `tts-1`, `tts-2`                                                                                           | none                                                                                                                                                                                         |

## Customer usefulness

- **What was said: good.** Finals carry their source, the agent's played text is kept separate from generated text, and missing transcripts are explicit.
- **Playing matching audio: good.** Every interval is on the recording clock. Lingua cuts selections per segment and per channel.
- **Diagnosing delays: strongest of the options.** Each stage is a subtraction on one clock, in realtime too.
- **Interruptions and overlap: strong.** Overlap comes from intervals and interruption from `speech_end`. A provider-versus-playout gap is visible only where the integration observes the provider independently (Pipecat); with LiveKit the two values are equal.
- **Following tools: adequate.** Tools are placed in time and linked to spans; arguments and results stay on the spans.
- **Missing or uncertain evidence: strong.** Every time has a `basis`, plus `missing` events, `seq` gaps, and a missing `final` chunk.

## Edge cases and weaknesses

- **Barge-in truncation:** handled. The planned text stays only on the LLM span.
- **Overlap:** intervals overlap freely.
- **Late or missing realtime transcripts:** a late final attaches by `message_id`, or by the FIFO rule when there is none. A missing one gets a `missing` event, and the utterance still has its `message` from generation entry. Weakness: without item ids (Gemini Live, cascaded STT), attachment is a heuristic and can pick the wrong segment of a multi-segment turn.
- **Failed or omitted segments:** speech keeps its times but has no selection over the gap.
- **Unknown clock offset:** `local` events skew against `audio` events unmeasured. A `clock_offset` event is left as an open question.
- **Call in progress, or a crash:** the latest ≤5 s are not yet flushed. With no `final` chunk, Lingua warns and closes open speech.
- **Content capture off:** `text` is dropped, but timing analysis still works.
- **Tool cancelled by interruption:** `tool_result{outcome: cancelled}`. The cause is inferred only from a nearby interrupted agent `speech_end`.
- **Agent handoff:** not modeled. A new agent activity continues the same log, and nothing records which agent spoke. `voice.pipeline` is the pipeline at call start; a handoff that changes the LLM type (for example cascaded to realtime) is out of MVP scope.
- **Duplicate observers:** the SDK must emit one event per moment, such as LiveKit's native `user_turn` plus realtime events. Lingua deduplicates only identical retried chunks.
- **Overall weakness, indirection:** speech, turns and step links depend on Lingua's derivation, and the trace tree alone no longer shows speech.

## Implementation starting point

Step 1 is implemented (zod, examples, test); steps 2, 3 and 5 are sketches; step 4 is implemented in the companion Lingua PR.

1. Lock the schema in `call-timeline.ts`, including `basis`, flush and retry, and the transcript-attachment rule.
2. LiveKit: add `timeline.ts`, the VAD hooks (`onStartOfSpeech` / `onEndOfSpeech`), and a playback hook installed independently of audio capture. Emit from `onEndOfTurn` (when it resolves `true` and commits), `onPreemptiveGeneration` (the `in_reply_to` snapshot), `_pipelineReplyTaskImpl` / `_realtimeGenerationTaskImpl` entry (the speech handle, and realtime `end_of_turn` and caller `message`), the `RealtimeObserver` listeners, `_conversationItemAdded`, and `onStart`/`onEnd` for `llm_response` and `function_tool`. Set `voice.timeline_version` and `voice.pipeline` at `_startImpl`. Keep existing spans and selections during the transition.
3. At close, emit `missing` events, then `call_end`, and flush the `final` chunk.
4. Lingua: the builder exists in the companion PR; extend it with the app allow-list keys after #486 is rebased.
5. Pipecat: port `timeline.ts` to the Python voice package following the table above.

## Open questions

- Should `end_of_turn` carry the detector's delay and probability (LiveKit `eou.*`)?
- Are 5 s and 64 events the right flush defaults?
- Should agent `transcript` carry word timings when the TTS provides alignments?
- Is a `clock_offset` event worth adding, to measure `local` against `audio`?
- **Recommended extension: message ids on LLM spans.** Thread messages come from LLM span inputs, which carry no chat item ids, so the app can join a thread message to its audio only through `Speech.step_ids` today. Logging `voice.context_message_ids` (one id per input message, in order) and `voice.output_message_id` on `llm_response` spans would let click-message-to-audio join on `message.message_id` directly. Not added here: it touches the LLM span contract and the realtime input merging, and step links already cover the #22036 flows.
