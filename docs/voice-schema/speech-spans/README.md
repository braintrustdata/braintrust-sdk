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

## Contract

### Clock

- **Call ms** are milliseconds since `voice.call.origin_unix_ms`.
- **Recording alignment:** when audio is captured, `origin_unix_ms` equals the recording's `timeline.origin_unix_ms`, so call ms are also recording-timeline ms.
- **Span times:** a span's `metrics.start` and `metrics.end` are Unix seconds on the same clock: `(origin_unix_ms + call_ms) / 1000`.

### Call span

This is the root span: LiveKit `livekit.agent_session`, Pipecat `pipecat.pipeline`. Lingua finds the call through `voice.call`, so a call without audio still has speech.

| Field                          | Type                                         | Required               | Meaning                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `input.audio[<recording id>]`  | attachment                                   | When audio is captured | Unchanged (`@braintrust/audio`).                                                                                                                                                                       |
| `metadata["audio.recordings"]` | descriptor[]                                 | When audio is captured | Unchanged. Channel 0 is the caller, channel 1 the agent.                                                                                                                                               |
| `voice.call.framework`         | `"livekit" \| "pipecat"`                     | Yes                    | The integration that emitted the call.                                                                                                                                                                 |
| `voice.call.pipeline`          | `"cascaded" \| "realtime" \| "half_cascade"` | Yes                    | Tells readers which speech evidence to expect. `half_cascade` is a realtime model with text output plus separate TTS: user speech follows the realtime column below, agent speech the cascaded column. |
| `voice.call.origin_unix_ms`    | Unix ms                                      | Yes                    | The clock for every call-ms field. Logged at session start, whether or not audio is captured.                                                                                                          |

### Turn spans

`user_turn` and `assistant_turn` task spans are unchanged:

- `turn.id` is the turn span's own `span_id`.
- On an assistant turn, `turn.reply_to` is the user turn it answers.

Both integrations emit these names; Pipecat's turn spans already use them on `delner/pipecat-voice-recording`. In this option turns group speech and steps; they don't carry speech semantics themselves.

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

| Field                                  | Type                                                                                    | Required                                  | Meaning                                                                                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `span_parents`                         | `[span id]`                                                                             | Yes                                       | The owning turn span, or the call span for ignored speech and agent speech with no turn.                                                                                                             |
| `metrics.start` / `metrics.end`        | Unix s                                                                                  | Yes                                       | The utterance bounds. With selections: first selection start to last selection end.                                                                                                                  |
| `metadata["audio.selections"]`         | Selection[]                                                                             | When audio is captured for that utterance | Unchanged shape. One channel: 0 for user speech, 1 for agent speech. One range per fragment or played stretch, in order.                                                                             |
| `voice.speech.speaker`                 | `"user" \| "agent"`                                                                     | Yes                                       | Who spoke.                                                                                                                                                                                           |
| `voice.speech.turn_id`                 | span id                                                                                 | When the parent is a turn                 | The owning turn span. Omitted when the parent is the call span.                                                                                                                                      |
| `voice.speech.state`                   | `"complete" \| "interrupted" \| "incomplete" \| "ignored"`                              | Yes                                       | `interrupted` means agent playout was cut short after some audio played. `incomplete` means the call or process ended mid-utterance. `ignored` means user speech the agent heard but did not answer. |
| `voice.speech.timing_source`           | See below                                                                               | Yes                                       | The evidence behind `metrics.start`/`metrics.end`.                                                                                                                                                   |
| `voice.speech.heard_by`                | span id[]                                                                               | User only, optional                       | The LLM spans whose input first contained this utterance.                                                                                                                                            |
| `voice.speech.produced_by`             | span id                                                                                 | Agent only, optional                      | The LLM span that generated the spoken text.                                                                                                                                                         |
| `voice.speech.interrupted_by`          | span id                                                                                 | Agent only, optional                      | The user speech span that cut this one off. Requires `state: "interrupted"`.                                                                                                                         |
| `voice.speech.played_ms`               | ms > 0                                                                                  | Agent only, optional                      | Audio actually played locally: bytes written to the output transport divided by its byte rate, or the framework's playback position.                                                                 |
| `voice.speech.provider_played_ms`      | ms                                                                                      | Agent realtime only, optional             | What the provider was told had played (`conversation.item.truncate` `audio_end_ms`).                                                                                                                 |
| `voice.speech.end_of_turn_ms`          | call ms                                                                                 | User only, optional                       | When the agent decided the user had finished.                                                                                                                                                        |
| `voice.speech.transcript.source`       | `"stt" \| "provider_transcription" \| "tts_input" \| "model_output" \| "playback_sync"` | With `transcript`                         | Where the text came from. For agent speech, `playback_sync` describes `output.text`, and `tts_input`/`model_output` describe `planned_text` only.                                                    |
| `voice.speech.transcript.final`        | boolean                                                                                 | With `transcript`                         | `false` when only partial text arrived before the span was written.                                                                                                                                  |
| `voice.speech.transcript.available_ms` | call ms                                                                                 | No                                        | When the text became available. In realtime this is often after the response started.                                                                                                                |
| `voice.speech.transcript.confidence`   | 0–1                                                                                     | No                                        | STT confidence, if the provider reports one.                                                                                                                                                         |
| `output.text`                          | string                                                                                  | No                                        | What was actually said. User: the transcript. Agent: the text synchronized with playout (`playback_sync`), never the generated text. Absent without such a transcript or with content capture off.   |
| `output.planned_text`                  | string                                                                                  | No                                        | Agent only: the text the agent generated for this playout: the TTS input (cascaded) or the response transcript (realtime).                                                                           |

**`timing_source` values:**

| Value           | Meaning                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `audio_samples` | Bounds measured on captured audio samples. Requires `audio.selections`.                                                        |
| `vad`           | Local VAD or turn-detector events (LiveKit `user_speaking`, Pipecat `UserStarted/StoppedSpeakingFrame`).                       |
| `provider_vad`  | Realtime provider speech events, converted to call ms (below).                                                                 |
| `playout`       | Local output-transport playout: LiveKit playback events, Pipecat output audio write timestamps.                                |
| `span_clock`    | Local span times that could not be aligned to any of the above, including provider offsets with an unknown input-buffer start. |

When audio is not captured, `audio.selections` is absent and `timing_source` must not be `audio_samples`. Selections never extend outside the span bounds.

**Converting realtime provider offsets to call ms.** Providers report `audio_start_ms`/`audio_end_ms` relative to the start of the audio the integration streamed to them. The conversion is:

- call ms = `input_start_call_ms` + provider ms, where `input_start_call_ms` is the call ms at which the integration began appending input audio, on the recording clock.
- If that start is unknown (for example after a reconnect), use local span times and `timing_source: span_clock`.

**Absence rules:**

- An omitted field means "not observed". Integrations never write `null` or placeholder text.
- With no transcript, both `transcript` and `output.text` are absent.
- **Agent spoken text:**
  - Spoken text comes only from playout-synchronized text: LiveKit `playbackFinished.synchronizedTranscript` (content mode), or Pipecat text frames observed while the bot is speaking, cut at the `InterruptionFrame`.
  - This holds in both cascaded and realtime pipelines. Realtime response transcripts hold the full planned text, and an OpenAI `conversation.item.truncate` deletes the server-side transcript, so neither can stand in for what was spoken.
  - Without synchronized text, `output.text` is absent, `planned_text` is kept, and `transcript.source` is `tts_input` (cascaded) or `model_output` (realtime). That source describes `planned_text` only.
- When content capture is off, `output` is absent but `transcript.source` stays, so readers know a transcript existed.

### Creating and updating speech spans

- **Creation:** integrations buffer an utterance and create its span when it ends. They pass explicit start and end times and the parent turn (or the call span for ignored speech and agent speech with no turn). This avoids open spans for speech that turns out to be ignored or to merge into a turn.
- **Late links:** `heard_by` and `interrupted_by` may be known only after the end.
  - Recommended: delay the end write until the first LLM span of the reply starts, up to a timeout (for example 2 s). Then most utterances need a single write.
  - Otherwise: write again later.
- **Every write carries the complete current `voice.speech` object.** Braintrust merges metadata objects but replaces arrays, so a partial write would drop earlier links.

### IDs and relationships

```text
call span (voice.call) ──audio.recordings──► recording segments
 ├─ user_turn (turn.id = own span_id)
 │   └─ speech {speaker:user, turn_id, heard_by:[llm span ids]} ──audio.selections (1+ fragments)──► channel 0
 ├─ assistant_turn (turn.reply_to = user_turn)
 │   ├─ llm_response ◄──produced_by── speech {speaker:agent, interrupted_by:user speech}
 │   ├─ <tool span> (tool_call_id)
 │   └─ speech ──audio.selections──► channel 1
 └─ speech {speaker:user, state:ignored}          (no turn_id)
```

- All links are Braintrust `span_id`s in the same trace; Lingua maps them to row ids.
- Framework ids (LiveKit `speech_id`, Pipecat TTS `context_id`) are only used inside the integration to find those spans.

## What each integration captures and when

| Value                               | LiveKit cascaded (JS)                                                                                                                                                          | LiveKit realtime (JS)                                                                                                       | Pipecat cascaded (Python)                                                                                                          | Pipecat realtime (Python)                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook                                | `LiveKitSpanProcessor` (`processor.ts`) plus playback hooks                                                                                                                    | Same plus `realtime.ts` session events                                                                                      | A `BaseObserver` added to the `PipelineTask`                                                                                       | Same                                                                                                                                          |
| User fragments (`audio.selections`) | Each native `user_speaking` span, clipped to captured input samples                                                                                                            | Realtime `input_speech_started`/`stopped`                                                                                   | `UserStartedSpeakingFrame` → `UserStoppedSpeakingFrame` (or VAD frames)                                                            | Service speech events converted to call ms, else the same frames                                                                              |
| User span created                   | When the `user_turn` closes: first fragment start to last fragment end                                                                                                         | When the SDK-built turn closes                                                                                              | When the turn analyzer ends the user turn                                                                                          | Same                                                                                                                                          |
| Ignored user speech                 | A `user_speaking` interval with no committed user item after end of turn, or a false interruption (`agent_false_interruption`); written once LiveKit resumes or drops the turn | Speech events with no transcript item committed to the conversation; written when the next response starts or the call ends | `UserStoppedSpeakingFrame` with no user aggregation pushed to the LLM; written when the next user turn starts or the pipeline ends | Same                                                                                                                                          |
| `end_of_turn_ms`                    | `AgentActivity.onEndOfTurn` (`EndOfTurnInfo`)                                                                                                                                  | Commit of the input buffer (server VAD)                                                                                     | Turn analyzer stop                                                                                                                 | Server VAD commit                                                                                                                             |
| User transcript                     | `user_turn` transcript; `transcription_delay` → `available_ms`                                                                                                                 | `InputTranscriptionCompleted` → `provider_transcription`                                                                    | `TranscriptionFrame` (`finalized`)                                                                                                 | The service's input transcription frames                                                                                                      |
| `heard_by`                          | The `llm_node` started under the `agent_turn` whose `turn.reply_to` is this turn                                                                                               | The `realtime_inference` started after the commit                                                                           | The `llm_response` opened by the next `LLMContextFrame` containing the transcript                                                  | The response span after the commit                                                                                                            |
| Agent playout (`audio.selections`)  | `playbackStarted`/`playbackProgressed`/`playbackFinished` per `SpeechHandle`                                                                                                   | Same                                                                                                                        | Output-transport audio-write timestamps between `BotStartedSpeakingFrame` and `BotStoppedSpeakingFrame`                            | Same                                                                                                                                          |
| `produced_by`                       | The `llm_node` with the same `speech_id`                                                                                                                                       | The `realtime_inference` with the same `speech_id`/`response_id`                                                            | The `llm_response` whose TTS `context_id` matches                                                                                  | The response that emitted the audio                                                                                                           |
| `state`, `played_ms`                | `playbackFinished.interrupted`, `playbackPosition`                                                                                                                             | Same, plus `provider_played_ms` from the truncate call                                                                      | `InterruptionFrame` while speaking; bytes written to the output transport                                                          | Same, plus the service's truncation                                                                                                           |
| `interrupted_by`                    | The user speech whose fragment was active when playout stopped                                                                                                                 | Same                                                                                                                        | Same                                                                                                                               | Same                                                                                                                                          |
| Agent text                          | `synchronizedTranscript` → `output.text` (`playback_sync`); `tts` input → `planned_text`                                                                                       | `synchronizedTranscript` → `output.text` (`playback_sync`); response transcript → `planned_text`                            | `TTSTextFrame`s written while speaking, cut at `InterruptionFrame` → `output.text` (`playback_sync`); TTS input → `planned_text`   | The service's text frames observed while the bot is speaking, cut at `InterruptionFrame` → `output.text`; full response text → `planned_text` |
| Agent speech without a turn         | `session.say` greeting: parent is the call span, no `turn_id`, no `produced_by`                                                                                                | Same                                                                                                                        | `TTSSpeakFrame`: same                                                                                                              | Same                                                                                                                                          |

## What Lingua records and what it infers

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

Latency is not stored. The app computes it from `end_of_turn_time`, step times and the next agent speech start.

**Rollout precedence:**

- `voice.speech` replaces the LiveKit name rules per trace and speaker. If a trace has any user speech span, LiveKit `user_turn` speech is skipped for that trace, and the same holds for agents.
- So an integration can move one speaker at a time.
- Traces with no `voice.speech` keep #486's behaviour unchanged.

## Trajectory and app mapping

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

## Worked example

`examples/cascaded.json` and `examples/realtime.json` encode the same fictional call: a booking change with `find_slots`, then a barge-in, then `reschedule`, with a backchannel near the end. Times are call ms.

|                                 | Cascaded                                                                                                                                   | Realtime                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steps under `assistant_turn` 1  | `l1` llm (tool call) → `find_slots` → `l2` llm → `tts`                                                                                     | `r1` realtime response (tool call) → `find_slots` → `r2` response with audio                                                                                                                                                                                                                         |
| User speech `s1`                | Two fragments (300–700 "Hi,", 1000–2900); `timing_source: vad`; `transcript {stt, available_ms: 3450, confidence: 0.94}`; `heard_by: [l1]` | Same fragments; `timing_source: provider_vad`; `transcript {provider_transcription, available_ms: 4300}`, which arrived after the tool call at 4100; `heard_by: [r1]`                                                                                                                                |
| Agent speech `s2`               | 5300–7900; `played_ms: 2600`; `produced_by: l2`; `output.text` is the synchronized spoken text, `planned_text` the TTS input               | 5000–7900; `played_ms: 2900` but `provider_played_ms: 2600`, because the local output buffer kept playing for 300 ms after the truncate. `output.text` is the synchronized spoken text (`playback_sync`), and `planned_text` is the full response transcript, which the `r2` response span also logs |
| Barge-in `s3`                   | `stt` transcript "Nine thirty works."                                                                                                      | No transcript: `transcript` and `output` are absent, which the voice view can show as missing                                                                                                                                                                                                        |
| Backchannel `s5` (10600–10900)  | `state: ignored`, parent is the call span, transcript "Mm-hm."                                                                             | `state: ignored`, no transcript                                                                                                                                                                                                                                                                      |
| End of turn → first agent audio | 3400 → 5300 (1.9 s), split across STT, LLM, tool and TTS spans                                                                             | 3400 → 5000 (1.6 s), with no STT or TTS spans to split it                                                                                                                                                                                                                                            |

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
- **Late or missing realtime transcripts.** Covered by the full-object rewrite above, or the transcript stays absent.
  - A missing transcript splits turns badly (above).
  - A fix would let user speech with `heard_by` start a new turn without text. That is sketched, not implemented.
- **Failed or omitted segments.** Selections only point at ready segments. The speech keeps its span bounds (`start_time`/`end_time`) but has no playable audio.
- **Audio capture off.** The call still exists through `voice.call`, and speech has bounds but no selections. Pipecat and LiveKit must still log `voice.call.origin_unix_ms`.
- **Unknown clock offset.** If the recording started late or the origin is wrong, every speech span is wrong by the same amount, and nothing in this option detects it. `timing_source: span_clock` marks only spans that were never aligned.
- **Call in progress.** Speech whose call row isn't logged yet is skipped (#486 behaviour). `incomplete` is set only at shutdown.
- **Content capture off.** Text disappears but every link and timing field stays.
- **Tool cancelled by interruption.** The tool span has the error. The speech has no direct link to it; readers infer it from the turn.
- **Agent handoff.** Speech stays under the turn of the agent that spoke. `voice.call` has no field for the active agent; it would have to come from turn or agent metadata.
- **Strict enums.** Lingua rejects unknown `state`, `timing_source` and `transcript.source` values (the whole `voice.speech` key fails). New values need a Lingua release first.

## Implementation starting point

1. **LiveKit (`js/src/instrumentation/livekit/processor.ts`):**
   - Log `voice.call` (including `origin_unix_ms`) on `agent_session` start, even with audio off.
   - Stop exporting `livekit.user_speaking`/`livekit.agent_speaking` as rows. Instead collect their intervals per turn (`speakingByTurn`) and per `SpeechHandle`.
   - When the user turn closes or playout finishes, create one `speech` span with explicit times, merged selections and `voice.speech`.
   - Add `heard_by` by waiting for the first `llm_node`/`realtime_inference` under the replying turn.
2. **Realtime (`realtime.ts`):** build the user speech span from the SDK-built turn's fragments. Convert provider offsets with the input-start call ms.
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
