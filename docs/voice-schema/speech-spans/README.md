# Voice tracing option: speech spans

> AI-created or modified and not human-reviewed in its current form; treat this artifact as provisional. Updated 2026-10-12.

This option logs each utterance as its own `speech` span with framework-neutral metadata. It keeps the shared whole-call recording, `audio.recordings` and `audio.selections`. It changes how speech is identified: Lingua reads `metadata["voice.speech"]` and `metadata["voice.call"]` instead of LiveKit span names and `contrib.livekit.*` keys. Turn spans, LLM spans and tool spans stay as they are.

**Status:**

| Part                                                                                                                                  | Status                                 |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Contract, zod schema (`js/src/instrumentation/livekit/voice-schema/speech-spans.ts`), example rows and a test that validates the rows | Implemented                            |
| Lingua mapping                                                                                                                        | Implemented in the companion Lingua PR |
| LiveKit and Pipecat emission                                                                                                          | Sketched below, not implemented        |

## Customer problem

Customers want to replay a call and see four things together:

- what each side said, with the matching audio;
- where time went;
- who interrupted whom;
- which tool calls happened.

They also need to see where the trace lacks evidence. Today Lingua finds speech by span names that only LiveKit emits (`user_turn`, `assistant_turn`, `livekit.*_speaking`), so a Pipecat trace or a renamed span drops out of the voice view. When those names are missing, Lingua guesses each utterance's LLM step from start times. Interruption appears only as a LiveKit-specific turn flag.

## Schema at a glance

Evidence lives on one `speech` span per utterance (`metadata["voice.speech"]` plus its audio selections), under the turn span it belongs to; the call span carries the clock and the recording.

<!-- prettier-ignore -->
```ts
// Every row: span_id, root_span_id, span_parents: SpanId[] | null, metrics: { start, end } in unix s. SpanId = a span_id in the same trace.

// Call span (root). span_attributes = { type: "task", name: "livekit.agent_session" | "pipecat.pipeline" }
type CallRow = {
  span_parents: null
  input?: { audio: Record<RecordingId, Attachment> }           // shared @braintrust/audio; when audio is captured
  metadata: {
    "voice.call": {
      framework: "livekit" | "pipecat"
      pipeline: "cascaded" | "realtime" | "half_cascade"       // at call start
      origin_unix_ms: number                                   // unix ms; origin of every call-ms field
    }
    "audio.recordings"?: {                                     // shared, abridged, one per segment; when audio is captured
      id: RecordingId; state: "ready" | "pending" | "omitted"
      attachment?: { span_id: SpanId; ref: string }            // ready only; ref = "/input/audio/<id>"
      timeline: { origin_unix_ms: number                       // unix ms, = voice.call.origin_unix_ms
                  recording_start_offset_ms: number }          // call ms at which this segment starts
    }[]
  }
}
type Selection = {                                             // shared; item of metadata["audio.selections"]
  recording_span_id: SpanId; recording_id: RecordingId         // the call span; a ready audio.recordings[].id
  start_offset_ms: number; end_offset_ms: number               // ms from that segment's start, not call ms
  channel_index: 0 | 1                                         // 0 caller, 1 agent
}

// Turn spans, unchanged. span_attributes = { type: "task", name: "user_turn" | "assistant_turn" }; parent = call
type TurnRow = { metadata: { "turn.id": SpanId                  // own span_id
                             "turn.reply_to"?: SpanId } }       // assistant_turn only: the user_turn it answers

// Speech span, one per utterance. span_attributes = { type: "task", name: "speech" }
type SpeechRow = {
  span_parents: [SpanId]                                       // the turn span, or the call span when there is no turn
  output?: { text?: string                                     // what was said; agent: playout-synchronized text only
             planned_text?: string }                           // agent only: TTS input or response transcript
  metadata: {
    "audio.selections"?: Selection[]                           // >= 1 when present, in order; user ch 0, agent ch 1
    "voice.speech": {
      speaker: "user" | "agent"
      state: "complete" | "interrupted" | "incomplete" | "ignored"
      timing_source: "audio_samples" | "vad" | "provider_vad" | "playout" | "span_clock" // evidence for metrics
      turn_id?: SpanId                                         // = span_parents[0] when that is a turn
      heard_by?: SpanId[]                                      // user only: llm_response spans whose input first held it
      end_of_turn_ms?: number                                  // user only: call ms
      produced_by?: SpanId                                     // agent only: llm_response that generated the text
      interrupted_by?: SpanId                                  // agent only: user speech span; requires state "interrupted"
      played_ms?: number                                       // agent only: > 0, duration ms played locally
      provider_played_ms?: number                              // agent realtime only: duration ms sent in truncate
      transcript?: {
        source: "stt" | "provider_transcription" | "tts_input" | "model_output" | "playback_sync"
        final: boolean
        available_ms?: number                                  // call ms
        confidence?: number                                    // 0-1
      }
    }
  }
}

// Step spans, unchanged; parent = assistant_turn
type LlmRow = { output: Message[]                              // { type: "llm", name: "llm_response" }; may hold tool_calls[].id
                metrics: { time_to_first_token?: number } }    // s
type ToolRow = { input: unknown; output: unknown               // { type: "tool", name: <tool name> }; arguments, result
                 metadata: { tool_call_id: string } }          // = tool_calls[].id in the requesting llm_response output
```

**Time:**

- **Call ms** (`end_of_turn_ms`, `transcript.available_ms`) are ms since `voice.call.origin_unix_ms`, which equals every `audio.recordings[].timeline.origin_unix_ms` when audio is captured.
- **Selection offsets** are ms from the start of the named segment: call ms = `recording_start_offset_ms` + offset. `played_ms` and `provider_played_ms` are durations, not points in time.
- **`metrics.start`/`metrics.end`** are Unix seconds on the same clock, `(origin_unix_ms + call ms) / 1000`. On a speech span with selections they are the first selection start and last selection end in call ms; `timing_source` names the evidence. `time_to_first_token` is in seconds.

**Relationships:**

```text
speech.span_parents[0] == speech.turn_id   -> user_turn / assistant_turn span_id (call span_id when no turn)
speech(user).heard_by[]                    -> llm_response span_ids that first saw the utterance
speech(agent).produced_by                  -> llm_response span_id that generated the spoken text
speech(agent).interrupted_by               -> speech(user) span_id
assistant_turn["turn.reply_to"]            -> user_turn span_id
tool.metadata.tool_call_id                 == llm_response.output[].tool_calls[].id (both under one assistant_turn)
selection.recording_span_id / recording_id -> call span_id / audio.recordings[].id
```

**Scenario excerpt, cascaded** (user turn, `find_slots` link, interrupted agent utterance and barge-in; each selection also has `"recording_span_id": "call"`):

<!-- prettier-ignore -->
```jsonc
[
  { "span_id": "s1", "span_parents": ["u1"], "metrics": { "start": 1791830000.3, "end": 1791830002.9 },
    "output": { "text": "Hi, can I move my Thursday cleaning to Friday morning?" },
    "metadata": {
      "voice.speech": { "speaker": "user", "turn_id": "u1", "state": "complete", "timing_source": "vad",
        "heard_by": ["l1"], "end_of_turn_ms": 3400,
        "transcript": { "source": "stt", "final": true, "available_ms": 3450, "confidence": 0.94 } },
      "audio.selections": [{ "recording_id": "call-0000", "start_offset_ms": 300, "end_offset_ms": 700, "channel_index": 0 },
                           { "recording_id": "call-0000", "start_offset_ms": 1000, "end_offset_ms": 2900, "channel_index": 0 }] } },
  { "span_id": "l1", "span_parents": ["a1"], "span_attributes": { "name": "llm_response", "type": "llm" },
    "output": [{ "role": "assistant", "tool_calls": [{ "id": "call_1", "function": { "name": "find_slots" } }] }] },
  { "span_id": "t1", "span_parents": ["a1"], "span_attributes": { "name": "find_slots", "type": "tool" },
    "output": ["09:30", "11:00"], "metadata": { "tool_call_id": "call_1" } },
  { "span_id": "s2", "span_parents": ["a1"], "metrics": { "start": 1791830005.3, "end": 1791830007.9 },
    "output": { "text": "I have nine thirty or eleven on Fri",
                "planned_text": "I have nine thirty or eleven on Friday. Which would you like?" },
    "metadata": {
      "voice.speech": { "speaker": "agent", "turn_id": "a1", "state": "interrupted", "timing_source": "playout",
        "produced_by": "l2", "interrupted_by": "s3", "played_ms": 2600, "transcript": { "source": "playback_sync", "final": true } },
      "audio.selections": [{ "recording_id": "call-0000", "start_offset_ms": 5300, "end_offset_ms": 7900, "channel_index": 1 }] } },
  { "span_id": "s3", "span_parents": ["u2"], "metrics": { "start": 1791830007.6, "end": 1791830008.5 },
    "output": { "text": "Nine thirty works." },
    "metadata": {
      "voice.speech": { "speaker": "user", "turn_id": "u2", "state": "complete", "timing_source": "vad", "heard_by": ["l3"],
        "end_of_turn_ms": 8800, "transcript": { "source": "stt", "final": true, "available_ms": 8820, "confidence": 0.97 } },
      "audio.selections": [{ "recording_id": "call-0000", "start_offset_ms": 7600, "end_offset_ms": 8500, "channel_index": 0 }] } }
]
```

**Scenario excerpt, realtime** (same rows; `//` marks what differs from cascaded):

<!-- prettier-ignore -->
```jsonc
[
  { "span_id": "s1", "span_parents": ["u1"], "metrics": { "start": 1791830000.3, "end": 1791830003.4 }, // end includes 500 ms server-VAD silence
    "output": { "text": "Hi, can I move my Thursday cleaning to Friday morning?" },
    "metadata": {
      "voice.speech": { "speaker": "user", "turn_id": "u1", "state": "complete",
        "timing_source": "span_clock",                       // local event receipt, not vad
        "heard_by": ["r1"], "end_of_turn_ms": 3600,          // answering generation start, not onEndOfTurn
        "transcript": { "source": "provider_transcription", "final": true, "available_ms": 4300 } }, // after the 4100 tool call; no confidence
      "audio.selections": [{ "recording_id": "call-0000", "start_offset_ms": 300, "end_offset_ms": 3400, "channel_index": 0 }] } }, // one range: pause not split
  { "span_id": "r1", "span_parents": ["a1"], "span_attributes": { "name": "llm_response", "type": "llm" }, // from realtime_inference
    "output": [{ "role": "assistant", "tool_calls": [{ "id": "call_1", "function": { "name": "find_slots" } }] }] },
  { "span_id": "t1", "span_parents": ["a1"], "span_attributes": { "name": "find_slots", "type": "tool" },
    "output": ["09:30", "11:00"], "metadata": { "tool_call_id": "call_1" } },
  { "span_id": "s2", "span_parents": ["a1"], "metrics": { "start": 1791830005.0, "end": 1791830007.9 }, // first audio 5000, not 5300
    "output": { "text": "I have nine thirty or eleven on Fri",
                "planned_text": "I have nine thirty or eleven on Friday. Which would you like?" }, // response transcript, not TTS input
    "metadata": {
      "voice.speech": { "speaker": "agent", "turn_id": "a1", "state": "interrupted", "timing_source": "playout",
        "produced_by": "r2", "interrupted_by": "s3", "played_ms": 2900,
        "provider_played_ms": 2900,                          // realtime only; equals played_ms in LiveKit
        "transcript": { "source": "playback_sync", "final": true } },
      "audio.selections": [{ "recording_id": "call-0000", "start_offset_ms": 5000, "end_offset_ms": 7900, "channel_index": 1 }] } },
  { "span_id": "s3", "span_parents": ["u2"], "metrics": { "start": 1791830007.6, "end": 1791830009.0 }, // ends at generation start
    // no "output": the provider never transcribed the barge-in
    "metadata": {
      "voice.speech": { "speaker": "user", "turn_id": "u2", "state": "complete", "timing_source": "span_clock",
        "heard_by": ["r3"], "end_of_turn_ms": 9000 },        // no "transcript"; answered, so not ignored
      "audio.selections": [{ "recording_id": "call-0000", "start_offset_ms": 7600, "end_offset_ms": 9000, "channel_index": 0 }] } }
]
```

**Cascaded vs realtime: what changes in the payload**

| Field                                    | Cascaded                                                        | Realtime (LiveKit)                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| User `timing_source` and selections      | `vad`; one selection per VAD fragment                           | `span_clock`; one range from local event receipt, silence padding included                                    |
| User `end_of_turn_ms`                    | `onEndOfTurn` resolving true (3400)                             | Entry of the answering generation (3600)                                                                      |
| User `transcript`                        | `stt` with `confidence`, available before the LLM starts (3450) | `provider_transcription`, may arrive after the tool call (4300) or never (`s3`: no `transcript`, no `output`) |
| Targets of `heard_by` / `produced_by`    | `llm_response` rows from `llm_node`, beside `stt`/`tts` spans   | `llm_response` rows from `realtime_inference`; no STT or TTS spans                                            |
| Agent `played_ms` / `provider_played_ms` | 2600 / absent                                                   | 2900 / 2900 (truncate sent from the same playback position)                                                   |
| Agent `planned_text`                     | TTS input                                                       | Response transcript                                                                                           |

Full rows: [`examples/cascaded.json`](examples/cascaded.json) and [`examples/realtime.json`](examples/realtime.json).

Implemented: zod types (`js/src/instrumentation/livekit/voice-schema/speech-spans.ts`), examples, test. Sketch: LiveKit/Pipecat emission. Lingua mapping: implemented in the companion Lingua PR (branch `kevchoi/voice-schema-speech-spans`; link TBD).

## Contract

_Implemented: zod schema, examples and test. Emission is a sketch._ All `voice.*`, `audio.*` and `turn.*` keys live under `metadata`.

### Call span

This is the root span: LiveKit `livekit.agent_session`, Pipecat `pipecat.pipeline`. Lingua finds the call through `voice.call`, so a call without audio still has speech.

| Field                          | Type                                         | Required               | Meaning                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `input.audio[<recording id>]`  | attachment                                   | When audio is captured | Unchanged (`@braintrust/audio`).                                                                                                                                                                       |
| `metadata["audio.recordings"]` | descriptor[]                                 | When audio is captured | Unchanged. One descriptor per segment; `timeline.recording_start_offset_ms` is the segment start in call ms. Channel 0 is the caller, channel 1 the agent.                                             |
| `voice.call.framework`         | `"livekit" \| "pipecat"`                     | Yes                    | The integration that emitted the call.                                                                                                                                                                 |
| `voice.call.pipeline`          | `"cascaded" \| "realtime" \| "half_cascade"` | Yes                    | Tells readers which speech evidence to expect. `half_cascade` is a realtime model with text output plus separate TTS: user speech follows the realtime column below, agent speech the cascaded column. |
| `voice.call.origin_unix_ms`    | Unix ms                                      | Yes                    | The clock for every call-ms field. Logged at session start, whether or not audio is captured.                                                                                                          |

### Turn spans

`user_turn` and `assistant_turn` task spans are unchanged:

- `turn.id` is the turn span's own `span_id`.
- On an assistant turn, `turn.reply_to` is the `span_id` of the user turn it answers.

Both integrations emit these names; Pipecat's turn spans already use them on `delner/pipecat-voice-recording`. In this option turns group speech and steps; they don't carry speech semantics themselves.

### LLM and tool spans

These are unchanged and are parented to the `assistant_turn`:

- `llm_response` (`type: "llm"`) spans are the targets of `heard_by` and `produced_by`. In LiveKit they are the rows exported from native `llm_node` (cascaded) or `realtime_inference` (realtime).
- A tool span (`type: "tool"`, named after the tool) carries `metadata.tool_call_id`, equal to `tool_calls[].id` in the output of the `llm_response` that requested it. That is the only link Lingua reads between a tool and its LLM step. LiveKit also logs `gen_ai.tool.call.id` (same value) and `contrib.livekit.request_span_id` (the requesting span's id); neither is part of this contract.

Speech never links to a tool span directly.

### Speech span

Each utterance gets one span with `span_attributes: {type: "task", name: "speech"}`. The name stays fixed; Lingua recognizes the span by `voice.speech`, not by name.

**Utterance grain:**

| Speaker                                                    | One speech span per…                                                                                                | How fragments are kept                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User                                                       | Turn: everything the user said that the turn detector grouped into one user turn                                    | Each VAD fragment becomes one `audio.selections` range on that span.                                                                                                                                                                          |
| User, not part of a turn (backchannel, false interruption) | Ignored utterance                                                                                                   | One span with `state: "ignored"`.                                                                                                                                                                                                             |
| Agent                                                      | Playout of one speech handle: LiveKit `SpeechHandle`, Pipecat `BotStartedSpeakingFrame` → `BotStoppedSpeakingFrame` | Pause and resume after a false interruption stays one span, with one selection per played stretch. Speech with no assistant turn (a greeting from `session.say` or a Pipecat `TTSSpeakFrame`) is parented to the call span without `turn_id`. |

The grain matters because a cascaded call can produce several speaking fragments per user turn. Integrations must not emit one span per fragment.

An interrupted speech handle that played no audio produces no speech span; its text remains on the LLM span. So `played_ms` is always positive when present.

**Fields:**

| Field                                  | Type                                                                                    | Required                                  | Meaning                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `span_parents`                         | `[span id]`                                                                             | Yes                                       | The owning turn span, or the call span for ignored speech and agent speech with no turn.                                                                                                                                                                                                                                                                                      |
| `metrics.start` / `metrics.end`        | Unix s                                                                                  | Yes                                       | The utterance bounds. With selections: first selection start to last selection end, converted to call ms (see [Timing semantics](#timing-semantics)).                                                                                                                                                                                                                         |
| `metadata["audio.selections"]`         | Selection[]                                                                             | When audio is captured for that utterance | Unchanged shape; at least one range when present. One channel: 0 for user speech, 1 for agent speech. One range per fragment or played stretch, in order; the recorder splits a range that crosses a segment boundary. Offsets are ms from the start of the segment named by `recording_id`.                                                                                  |
| `voice.speech.speaker`                 | `"user" \| "agent"`                                                                     | Yes                                       | Who spoke.                                                                                                                                                                                                                                                                                                                                                                    |
| `voice.speech.turn_id`                 | span id                                                                                 | When the parent is a turn                 | The owning turn span, equal to `span_parents[0]`. Omitted when the parent is the call span.                                                                                                                                                                                                                                                                                   |
| `voice.speech.state`                   | `"complete" \| "interrupted" \| "incomplete" \| "ignored"`                              | Yes                                       | `interrupted` means agent playout was cut short after some audio played. `incomplete` means the call or process ended mid-utterance. `ignored` means user speech the agent heard but did not answer.                                                                                                                                                                          |
| `voice.speech.timing_source`           | See [Timing semantics](#timing-semantics)                                               | Yes                                       | The evidence behind `metrics.start`/`metrics.end`.                                                                                                                                                                                                                                                                                                                            |
| `voice.speech.heard_by`                | span id[]                                                                               | User only, optional                       | The `llm_response` spans whose input first contained this utterance.                                                                                                                                                                                                                                                                                                          |
| `voice.speech.produced_by`             | span id                                                                                 | Agent only, optional                      | The `llm_response` span that generated the spoken text.                                                                                                                                                                                                                                                                                                                       |
| `voice.speech.interrupted_by`          | span id                                                                                 | Agent only, optional                      | The user speech span that cut this one off. Requires `state: "interrupted"`.                                                                                                                                                                                                                                                                                                  |
| `voice.speech.played_ms`               | duration ms, > 0                                                                        | Agent only, optional                      | Audio actually played locally: bytes written to the output transport divided by its byte rate, or the framework's playback position.                                                                                                                                                                                                                                          |
| `voice.speech.provider_played_ms`      | duration ms                                                                             | Agent realtime only, optional             | The truncation sent to the provider (`conversation.item.truncate` `audio_end_ms`, ms from the start of that item's audio), only when the model supports message truncation. LiveKit derives it from the same playback position, so it equals `played_ms` there. Only integrations that observe the provider independently (Pipecat) can show a provider/playout disagreement. |
| `voice.speech.end_of_turn_ms`          | call ms                                                                                 | User only, optional                       | When the agent decided the user had finished.                                                                                                                                                                                                                                                                                                                                 |
| `voice.speech.transcript.source`       | `"stt" \| "provider_transcription" \| "tts_input" \| "model_output" \| "playback_sync"` | With `transcript`                         | Where the text came from. For agent speech, `playback_sync` describes `output.text`, and `tts_input`/`model_output` describe `planned_text` only.                                                                                                                                                                                                                             |
| `voice.speech.transcript.final`        | boolean                                                                                 | With `transcript`                         | `false` when only partial text arrived before the span was written.                                                                                                                                                                                                                                                                                                           |
| `voice.speech.transcript.available_ms` | call ms                                                                                 | No                                        | When the text became available. In realtime this is often after the response started.                                                                                                                                                                                                                                                                                         |
| `voice.speech.transcript.confidence`   | 0–1                                                                                     | No                                        | STT confidence, if the provider reports one.                                                                                                                                                                                                                                                                                                                                  |
| `output.text`                          | string                                                                                  | No                                        | What was actually said. User: the transcript. Agent: the text synchronized with playout (`playback_sync`), never the generated text. Absent without such a transcript or with content capture off.                                                                                                                                                                            |
| `output.planned_text`                  | string                                                                                  | No                                        | Agent only: the text the agent generated for this playout: the TTS input (cascaded) or the response transcript (realtime).                                                                                                                                                                                                                                                    |

**Absence rules:**

- An omitted field means "not observed". Integrations never write `null` or placeholder text.
- With no transcript, both `transcript` and `output.text` are absent.
- **Agent spoken text:**
  - Spoken text comes only from playout-synchronized text: LiveKit `playbackFinished.synchronizedTranscript` (content mode), or Pipecat text frames observed while the bot is speaking, cut at the `InterruptionFrame`.
  - This holds in both cascaded and realtime pipelines. Realtime response transcripts hold the full planned text, and an OpenAI `conversation.item.truncate` deletes the server-side transcript, so neither can stand in for what was spoken.
  - Without synchronized text, `output.text` is absent, `planned_text` is kept, and `transcript.source` is `tts_input` (cascaded) or `model_output` (realtime). That source describes `planned_text` only.
- When content capture is off, `output` is absent but `transcript.source` stays, so readers know a transcript existed.

### Creating and updating speech spans

_Sketch: emission rule for integrations._

- **Creation:** integrations buffer an utterance and create its span when it ends. They pass explicit start and end times and the parent turn (or the call span for ignored speech and agent speech with no turn). This avoids open spans for speech that turns out to be ignored or to merge into a turn.
- **Late links:** `heard_by` and `interrupted_by` may be known only after the end.
  - Recommended: delay the end write until the first LLM span of the reply starts, up to a timeout (for example 2 s). Then most utterances need a single write.
  - Otherwise: write again later.
- **Every write carries the complete current `voice.speech` object.** Braintrust merges metadata objects but replaces arrays, so a partial write would drop earlier links.

## IDs and relationships

_Implemented in the examples and checked by the test._

```text
call span (voice.call) ──audio.recordings──► recording segments
 ├─ user_turn (turn.id = own span_id)
 │   └─ speech {speaker:user, turn_id, heard_by:[llm span ids]} ──audio.selections (1+ fragments)──► channel 0
 ├─ assistant_turn (turn.reply_to = user_turn)
 │   ├─ llm_response ◄──produced_by── speech {speaker:agent, interrupted_by:user speech}
 │   ├─ <tool span> (tool_call_id = llm_response tool_calls[].id)
 │   └─ speech ──audio.selections──► channel 1
 └─ speech {speaker:user, state:ignored}          (no turn_id)
```

- All links are Braintrust `span_id`s in the same trace; Lingua maps them to row ids. The only non-span-id link is `tool_call_id`, which matches the provider's tool call id.
- Framework ids (LiveKit `speech_id`, Pipecat TTS `context_id`) are only used inside the integration to find those spans.

## Timing semantics

_Implemented in the zod schema and examples; capture rules are a sketch._

- **Call ms** are milliseconds since `voice.call.origin_unix_ms`. When audio is captured, `origin_unix_ms` equals each recording's `timeline.origin_unix_ms`, so call ms are also recording-timeline ms.
- **Selection offsets** are ms from the start of the segment named by `recording_id`. Call ms = that segment's `timeline.recording_start_offset_ms` + offset. In the examples there is one segment starting at 0, so the two coincide.
- **Span times:** a span's `metrics.start` and `metrics.end` are Unix seconds on the same clock: `(origin_unix_ms + call_ms) / 1000`.
- **Durations:** `played_ms` and `provider_played_ms` are lengths of agent audio, not points on the call clock.

**`timing_source` values:**

| Value           | Meaning                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audio_samples` | Bounds measured on captured audio samples. Requires `audio.selections`.                                                                                                                 |
| `vad`           | Local VAD or turn-detector events (LiveKit `user_speaking`, Pipecat `UserStarted/StoppedSpeakingFrame`).                                                                                |
| `provider_vad`  | Realtime provider speech events with provider ms, converted to call ms (below). Only integrations that see raw provider events (Pipecat) have them; LiveKit realtime uses `span_clock`. |
| `playout`       | Local output-transport playout: LiveKit playback events, Pipecat output audio write timestamps.                                                                                         |
| `span_clock`    | Local span times that could not be aligned to any of the above, including provider offsets with an unknown input-buffer start.                                                          |

When audio is not captured, `audio.selections` is absent and `timing_source` must not be `audio_samples`. Selections never extend outside the span bounds.

**Converting realtime provider offsets to call ms.** This applies to integrations that see raw provider events (Pipecat with OpenAI Realtime); LiveKit 1.9 does not expose provider ms. Providers report `audio_start_ms`/`audio_end_ms` relative to the start of the audio the integration streamed to them.

- call ms = `input_start_call_ms` + provider ms, where `input_start_call_ms` is the call ms at which the integration began appending input audio, on the recording clock.
- If that start is unknown (for example after a reconnect), use local span times and `timing_source: span_clock`.

## What integrations capture, and when

_Sketch: no integration emits speech spans yet._ LiveKit references are to `@livekit/agents` 1.9.2 `src/voice/`; `agent_activity.ts` is abbreviated `AA`.

| Value                               | LiveKit cascaded (JS)                                                                                                                                                                                                                                                                                                                                                                                | LiveKit realtime (JS)                                                                                                                                                                                                                                                                                                                                                                                 | Pipecat cascaded (Python)                                                                                                          | Pipecat realtime (Python)                                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook                                | `LiveKitSpanProcessor` (`processor.ts`), plus an `AudioOutput` playback hook (`io.ts:209` `onPlaybackStarted`, `io.ts:227` `onPlaybackFinished`) installed whether or not audio is captured                                                                                                                                                                                                          | Same, plus the realtime session events below                                                                                                                                                                                                                                                                                                                                                          | A `BaseObserver` added to the `PipelineTask`                                                                                       | Same; the observer also sees the service's raw provider events                                                                                                       |
| Step spans that links target        | `llm_response` rows exported from native `llm_node`; links carry their Braintrust span ids                                                                                                                                                                                                                                                                                                           | `llm_response` rows exported from native `realtime_inference`                                                                                                                                                                                                                                                                                                                                         | `llm_response`                                                                                                                     | `llm_response`                                                                                                                                                       |
| User fragments (`audio.selections`) | Each native `user_speaking` span, clipped to captured input samples; `timing_source: vad`                                                                                                                                                                                                                                                                                                            | `input_speech_started`/`input_speech_stopped` (`AA:895-896`, handlers `AA:1967`, `AA:2000`), which carry no provider ms (`InputSpeechStoppedEvent = {userTranscriptionEnabled}`, `llm/realtime.ts:16`). Bounds are local receipt times, `timing_source: span_clock`; the end includes the server-VAD silence padding unless the integration is configured with that silence duration and subtracts it | `UserStartedSpeakingFrame` → `UserStoppedSpeakingFrame` (or VAD frames); `timing_source: vad`                                      | Provider `speech_started`/`speech_stopped` `audio_start_ms`/`audio_end_ms`, converted to call ms; `timing_source: provider_vad`                                      |
| User span created                   | When the `user_turn` closes: first fragment start to last fragment end                                                                                                                                                                                                                                                                                                                               | When the SDK-built `user_turn` closes, at the end of turn below                                                                                                                                                                                                                                                                                                                                       | When the turn analyzer ends the user turn                                                                                          | Same                                                                                                                                                                 |
| `end_of_turn_ms`                    | `AA:2690` `onEndOfTurn(EndOfTurnInfo)` resolving true (`audio_recognition.ts:77`)                                                                                                                                                                                                                                                                                                                    | Entry of an answering generation: a `_realtimeGenerationTaskImpl` entry for a generation created by `onGenerationCreated` (`AA:2058-2089`) that is neither user-initiated (`generateReply`) nor a tool-call continuation (`autoToolReplyTurn`). With server turn detection there is no commit event: `userTurnCompleted` (`AA:3275`) returns early                                                    | Turn analyzer stop                                                                                                                 | Provider input-buffer commit                                                                                                                                         |
| Ignored user speech                 | A `user_speaking` interval with no committed user item after end of turn, or a false interruption (`agent_false_interruption`, `AA:5917`); written once LiveKit resumes or drops the turn                                                                                                                                                                                                            | Caller speech after which no answering generation started (as defined in the `end_of_turn_ms` row) before the next caller speech start or call end; written at that point. An answered barge-in with no transcript is not ignored                                                                                                                                                                     | `UserStoppedSpeakingFrame` with no user aggregation pushed to the LLM; written when the next user turn starts or the pipeline ends | Same as Pipecat cascaded                                                                                                                                             |
| User transcript                     | `user_turn` transcript; `available_ms` = last fragment end + `transcriptionDelay` (`audio_recognition.ts:144`)                                                                                                                                                                                                                                                                                       | Final input transcription → `provider_transcription`; it may never arrive                                                                                                                                                                                                                                                                                                                             | `TranscriptionFrame` (`finalized`)                                                                                                 | The service's input transcription frames                                                                                                                             |
| `heard_by`                          | The `llm_response` started under the `assistant_turn` whose `turn.reply_to` is this turn                                                                                                                                                                                                                                                                                                             | The `llm_response` started in the `_realtimeGenerationTaskImpl` that ended the turn                                                                                                                                                                                                                                                                                                                   | The `llm_response` opened by the next `LLMContextFrame` containing the transcript                                                  | The response span after the commit                                                                                                                                   |
| Agent playout (`audio.selections`)  | `playbackStarted`/`playbackFinished` (`io.ts:209`, `io.ts:227`). Playback events carry no speech id, so the playout is attributed to `activity.currentSpeech` (`AA:1168`) at the first `captureFrame` (`io.ts:164`)/`playbackStarted`                                                                                                                                                                | Same                                                                                                                                                                                                                                                                                                                                                                                                  | Output-transport audio-write timestamps between `BotStartedSpeakingFrame` and `BotStoppedSpeakingFrame`                            | Same                                                                                                                                                                 |
| `produced_by`                       | The latest `llm_node` row under the playout owner's `currentSpeech._agentTurnSpan` that started before `playbackStarted`; the SDK already looks up that owner when playout starts (`playback.ts:241`). `speechHandleStorage` (`agent.ts:70`) is not exported, so it can't be read directly. Not `lk.speech_id`: that is the turn-level `_turnSpeechId` (`AA:4516`), shared across tool continuations | The latest `realtime_inference` row under the same owner that started before `playbackStarted`                                                                                                                                                                                                                                                                                                        | The `llm_response` whose TTS `context_id` matches                                                                                  | The response that emitted the audio                                                                                                                                  |
| `state`, `played_ms`                | `PlaybackFinishedEvent.interrupted`; `played_ms` = `playbackPosition` (seconds, `io.ts:294`) × 1000                                                                                                                                                                                                                                                                                                  | Same                                                                                                                                                                                                                                                                                                                                                                                                  | `InterruptionFrame` while speaking; bytes written to the output transport                                                          | Same                                                                                                                                                                 |
| `provider_played_ms`                | —                                                                                                                                                                                                                                                                                                                                                                                                    | Only when `output.played === "partial"` and the model supports `capabilities.messageTruncation` (`AA:4786-4789`): `Math.floor(playbackPositionInS * 1000)`, the `audioEndMs` sent with `realtimeSession.truncate` (`AA:4797`). Computed from the same playback position, so it equals `played_ms` up to flooring                                                                                      | —                                                                                                                                  | The truncation the service sent, observed independently of playout; may differ from `played_ms`                                                                      |
| `interrupted_by`                    | The user speech whose fragment was active when playout stopped                                                                                                                                                                                                                                                                                                                                       | Same                                                                                                                                                                                                                                                                                                                                                                                                  | Same                                                                                                                               | Same                                                                                                                                                                 |
| Agent text                          | `synchronizedTranscript` (`io.ts:301`, set at `AA:4128`/`AA:4146`) → `output.text` (`playback_sync`); `tts` input → `planned_text`                                                                                                                                                                                                                                                                   | `synchronizedTranscript` (`AA:4729`/`AA:4740`) → `output.text` (`playback_sync`); response transcript → `planned_text`                                                                                                                                                                                                                                                                                | `TTSTextFrame`s written while speaking, cut at `InterruptionFrame` → `output.text` (`playback_sync`); TTS input → `planned_text`   | The service's text frames that reach the output transport while the bot is speaking, cut at `InterruptionFrame` → `output.text`; full response text → `planned_text` |
| Agent speech without a turn         | `session.say` greeting (`agent_session.ts:1231`): parent is the call span, no `turn_id`, no `produced_by`                                                                                                                                                                                                                                                                                            | Same                                                                                                                                                                                                                                                                                                                                                                                                  | `TTSSpeakFrame`: same                                                                                                              | Same                                                                                                                                                                 |

## What Lingua records versus infers

_Implemented in the companion Lingua PR._

**Recorded as logged:**

- the speaker, state, timing source and transcript source;
- `interrupted_by`;
- `end_of_turn_time` (`voice.call.origin_unix_ms` + `end_of_turn_ms`);
- `start_time` and `end_time` (the span bounds);
- the selections;
- `step_ids`, taken from `produced_by` for agent speech and `heard_by` for user speech.

**Inferred:**

- `Speech.interrupted` (true when `state` is `interrupted`, false for other agent speech);
- the call each speech belongs to (the nearest ancestor with `voice.call` or recordings; the parent may be a turn or the call);
- speech order (by audio start, else span start), and overlap from the selections;
- `step_ids` falling back to the turn span and its step children when no link was logged.

**Not read:** `played_ms`, `provider_played_ms`, `transcript.final`, `transcript.available_ms`, `confidence`, `voice.call.framework` and `voice.call.pipeline` stay on the spans.

Latency is not stored. The app computes it from `end_of_turn_time`, step times and the next agent speech start.

**Rollout precedence:**

- `voice.speech` replaces the LiveKit name rules per trace and speaker. If a trace has any user speech span, LiveKit `user_turn` speech is skipped for that trace, and the same holds for agents.
- So an integration can move one speaker at a time.
- Traces with no `voice.speech` keep #486's behaviour unchanged.

## Trajectory and app mapping

_Trajectory types are implemented in the companion Lingua PR; app changes are a sketch._

`Trajectory.voice_calls[].speech[]` gains seven optional fields:

- `state`
- `interrupted_by`
- `transcript_source`
- `timing_source`
- `end_of_turn_time`
- `start_time`
- `end_time`

A `VoiceCall` may have no recordings when audio capture was off.

The existing fields keep their meaning, so #22034 and #22036 work unchanged when there is audio:

- **Voice bar:** windows come from `selections`.
- **Thread view:** clicking a window or "Play from this message" resolves `step_ids` to a turn's `request_id`, `work[].id` or `response_id`.

Without audio, the voice bar has nothing to play. A timeline would use `start_time`/`end_time`.

The new fields allow:

- an "interrupted by …" marker;
- a "no transcript" badge when `transcript_source` is absent;
- a "timing estimated" badge for `span_clock`;
- an end-of-turn → first-audio latency bar.

## Worked example (cascaded vs realtime)

_Implemented: both files parse with the zod schema in the test._ `examples/cascaded.json` and `examples/realtime.json` encode the same fictional call: a booking change with `find_slots`, then a barge-in, then `reschedule`, with a backchannel near the end. Times are call ms.

|                                 | Cascaded                                                                                                                                                                           | Realtime                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steps under `assistant_turn` 1  | `l1` llm (tool call) → `find_slots` → `l2` llm → `tts`                                                                                                                             | `r1` realtime response (tool call) → `find_slots` → `r2` response with audio                                                                                                                                                                                                                                                                                         |
| User speech `s1`                | Two fragments (300–700 "Hi,", 1000–2900); `timing_source: vad`; `end_of_turn_ms: 3400` (`onEndOfTurn`); `transcript {stt, available_ms: 3450, confidence: 0.94}`; `heard_by: [l1]` | 300–3400: local receipt of `input_speech_started`/`stopped`, so the 300 ms pause isn't split and the end includes 500 ms of server-VAD silence; `timing_source: span_clock`; `end_of_turn_ms: 3600` (entry of `_realtimeGenerationTaskImpl`); `transcript {provider_transcription, available_ms: 4300}`, which arrived after the tool call at 4100; `heard_by: [r1]` |
| Agent speech `s2`               | 5300–7900; `played_ms: 2600`; `produced_by: l2`; `output.text` is the synchronized spoken text, `planned_text` the TTS input                                                       | 5000–7900; `played_ms: 2900` and `provider_played_ms: 2900` (truncate sent at 7900 from the same playback position); `output.text` is the synchronized spoken text, `planned_text` the full response transcript, which the `r2` response span also logs                                                                                                              |
| Barge-in `s3`                   | 7600–8500, `stt` transcript "Nine thirty works."                                                                                                                                   | 7600–9000 (silence padding included), `span_clock`; no transcript, so `transcript` and `output` are absent. It is not ignored, because `r3` answered it at 9000                                                                                                                                                                                                      |
| Backchannel `s5`                | 10600–10900 during `s4`: `state: ignored`, parent is the call span, transcript "Mm-hm."                                                                                            | 12650–12950, after `s4` (speaking over a realtime agent would interrupt it): no generation started before the call ended, so `state: ignored`, no transcript                                                                                                                                                                                                         |
| End of turn → first agent audio | 3400 → 5300 (1.9 s), split across STT, LLM, tool and TTS spans                                                                                                                     | 3600 → 5000 (1.4 s), with no STT or TTS spans to split it; the 500 ms server-VAD wait before 3600 is invisible                                                                                                                                                                                                                                                       |

The companion PR checks Lingua's output for both files, plus a cascaded copy with no audio, in its fixtures.

The realtime fixture shows one weakness. Because user turn 2 has no transcript, Lingua's turn builder merges both exchanges into one Trajectory turn. `voice_calls` is still correct, but the thread view shows one long turn.

## Customer usefulness

| Question                      | How well this option answers it                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What was said                 | Good. One span per utterance, with text and its provenance. Planned and spoken agent text are kept apart.                                                     |
| Play matching audio           | Good. Each speech span has exact selections, one per fragment.                                                                                                |
| Diagnose delays               | Partial. End of turn and audio start are explicit, but the pipeline breakdown still comes from LLM, TTS and STT spans, and realtime has no breakdown.         |
| Interruptions and overlap     | Good. `state`, `interrupted_by`, `played_ms` and `provider_played_ms` are explicit; overlap shows in the selections; backchannels are kept as ignored speech. |
| Follow tools                  | Indirect. Speech links to LLM steps, and tools sit beside them in the turn. Nothing says that a tool ran while the user was waiting in silence.               |
| Missing or uncertain evidence | Good per utterance: `timing_source`, transcript `final`/`source`, and absent fields. There is no call-level summary of gaps.                                  |

## Edge cases and weaknesses

- **Barge-in truncation.** Covered by `played_ms` and `planned_text`. The thread still shows the LLM's full planned answer as the turn response, because Lingua's `response_text` comes from the LLM span.
- **Interrupted before any audio.** No speech span is written. The voice view then cannot show that the agent tried to speak; only the LLM span shows it.
- **Overlap.** Two speech spans overlap in time; the app already prefers the later-starting window (#22036).
- **Pipecat realtime spoken text.** `playback_sync` counts text frames that reach the output transport. When the service sends text deltas ahead of the audio, an interrupted utterance can overstate what the user heard.
- **Late or missing realtime transcripts.** Covered by the full-object rewrite above, or the transcript stays absent.
  - A missing transcript splits turns badly (above).
  - A fix would let user speech with `heard_by` start a new turn without text. That is sketched, not implemented.
- **Failed or omitted segments.** Selections only point at ready segments. The speech keeps its span bounds (`start_time`/`end_time`) but has no playable audio.
- **Audio capture off.** The call still exists through `voice.call`, and speech has bounds but no selections. Pipecat and LiveKit must still log `voice.call.origin_unix_ms`.
- **Unknown clock offset.** If the recording started late or the origin is wrong, every speech span is wrong by the same amount, and nothing in this option detects it. `timing_source: span_clock` marks only spans that were never aligned.
- **Call in progress.** Speech whose call row isn't logged yet is skipped (#486 behaviour). `incomplete` is set only at shutdown.
- **Content capture off.** Text disappears but every link and timing field stays.
- **Tool cancelled by interruption.** The tool span has the error. The speech has no direct link to it; readers infer it from the turn.
- **Agent handoff.** Speech stays under the turn of the agent that spoke. `voice.call` has no field for the active agent; it would have to come from turn or agent metadata. `voice.call.pipeline` is the pipeline at call start; a handoff that changes the LLM type (for example cascaded to realtime) is out of MVP scope.
- **Provider truncation versus playout.** For LiveKit, `provider_played_ms` is computed from the playback position, so it cannot reveal that the provider believes more or less audio played. Only Pipecat, which observes the provider events itself, can show that disagreement.
- **Strict enums.** Lingua rejects unknown `state`, `timing_source` and `transcript.source` values (the whole `voice.speech` key fails). New values need a Lingua release first.

## Implementation starting point

_Sketch, except step 4._

1. **LiveKit (`js/src/instrumentation/livekit/processor.ts`):**
   - Log `voice.call` (including `origin_unix_ms`) on `agent_session` start, even with audio off.
   - Stop exporting `livekit.user_speaking`/`livekit.agent_speaking` as rows. Instead collect their intervals per turn (`speakingByTurn`) and per `SpeechHandle`.
   - Install the `AudioOutput` playback hook even when audio capture is off, and attribute each playout to `activity.currentSpeech` at its first frame.
   - Set `produced_by` to the latest `llm_node`/`realtime_inference` row under the playout owner's `currentSpeech._agentTurnSpan` that started before `playbackStarted`; `playback.ts` already resolves that owner.
   - When the user turn closes or playout finishes, create one `speech` span with explicit times, merged selections and `voice.speech`.
   - Add `heard_by` by waiting for the first `llm_response` (native `llm_node`/`realtime_inference`) under the replying turn.
2. **Realtime (`realtime.ts`):** build the user speech span from the SDK-built turn's `input_speech_started`/`stopped` receipt times (`span_clock`). Close the turn and set `end_of_turn_ms` at the entry of an answering generation (not a tool continuation or `generateReply`). Mark caller speech `ignored` when no answering generation starts before the next caller speech or call end.
3. **Pipecat (`sdk-python/py/src/braintrust/integrations/pipecat` on `delner/pipecat-voice-recording`):**
   - Add a `BaseObserver` to the `PipelineTask`.
   - Keep `user_turn`/`assistant_turn` names.
   - Timestamp output-transport audio writes for agent playout and `played_ms`.
   - Emit `speech` spans and the links as Braintrust span ids.
4. **Lingua:** done in the companion PR. Then add `voice.speech` and `voice.call` to `TRAJECTORY_METADATA_FIELDS` after #486 is rebased onto main.

## Open questions

- Should `ignored` speech create a Trajectory turn, or only appear in `voice_calls`?
- Is the timeout for delaying the end write (2 s here) right for slow LLM starts, given the second write it otherwise costs?
- Should an interrupted speech handle that played nothing leave a zero-length marker so the voice view can show the attempt?
