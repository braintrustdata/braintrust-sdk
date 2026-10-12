# Voice schema option: message audio

> AI-created or modified and not human-reviewed in its current form; treat this artifact as provisional. Updated 2026-10-12.

This option anchors voice evidence on conversation messages. Every user or assistant utterance that the framework knows as a message gets one record, keyed by that message's id, holding what was said, its audio, its timing and its evidence quality. LLM spans list the message ids they heard and the message id they produced. No speech spans are emitted, and turns are not part of the contract.

It is one of three alternatives, along with `speech-spans` and `call-timeline`. The whole-call recording (`@braintrust/audio`, `audio.recordings`) is shared and unchanged.

**Implemented:** zod schemas in `js/src/instrumentation/livekit/voice-schema/message-audio.ts`, two example traces in `examples/`, and a test that validates them and their cross-references. **Sketched:** all integration capture and the Lingua mapping. No integration emits these keys yet.

## Customer problem

A customer reading a voice call wants the transcript they already know, the messages, with a play button that plays exactly that sentence. They also want to know whether the text is what was actually said or heard. The current traces put speech on span names (`user_turn`, `livekit.agent_speaking`) and vendor keys (`contrib.livekit.interrupted`). Lingua then has to guess which LLM step a stretch of audio belongs to (#486 `trajectory/voice.rs` links by start time). That guess is weakest exactly where customers look: barge-in, split user turns, and realtime calls whose transcripts arrive late.

## Contract

Three locations, all in span `metadata`. The call span is the span that logs `audio.recordings`: `livekit.agent_session` in LiveKit and `pipecat.pipeline` in Pipecat.

### Call span

| Key                    | Type                               | Req.     | Meaning                                                                                                                                                       |
| ---------------------- | ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice.origin_unix_ms` | number                             | required | Origin of the call clock. Equals `audio.recordings[*].timeline.origin_unix_ms` when audio is recorded, and is still present when recording is off or omitted. |
| `voice.messages`       | `Record<message_id, VoiceMessage>` | required | One entry per spoken or heard message. Written incrementally through metadata merge, so each update logs only the changed entry.                              |

### `VoiceMessage`

All `*_ms` fields are **call ms**: milliseconds since `voice.origin_unix_ms` on the recording clock. The one exception is `provider_audio_end_ms`.

| Field                   | Type                                                                                                | Req.     | Meaning                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `role`                  | `"user" \| "assistant"`                                                                             | required | Speaker. User audio is channel 0, assistant audio channel 1.                                                                                    |
| `seq`                   | int                                                                                                 | required | Creation order within the call, unique. It is the tiebreak when times are missing.                                                              |
| `committed`             | boolean                                                                                             | required | Whether the message entered the agent's conversation context. `false` for ignored backchannels and false interruptions.                         |
| `state`                 | `complete \| interrupted \| unplayed \| open`                                                       | required | `interrupted` and `unplayed` are assistant-only. `unplayed` means generated but never played. `open` means still in progress at the last write. |
| `text`                  | string                                                                                              | optional | What was said: the user's final or partial transcript, or the assistant's spoken text. Present iff `text_status` is `final` or `partial`.       |
| `text_status`           | `final \| partial \| missing \| not_captured`                                                       | required | `missing` means the transcript never arrived. `not_captured` means content capture is off.                                                      |
| `text_source`           | `stt \| realtime_input_transcription \| tts_input \| playout_aligned \| realtime_output_transcript` | optional | Where `text` came from. `tts_input` means the text was sent to TTS but playout was not aligned, so it may overstate what was heard.             |
| `generated_text`        | string                                                                                              | optional | Assistant only, set when the full generated text differs from `text` (interruption).                                                            |
| `start_ms`, `end_ms`    | number                                                                                              | optional | Audible speech bounds.                                                                                                                          |
| `timing_source`         | `vad_events \| provider_events \| playout_events`                                                   | optional | How the bounds were observed.                                                                                                                   |
| `end_of_turn_ms`        | number                                                                                              | optional | User only: when the agent decided the user had finished.                                                                                        |
| `transcript_final_ms`   | number                                                                                              | optional | User only: when the final transcript reached the agent.                                                                                         |
| `interrupted_at_ms`     | number                                                                                              | optional | Assistant only, required when `state` is `interrupted`: where local playout stopped.                                                            |
| `provider_audio_end_ms` | number                                                                                              | optional | Assistant realtime only: the provider's truncation point, **relative to the item's own audio start**, copied as reported and never converted.   |
| `selections`            | `Selection[]`                                                                                       | required | `@braintrust/audio` selections (segment-local ms, `recording_span_id` = call span). Empty while segments are pending or when audio is omitted.  |
| `produced_by_span_id`   | string                                                                                              | optional | Assistant only: the LLM span that generated the message.                                                                                        |
| `turn_span_id`          | string                                                                                              | optional | The turn span, if the integration emits one. Informational only.                                                                                |
| `source_ids`            | `Record<string,string>`                                                                             | optional | Native ids, for example `livekit.item_id`, `livekit.speech_id`, `openai.item_id`, `openai.response_id`, `pipecat.context_id`.                   |

### LLM spans (`type: "llm"`)

| Key                         | Type                 | Req.                        | Meaning                                                                                                                                                          |
| --------------------------- | -------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice.context_message_ids` | `(string \| null)[]` | required on voice LLM spans | One entry per element of the span's `input` messages, in the same order. `null` where the framework has no id, such as a system prompt or a Pipecat tool result. |
| `voice.output_message_id`   | string               | optional                    | The message this call produced, if it produced spoken text. It must equal that message's `produced_by_span_id` back-link.                                        |

### Why a metadata map and not message content parts

We considered adding an `audio_ref` part to Lingua `UserContentPart` and `AssistantContentPart` and rejected it:

1. **Provider round-trips.** Universal messages are provider request and response types. Lingua converts them back to provider payloads, and a voice part would have to be stripped everywhere.
2. **Turn alignment.** Lingua aligns turns by hashing history messages (`PreparedSpan`). Audio added to one copy of a message changes its hash and splits turns.
3. **Late data.** Audio selections and transcripts arrive after the message was logged into LLM inputs: segments upload later, and realtime transcripts arrive late. A keyed map can be merged later; content inside an earlier `input` array cannot.
4. **Header-only reads.** Lingua builds `voice_calls` from span headers (`SpanContext.voice`) without payloads. Metadata keys on the allow-list keep that true; content parts would force payload fetches.
5. **Content capture off.** With capture off the map still carries timing, state and audio; only `text` is dropped.

## IDs and relationships

- **Message id:**
  - LiveKit: the `ChatMessage.id` (`item_…`). In realtime this is the provider's conversation item id.
  - Pipecat: no native id. The integration mints `msg_<uuid>` when a message object is first observed and keeps it by object identity.
- **User message → LLM step:** the first LLM span whose `voice.context_message_ids` contains the message id ("heard by"), inferred by Lingua.
- **Assistant message → LLM step:** `produced_by_span_id`, mirrored by `voice.output_message_id` on that span.
- **Message → audio:** `selections` on channel 0 for the user and channel 1 for the assistant.
- **Message → tools:** indirect. A tool call is a separate context entry with its own id (or `null`) in `voice.context_message_ids`. Tool spans keep their existing `gen_ai.tool.call.id` and `contrib.livekit.request_span_id` links.
- **Turn spans:** optional. Lingua does not need them.

## Timing semantics

- `start_ms`/`end_ms` and `selections` describe the same audible interval.
  - **Selections:** what playback uses. They are clipped to ready segments and are empty if audio is unavailable.
  - **`start_ms`/`end_ms`:** survive audio loss.
- **User bounds:** VAD or provider speech events, mapped to call ms by `event_time_unix_ms - voice.origin_unix_ms`. That mapping is arrival time, not sample time; `timing_source` says which.
- **Assistant bounds:** local playout (`playbackStarted`/`playbackProgressed`/`playbackFinished`), not generation. Generation timing stays on LLM and TTS spans.
- **Derived latencies, all computed by Lingua and never emitted:**
  - **Response latency:** next assistant `start_ms` − user `end_of_turn_ms`.
  - **End-of-turn delay:** `end_of_turn_ms` − user `end_ms`.
  - **Transcript lag:** `transcript_final_ms` − `end_ms`.
  - **Overlap:** any intersection of a user and an assistant interval.

## What integrations capture and when

| Field                                            | LiveKit cascaded (JS)                                                                                                  | LiveKit realtime (JS)                                         | Pipecat cascaded (Python, sketch)                                                                                       | Pipecat realtime (Python, sketch)                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Message created (`seq`, id, `role`)              | `AgentSession._conversationItemAdded` (already hooked)                                                                 | same; realtime items are added via `RealtimeSession` chat ctx | user: `LLMUserAggregator` pushes the context frame; assistant: `LLMAssistantAggregator` adds the message                | `conversation.item.created` handled in `OpenAIRealtimeLLMService` |
| `committed=false` user message                   | VAD speaking→listening with no chat item added (LiveKit false-interruption or backchannel handling; verify event name) | `input_speech_started`/`stopped` pair with no committed item  | `UserStoppedSpeakingFrame` with no aggregation pushed                                                                   | VAD pair without `conversation.item.created`                      |
| User `text`, `transcript_final_ms`               | `EndOfTurnInfo`/`user_input_transcribed` final                                                                         | `input_audio_transcription_completed` (may never arrive)      | final `TranscriptionFrame`                                                                                              | `TranscriptionFrame` from the input-transcription event           |
| User `start_ms`/`end_ms`                         | `EndOfTurnInfo.startedSpeakingAt`/`stoppedSpeakingAt`                                                                  | `input_speech_started`/`stopped` arrival                      | `UserStarted`/`UserStoppedSpeakingFrame`                                                                                | provider `speech_started`/`stopped`                               |
| `end_of_turn_ms`                                 | `onEndOfTurn`                                                                                                          | server VAD commit (`input_speech_stopped`)                    | turn analyzer end-of-turn (`UserStoppedSpeakingFrame` after `turn_analyzer`)                                            | provider `input_audio_buffer.committed`                           |
| Assistant `text`, `state`, `interrupted_at_ms`   | `playbackFinished {playbackPosition, interrupted, synchronizedTranscript}` (already observed in `playback.ts`)         | same; `generated_text` from realtime `messageStream`          | `TTSTextFrame`s played before `InterruptionFrame`/`BotStoppedSpeakingFrame`; the assistant aggregator already truncates | same, plus `conversation.item.truncate` → `provider_audio_end_ms` |
| `produced_by_span_id`, `voice.output_message_id` | `llm_node` span at `_pipelineReplyTaskImpl`, paired with the agent turn's chat item                                    | `realtime_inference` span, paired by `response_id` ↔ item     | `pipecat_llm_response`/`llm_response` span open at `LLMFullResponseStartFrame`                                          | response span keyed by `response.id`                              |
| `voice.context_message_ids`                      | chat ctx item ids at `performLLMInference` (hooked)                                                                    | `realtimeSession.chatCtx.items` ids at response creation      | ids of the `LLMContext` messages at `LLMContextFrame`                                                                   | ids of the session context at `response.create`                   |
| `selections`                                     | turn selection publishing in `processor.ts`, re-targeted from turn spans to the message entry                          | same                                                          | `_audio/alignment.py`                                                                                                   | same                                                              |

## What Lingua records vs infers

- **Records as logged:** every `VoiceMessage` field, converted to wall-clock `DateTime` with `voice.origin_unix_ms`. `provider_audio_end_ms` stays as a number.
- **Infers:**
  - each user message's step (first LLM span that heard it) and its Trajectory turn (the turn whose request includes that LLM step);
  - order (`start_ms`, then `seq`);
  - overlaps and latencies;
  - the flags `transcript_after_reply` (`transcript_final_ms` later than the start of the LLM span that heard it) and `unheard` (committed but no LLM span lists it);
  - the existing `VoiceCall.speech` list, built from messages so #22034 and #22036 keep working.
- **Never infers:** text from audio, or audio bounds from text.

## Trajectory and app mapping

See `specs/voice-schema-message-audio.md` in Lingua. In short, `VoiceCall` gains `messages?: VoiceMessage[]` (see the Lingua PR for exact types), and `speech` becomes a derived view:

- `Speech.id` = message id
- `speaker` from `role`
- `step_ids` = `[produced_by_span_id]` for the assistant, or `[first heard-by LLM span id]` for the user
- `selections`
- `interrupted`

In the app:

- **#22034 voice bar:** keeps working through `speech`.
- **#22036 play-from-message:** can look up a message by id rather than by step, so a user message gets a play button even when two messages share a step.
- **Thread view:** can show "heard as" versus "generated" text and missing-transcript badges from `text_status`.

## Worked example

`examples/cascaded.json` and `examples/realtime.json` encode the shared scenario (`notes/scenario.md`: dental-clinic reschedule with a `find_slots` → `reschedule` tool chain and a barge-in).

Abridged cascaded `voice.messages` on `c-root`:

```json
{
  "item_u1": {
    "role": "user",
    "seq": 0,
    "committed": true,
    "state": "complete",
    "text": "Hi, can I move my Thursday cleaning to Friday morning?",
    "text_status": "final",
    "text_source": "stt",
    "start_ms": 300,
    "end_ms": 2900,
    "end_of_turn_ms": 3400,
    "transcript_final_ms": 3450,
    "selections": [
      {
        "recording_span_id": "c-root",
        "recording_id": "call-0000",
        "start_offset_ms": 300,
        "end_offset_ms": 2900,
        "channel_index": 0
      }
    ]
  },
  "item_a1": {
    "role": "assistant",
    "seq": 1,
    "committed": true,
    "state": "interrupted",
    "text": "I have nine thirty or eleven on Fri",
    "text_source": "playout_aligned",
    "text_status": "final",
    "generated_text": "I have nine thirty or eleven on Friday. Which would you like?",
    "start_ms": 5300,
    "end_ms": 7900,
    "interrupted_at_ms": 7900,
    "produced_by_span_id": "c-llm2",
    "selections": ["…channel 1, 5300–7900"]
  }
}
```

`c-llm2.metadata` has `"voice.context_message_ids": [null, "item_u1", "item_fc1", "item_fco1"]` and `"voice.output_message_id": "item_a1"`.

| What differs in realtime (`r-root`) | Cascaded                                              | Realtime                                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User transcript                     | `stt`, final at 3450, before the LLM ran              | `realtime_input_transcription`, final at **4300**, after the model already called `find_slots` at 4100. `r-llm1.input` shows `""` for the user message, but its id is in `voice.context_message_ids`. |
| Barge-in transcript                 | `"Nine thirty works."`                                | `text_status: "missing"`, no `text`. Audio and bounds are still present, so the customer can hear it.                                                                                                 |
| Interruption                        | `interrupted_at_ms: 7900`                             | `interrupted_at_ms: 7900` (local playout) **and** `provider_audio_end_ms: 2600` (item-relative; provider thought it stopped at 7600 call ms). The 300 ms disagreement stays visible.                  |
| Steps                               | separate `llm_response` + `tts` spans                 | one `llm_response` per realtime response; no TTS or STT spans                                                                                                                                         |
| Turn spans                          | `user_turn`/`assistant_turn` present (`turn_span_id`) | only `assistant_turn`; no `turn_span_id`. Nothing depends on turns.                                                                                                                                   |

## Customer usefulness

| Need                          | How well | Notes                                                                                                                                                                                                                            |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What was said                 | strong   | One record per message with spoken versus generated text and a transcript source.                                                                                                                                                |
| Play matching audio           | strong   | Selections are keyed by the same id the thread view renders, so no time-based guessing.                                                                                                                                          |
| Diagnose delays               | medium   | End-of-turn delay, transcript lag and response latency come from message fields. Per-stage STT/LLM/TTS timing still needs the step spans. Nothing records why a gap happened.                                                    |
| Interruptions and overlap     | medium   | `interrupted_at_ms`, `generated_text` and overlapping intervals. Uncommitted backchannels are visible. But an interruption is a property of the interrupted message only: what caused it is inferred from overlap, not recorded. |
| Follow tools                  | medium   | Tools sit between messages through the existing LLM and tool spans and context ids. A filler phrase spoken during a tool call ("let me check") is just another assistant message, which is fine.                                 |
| Missing or uncertain evidence | strong   | `text_status`, `text_source`, `timing_source`, `committed`, `open`, empty `selections`, and the raw provider truncation.                                                                                                         |

## Edge cases and weaknesses

- **Barge-in truncation:** handled (`text` vs `generated_text`, `interrupted_at_ms`). Pipecat's assistant aggregator truncates the stored message, so `generated_text` must come from the LLM span output.
- **Overlap:** intervals overlap freely. The app must pick which message to highlight; #22036's "latest start wins" rule still works.
- **Late or missing realtime transcript:** late updates merge into the same entry. Missing stays `missing`. An LLM span logged before the transcript shows empty user text, and the id still links it.
- **Ignored barge-in or backchannel:** `committed: false`, `role: "user"`, with audio and optional text, and no LLM span lists it. LiveKit drops these from chat context, so the integration has to mint an id (`voice_<seq>`) from VAD events. This is the weakest capture path, because without content capture there is no text and only VAD bounds.
- **Failed or omitted segments:** `selections` is empty or partial. `start_ms`/`end_ms` still place the message, and recording omission reasons stay in `audio.recordings`.
- **Unknown clock offset:** if the recording started late, its descriptor origin differs from `voice.origin_unix_ms`. Lingua must use the descriptor timeline for selections and `voice.origin_unix_ms` for `*_ms`, and warn when they differ. The contract does not say how large an offset is acceptable.
- **Call in progress:** entries with `state: "open"`. Lingua shows them without a step link if no LLM span has heard them yet.
- **Content capture off:** `text_status: "not_captured"`. Ids, timing and audio remain. LiveKit only exposes chat ctx ids through PII attributes, so `voice.context_message_ids` needs a direct read of `chatCtx` at `performLLMInference`; otherwise linking fails.
- **Tool cancelled by interruption:** the cancelled tool span ends with an error. The partially spoken assistant message is `interrupted`; a message that was generated but never played is `unplayed`. Nothing records "this tool was cancelled because of that barge-in"; that is inferred from timing.
- **Agent handoff:** messages stay keyed per call, and `produced_by_span_id` points into the new agent's spans. Per-agent attribution is inferred from the span tree.
- **Large calls:** one root metadata map grows with call length (about 1 KB per message), and every update rewrites a root-row merge. A 30-minute call stays well under 1 MB, but this is the main scaling cost.
- **Duplicate or merged ids:** LiveKit merges speech fragments into one chat item. The record then spans multiple intervals, so `selections` can hold several ranges, and `start_ms`/`end_ms` are the outer bounds.

## Implementation starting point

1. **Message records (`processor.ts`).** Make `processor.conversation()` (`_conversationItemAdded`) the single writer of `voice.messages[item.id]`, alongside `contrib.livekit.committed_messages`, without content gating for non-text fields.
2. **Assistant playout (`playback.ts`).** In the `playbackFinished` handling, write `state`, `text`, `interrupted_at_ms` and `end_ms` into the assistant entry that owns the speech. Pair the speech with its item through `speech_id`.
3. **Audio selections.** Re-target `TurnSelection` publishing: give the publisher a span adapter whose `log` rewrites `audio.selections` into `voice.messages[id].selections` on the call span.
4. **LLM span links.** In `performLLMInference`/`realtime_inference` handling, log `voice.context_message_ids` from `chatCtx.items` and set `voice.output_message_id` when the reply item commits.
5. **Realtime.** In `realtime.ts`, update user entries from `input_audio_transcription_completed` and set `missing` at session close for items that never got one.
6. **Pipecat.** Mint ids in the user and assistant aggregators, and port steps 1–5 to the Python observer.
7. **Lingua.** Follow `specs/voice-schema-message-audio.md`: parse keys, build `VoiceCall.messages`, derive `speech`, and add the keys to `TRAJECTORY_METADATA_FIELDS`.

## Open questions

- Should `voice.messages` live on the call span, as here, or on each message's owning turn span? The call span is simpler for Lingua and is header-only. Turn spans keep rows small but need a lookup across spans.
- Is minting ids for uncommitted user speech worth the capture complexity, or should the MVP drop uncommitted speech?
- Should `end_of_turn_ms` move to the assistant message as `responding_to_end_ms`, to make latency explicit per reply?
