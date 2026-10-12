# Voice tracing option: speech spans

> AI-created or modified and not human-reviewed in its current form; treat this artifact as provisional. Updated 2026-10-12.

This option logs each utterance as its own `speech` span with framework-neutral metadata. It keeps the shared whole-call recording, `audio.recordings` and `audio.selections`. It changes how speech is identified: Lingua reads `metadata["voice.speech"]` instead of LiveKit span names and `contrib.livekit.*` keys. Turn spans, LLM spans and tool spans stay as they are.

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

Every time is in **call ms**: milliseconds since the recording's `timeline.origin_unix_ms`, on the recording clock. A span's `metrics.start` and `metrics.end` are Unix seconds on the same clock: `(origin_unix_ms + call_ms) / 1000`.

### Call span

This is the root span: LiveKit `livekit.agent_session`, Pipecat `pipecat.pipeline`.

| Field                              | Type                                         | Required               | Meaning                                                                                                               |
| ---------------------------------- | -------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `input.audio[<recording id>]`      | attachment                                   | When audio is captured | Unchanged (`@braintrust/audio`).                                                                                      |
| `metadata["audio.recordings"]`     | descriptor[]                                 | When audio is captured | Unchanged. Channel 0 is the caller, channel 1 the agent.                                                              |
| `metadata["voice.call"].framework` | `"livekit" \| "pipecat"`                     | Yes                    | The integration that emitted the call.                                                                                |
| `metadata["voice.call"].pipeline`  | `"cascaded" \| "realtime" \| "half_cascade"` | Yes                    | Tells readers which speech evidence to expect. `half_cascade` is a realtime model with text output plus separate TTS. |

### Turn spans

`user_turn` and `assistant_turn` task spans are unchanged:

- `turn.id` is the turn span's own `span_id`.
- On an assistant turn, `turn.reply_to` is the user turn it answers.

A speech span is a direct child of its turn. In this option turns group speech and steps; they don't carry speech semantics themselves.

### Speech span

Each utterance gets one span with `span_attributes: {type: "task", name: "speech"}`. The name stays fixed; Lingua recognizes the span by `voice.speech`, not by name.

| Field                                  | Type                                                                                    | Required                      | Meaning                                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metrics.start` / `metrics.end`        | Unix s                                                                                  | Yes                           | When the utterance's audio started and ended on the recording clock.                                                                                                                                           |
| `metadata["audio.selections"]`         | Selection[]                                                                             | When audio is captured        | Unchanged shape. One channel: 0 for user speech, 1 for agent speech.                                                                                                                                           |
| `voice.speech.speaker`                 | `"user" \| "agent"`                                                                     | Yes                           | Who spoke.                                                                                                                                                                                                     |
| `voice.speech.turn_id`                 | span id                                                                                 | No                            | The owning turn span, which is also the parent.                                                                                                                                                                |
| `voice.speech.state`                   | `"complete" \| "interrupted" \| "incomplete" \| "ignored"`                              | Yes                           | `interrupted` means agent playout was cut short. `incomplete` means the call or process ended mid-utterance. `ignored` means user speech the agent heard but did not answer (backchannel, false interruption). |
| `voice.speech.timing_source`           | `"audio_samples" \| "vad" \| "provider_vad" \| "playout" \| "span_clock"`               | Yes                           | The evidence behind `metrics.start` and `metrics.end`. `span_clock` means a guess from local spans.                                                                                                            |
| `voice.speech.heard_by`                | span id[]                                                                               | User only, optional           | The LLM spans whose input first contained this utterance.                                                                                                                                                      |
| `voice.speech.produced_by`             | span id                                                                                 | Agent only, optional          | The LLM span that generated the spoken text.                                                                                                                                                                   |
| `voice.speech.interrupted_by`          | span id                                                                                 | Agent only, optional          | The user speech span that cut this one off. Requires `state: "interrupted"`.                                                                                                                                   |
| `voice.speech.played_ms`               | ms                                                                                      | Agent only, optional          | Audio actually played locally before the end.                                                                                                                                                                  |
| `voice.speech.provider_played_ms`      | ms                                                                                      | Agent realtime only, optional | What the provider was told had played (`conversation.item.truncate` `audio_end_ms`).                                                                                                                           |
| `voice.speech.end_of_turn_ms`          | call ms                                                                                 | User only, optional           | When the agent decided the user had finished.                                                                                                                                                                  |
| `voice.speech.transcript.source`       | `"stt" \| "provider_transcription" \| "tts_input" \| "model_output" \| "playback_sync"` | With `transcript`             | Where the text came from.                                                                                                                                                                                      |
| `voice.speech.transcript.final`        | boolean                                                                                 | With `transcript`             | `false` when only partial text arrived before the span ended.                                                                                                                                                  |
| `voice.speech.transcript.available_ms` | call ms                                                                                 | No                            | When the text became available. In realtime this is often after the response started.                                                                                                                          |
| `voice.speech.transcript.confidence`   | 0–1                                                                                     | No                            | STT confidence, if the provider reports one.                                                                                                                                                                   |
| `output.text`                          | string                                                                                  | Content capture only          | The best transcript of what was actually said.                                                                                                                                                                 |
| `output.planned_text`                  | string                                                                                  | Content capture only          | Agent text that was generated but not fully spoken.                                                                                                                                                            |

**Absence rules:**

- An omitted field means "not observed". Integrations never write `null` or placeholder text.
- With no transcript, both `transcript` and `output` are absent.
- When content capture is off, `output` is absent but `transcript.source` stays, so readers know a transcript existed.

### IDs and relationships

```text
call span ──audio.recordings──► recording segments
 ├─ user_turn (turn.id = own span_id)
 │   └─ speech {speaker:user, turn_id, heard_by:[llm span ids]} ──audio.selections──► channel 0
 └─ assistant_turn (turn.reply_to = user_turn)
     ├─ llm_response ◄──produced_by── speech {speaker:agent, interrupted_by:user speech}
     ├─ <tool span> (tool_call_id)
     └─ speech ──audio.selections──► channel 1
```

- All links are `span_id`s in the same trace; Lingua maps them to row ids.
- A link may name a span that ends later than the speech span. Integrations update the earlier span with a merge write; see "late links" below.

## What each integration captures and when

| Value                  | LiveKit cascaded (JS)                                                                              | LiveKit realtime (JS)                                                  | Pipecat cascaded (Python)                                                            | Pipecat realtime (Python)                       |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| User speech start/end  | Native `user_speaking` span, clipped to captured input samples at its end (`processor.ts` `onEnd`) | Realtime `input_speech_started`/`stopped` (`realtime.ts` turn tracker) | `UserStartedSpeakingFrame`/`UserStoppedSpeakingFrame`                                | Same frames, or the service's server-VAD events |
| `end_of_turn_ms`       | `AgentActivity.onEndOfTurn` (`EndOfTurnInfo`)                                                      | Commit of the input buffer (server VAD)                                | Turn analyzer stop (`UserStoppedSpeakingFrame` after the end-of-turn decision)       | Server VAD commit                               |
| User transcript        | `user_turn` transcript plus `transcription_delay` → `available_ms`                                 | `InputTranscriptionCompleted` → `provider_transcription`               | `TranscriptionFrame` (`finalized`)                                                   | The service's input transcription frames        |
| `heard_by`             | The `llm_node` started under the `agent_turn` whose `turn.reply_to` is this turn                   | The `realtime_inference` started after the commit                      | The `llm_response` opened by the next `LLMContextFrame` that contains the transcript | The response span after the commit              |
| Agent speech start/end | Native `agent_speaking`, placed by `playbackProgressed`/`playbackFinished`                         | Same                                                                   | `BotStartedSpeakingFrame`/`BotStoppedSpeakingFrame` at the output transport          | Same                                            |
| `produced_by`          | The `llm_node` with the same `contrib.livekit.speech_id`                                           | The `realtime_inference` with the same `speech_id`/`response_id`       | The `llm_response` whose TTS `context_id` matches                                    | The response that emitted the audio             |
| `state`, `played_ms`   | `playbackFinished.interrupted`, `playbackPosition`                                                 | Same, plus `provider_played_ms` from the truncate call                 | `InterruptionFrame` while the bot is speaking; position from bot-speaking frames     | Same, plus truncation from the service          |
| `interrupted_by`       | The user speech span active when playout stopped                                                   | Same                                                                   | Same                                                                                 | Same                                            |
| Agent text             | `synchronizedTranscript` → `playback_sync`; `tts` input → `planned_text`                           | Response transcript → `model_output`                                   | `TTSTextFrame`s observed while speaking → `playback_sync`                            | The service's text frames → `model_output`      |

## What Lingua records and what it infers

**Recorded as logged:**

- the speaker, state, timing source and transcript source;
- `interrupted_by`;
- `end_of_turn_time` (origin + `end_of_turn_ms`);
- the selections;
- `step_ids`, taken from `produced_by` for agent speech and `heard_by` for user speech.

**Inferred:**

- `Speech.interrupted` (true when `state` is `interrupted`, false for other agent speech);
- the call each speech belongs to (nearest ancestor with recordings);
- speech order (by audio start), and overlap from the selections;
- `step_ids` falling back to the turn span and its step children when no link was logged.

Latency is not stored. The app computes it from `end_of_turn_time`, step times and the next agent speech start.

**Compatibility:** traces with no `voice.speech` keep #486's name-based behaviour unchanged.

## Trajectory and app mapping

`Trajectory.voice_calls[].speech[]` gains five optional fields:

- `state`
- `interrupted_by`
- `transcript_source`
- `timing_source`
- `end_of_turn_time`

The existing fields keep their meaning, so #22034 and #22036 work unchanged:

- **Voice bar:** windows come from `selections`.
- **Thread view:** clicking a window or "Play from this message" resolves `step_ids` to a turn's `request_id`, `work[].id` or `response_id`.

The new fields allow, without further schema work:

- an "interrupted by …" marker;
- a "no transcript" badge when `transcript_source` is absent;
- a "timing estimated" badge for `span_clock`;
- an end-of-turn → first-audio latency bar.

## Worked example

`examples/cascaded.json` and `examples/realtime.json` encode the same fictional call: a booking change with `find_slots`, then a barge-in, then `reschedule`. Times are call ms.

|                                 | Cascaded                                                                                                            | Realtime                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steps under `assistant_turn` 1  | `l1` llm (tool call) → `find_slots` → `l2` llm → `tts`                                                              | `r1` realtime response (tool call) → `find_slots` → `r2` response with audio                                                                          |
| User speech `s1`                | `timing_source: vad`; `transcript {stt, available_ms: 3450, confidence: 0.94}`; `heard_by: [l1]`                    | `timing_source: provider_vad`; `transcript {provider_transcription, available_ms: 4300}`, which arrived after the tool call at 4100; `heard_by: [r1]` |
| Agent speech `s2`               | 5300–7900; `played_ms: 2600`; `produced_by: l2`; `output.text` is what was spoken, `planned_text` the full sentence | 5000–7900; `played_ms: 2900` but `provider_played_ms: 2600`, because the local output buffer kept playing for 300 ms after the truncate               |
| Barge-in `s3`                   | `stt` transcript "Nine thirty works."                                                                               | No transcript: `transcript` and `output` are absent, which the voice view can show as missing                                                         |
| End of turn → first agent audio | 3400 → 5300 (1.9 s), split across STT, LLM, tool and TTS spans                                                      | 3400 → 5000 (1.6 s), with no STT or TTS spans to split it                                                                                             |

Lingua output for both files is checked in the companion PR's fixtures.

The realtime fixture shows one weakness. Because user turn 2 has no transcript, Lingua's turn builder merges both exchanges into one Trajectory turn. `voice_calls` is still correct, but the thread view shows one long turn.

## Customer usefulness

| Question                      | How well this option answers it                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| What was said                 | Good. One span per utterance, with text and its provenance. Planned and spoken agent text are kept apart.                                             |
| Play matching audio           | Good. Each speech span has exact selections.                                                                                                          |
| Diagnose delays               | Partial. End of turn and audio start are explicit, but the pipeline breakdown still comes from LLM, TTS and STT spans, and realtime has no breakdown. |
| Interruptions and overlap     | Good. `state`, `interrupted_by`, `played_ms` and `provider_played_ms` are explicit; overlap shows in the selections.                                  |
| Follow tools                  | Indirect. Speech links to LLM steps, and tools sit beside them in the turn. Nothing says that a tool ran while the user was waiting in silence.       |
| Missing or uncertain evidence | Good per utterance: `timing_source`, transcript `final`/`source`, and absent fields. There is no call-level summary of gaps.                          |

## Edge cases and weaknesses

- **Barge-in truncation.** Covered by `played_ms` and `planned_text`. The thread still shows the LLM's full planned answer as the turn response, because Lingua's `response_text` comes from the LLM span.
- **Overlap.** Two speech spans overlap in time; the app already prefers the later-starting window (#22036).
- **Late or missing realtime transcripts.** The integration must update `output` and `transcript` after the span ends, or leave them absent. A missing transcript splits turns badly (above). A fix would let a user speech with `heard_by` start a new turn without text; that is sketched, not implemented.
- **Failed or omitted segments.** Selections only point at ready segments, so the speech keeps its timing but has no playable audio. Lingua still lists it, with empty `selections`.
- **Unknown clock offset.** If the recording started late or the origin is wrong, every speech span is wrong by the same amount, and nothing in this option detects it. `timing_source: span_clock` marks only spans that were never aligned to audio.
- **Call in progress.** Speech whose call row isn't logged yet is skipped (#486 behaviour). `incomplete` is set only at shutdown.
- **Content capture off.** Text disappears but every link and timing field stays.
- **Tool cancelled by interruption.** The tool span has the error. The speech has no direct link to it; readers infer it from the turn.
- **Agent handoff.** Speech stays under the turn of the agent that spoke. `voice.call` has no field for the active agent; it would have to come from turn or agent metadata.
- **Late links.** `heard_by` and `interrupted_by` are known only after the speech span ends. Integrations need a second, merge `log()` on an already-ended span, which Braintrust allows but which costs one extra row write per utterance.
- **Strict enums.** Lingua rejects unknown `state`, `timing_source` and `transcript.source` values (the whole `voice.speech` key fails). New values need a Lingua release first.

## Implementation starting point

1. **LiveKit (`js/src/instrumentation/livekit/processor.ts`):**
   - Rename the exported `livekit.user_speaking`/`livekit.agent_speaking` operations to `speech`, and log `voice.speech` at `onEnd` from the data already tracked (`speakingByTurn`, playback events, `EndOfTurnInfo`).
   - Log `voice.call` on `agent_session` start.
   - Add `heard_by` when an `llm_node`/`realtime_inference` span starts under a turn with `turn.reply_to`.
2. **Realtime (`realtime.ts`):** create user speech spans for SDK-built turns. Today only the turn is created and `user_speaking` is re-parented under it.
3. **Pipecat (`sdk-python/py/src/braintrust/integrations/pipecat`, `delner/pipecat-voice-recording`):** emit `speech` spans from the speaking and bot-speaking frames listed above.
4. **Lingua:** done in the companion PR. Then add `voice.speech` to `TRAJECTORY_METADATA_FIELDS` after #486 is rebased onto main.

## Open questions

- Should user speech that LiveKit merges into one turn (pause ≤ `maxPauseMs`) be one speech span or several? This draft logs one per VAD segment.
- Should `ignored` speech create a Trajectory turn?
- Is a per-utterance late write acceptable for the ingestion volume of long calls?
