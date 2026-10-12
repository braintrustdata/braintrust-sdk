# Voice schema option: message audio

> AI-created or modified and not human-reviewed in its current form; treat this artifact as provisional. Updated 2026-10-12.

This option anchors voice evidence on conversation messages. Every user or assistant utterance that the framework knows as a message gets one record, keyed by that message's id, holding what was said, its audio, its timing and its evidence quality. LLM spans list the message ids they heard and the message id they produced. No speech spans are emitted, and turns are not part of the contract.

It is one of three alternatives, along with `speech-spans` and `call-timeline`. The whole-call recording (`@braintrust/audio`, `audio.recordings`) is shared and unchanged.

**Implemented:** zod schemas in `js/src/instrumentation/livekit/voice-schema/message-audio.ts`, two example traces in `examples/`, and a test that validates them and their cross-references. **Implemented in the companion Lingua PR:** the Lingua mapping, built from `specs/voice-schema-message-audio.md` with fixtures from these examples. **Sketched:** all integration capture. No integration emits these keys yet.

## Customer problem

A customer reading a voice call wants the transcript they already know, the messages, with a play button that plays exactly that sentence. They also want to know whether the text is what was actually said or heard. The current traces put speech on span names (`user_turn`, `livekit.agent_speaking`) and vendor keys (`contrib.livekit.interrupted`). Lingua then has to guess which LLM step a stretch of audio belongs to (#486 `trajectory/voice.rs` links by start time). That guess is weakest exactly where customers look: barge-in, split user turns, and realtime calls whose transcripts arrive late.

## Contract

Three locations, all in span `metadata`. The call span is the span that logs `audio.recordings`: `livekit.agent_session` in LiveKit and `pipecat.pipeline` in Pipecat.

### Call span

| Key                    | Type                               | Req.     | Meaning                                                                                                                                                       |
| ---------------------- | ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice.origin_unix_ms` | number                             | required | Origin of the call clock. Equals `audio.recordings[*].timeline.origin_unix_ms` when audio is recorded, and is still present when recording is off or omitted. |
| `voice.messages`       | `Record<message_id, VoiceMessage>` | required | One entry per spoken or heard message. See [Writing entries](#writing-entries). Written whether or not content capture is on.                                 |

### `VoiceMessage`

All `*_ms` fields are **call ms**: milliseconds since `voice.origin_unix_ms` on the recording clock. The one exception is `provider_audio_end_ms`.

| Field                   | Type                                                                                                | Req.     | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role`                  | `"user" \| "assistant"`                                                                             | required | Speaker. User audio is channel 0, assistant audio channel 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `seq`                   | int                                                                                                 | required | Assigned when the integration first creates the in-memory record: user speech at its first VAD start, assistant speech at `SpeechHandle` creation (Pipecat: `TTSStartedFrame`). It therefore orders records by when each began, not by commit or playout. This is intended: an assistant record created before a barge-in starts keeps the lower seq. Unique and increasing within a call. Gaps are allowed and expected, for records that were merged and never written and for tool-only speech (see [Tool-only and cancelled speech](#tool-only-and-cancelled-speech)). It is the tiebreak when times are missing. |
| `committed`             | boolean                                                                                             | required | Whether the message entered the agent's chat context. `false` for uncommitted user speech (see [Uncommitted user speech](#uncommitted-user-speech)) and for cancelled assistant speech that never entered the context.                                                                                                                                                                                                                                                                                                                                                                                                |
| `state`                 | `complete \| interrupted \| unplayed \| open`                                                       | required | `interrupted` and `unplayed` are assistant-only. `unplayed` means text was generated but no audio played; `text` then holds the generated text (`tts_input` or `realtime_output_transcript`) and `selections` is empty. `open` means still in progress at the last write.                                                                                                                                                                                                                                                                                                                                             |
| `text`                  | string                                                                                              | optional | What was said: the user's final or partial transcript, or the assistant's spoken text. Present iff `text_status` is `final` or `partial`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `text_status`           | `final \| partial \| missing \| not_captured`                                                       | required | `missing` means no transcript arrived by the deadline (a later arrival may still upgrade it to `final`). `not_captured` means content capture is off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `text_source`           | `stt \| realtime_input_transcription \| tts_input \| playout_aligned \| realtime_output_transcript` | optional | Where `text` came from, or would have come from when `text_status` is `missing`. Assistant: `playout_aligned` is text aligned to played audio. `tts_input` (cascaded) and `realtime_output_transcript` (realtime) are the generated text used when no aligned text exists, so they may overstate what was heard. See [Assistant spoken text](#assistant-spoken-text).                                                                                                                                                                                                                                                 |
| `generated_text`        | string                                                                                              | optional | Assistant only: the full generated text, set only when it differs from `text`. Cascaded: the TTS input. Realtime: that item's output transcript.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `start_ms`, `end_ms`    | number                                                                                              | optional | Outer bounds of the message's audible speech.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `timing_source`         | `vad_events \| provider_events \| local_receipt \| playout_events`                                  | optional | How the bounds were observed. `local_receipt`: local receipt times of payload-less provider speech events (LiveKit realtime); the end includes the provider's silence padding unless subtracted. `provider_events`: provider-reported audio ms (Pipecat with raw OpenAI events).                                                                                                                                                                                                                                                                                                                                      |
| `end_of_turn_ms`        | number                                                                                              | optional | User only: when the agent committed the user's turn. Cascaded: `onEndOfTurn` entry. Realtime: `_realtimeGenerationTaskImpl` entry for the generation that answers it.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `transcript_final_ms`   | number                                                                                              | optional | User only: when the final STT result arrived (LiveKit `user_input_transcribed` with `isFinal`, realtime `input_audio_transcription_completed` with `isFinal`, Pipecat finalized `TranscriptionFrame`). It may be later than `end_of_turn_ms` when endpointing fires before STT finalizes.                                                                                                                                                                                                                                                                                                                             |
| `interrupted_at_ms`     | number                                                                                              | optional | Assistant only, required when `state` is `interrupted`: where local playout stopped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `provider_audio_end_ms` | number                                                                                              | optional | Assistant realtime only: the `audio_end_ms` **sent to the provider** in a truncate, relative to the item's own audio start. LiveKit computes it from the same local playback position, so it always equals `interrupted_at_ms − start_ms` there. Only integrations that observe the provider independently (Pipecat) can show a disagreement between the provider and local playout.                                                                                                                                                                                                                                  |
| `selections`            | `Selection[]`                                                                                       | required | `@braintrust/audio` selections (segment-local ms, `recording_span_id` = call span), always the full current array. Empty while segments are pending or when audio is omitted.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `produced_by_span_id`   | string                                                                                              | optional | Assistant only: the LLM span that generated the message.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `turn_span_id`          | string                                                                                              | optional | The turn span, if the integration emits one. Debugging aid only; Lingua ignores it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `source_ids`            | `Record<string,string>`                                                                             | optional | Native ids, for example `livekit.item_id`, `livekit.speech_id`, `openai.item_id`, `openai.response_id`, `pipecat.context_id`. Debugging aid only; Lingua ignores it.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### LLM spans (`type: "llm"`)

| Key                         | Type                 | Req.                                       | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `voice.context_message_ids` | `(string \| null)[]` | optional, expected on every voice LLM span | The model's context items in order: each item's id, or `null` for an input that is not a context item (for example a Pipecat system prompt passed outside the context). LiveKit cascaded instructions are a real item (`lk.agent_task.instructions`); LiveKit realtime instructions are not listed. Captured whether or not content capture is on. When content is captured, `input` has exactly one message per context item in the same order. |
| `voice.output_message_id`   | string               | optional                                   | The message this call produced, if it produced spoken text. It must equal that message's `produced_by_span_id` back-link.                                                                                                                                                                                                                                                                                                                        |

### Why a metadata map and not message content parts

We considered adding an `audio_ref` part to Lingua `UserContentPart` and `AssistantContentPart` and rejected it:

1. **Provider round-trips.** Universal messages are provider request and response types. Lingua converts them back to provider payloads, and a voice part would have to be stripped everywhere.
2. **Turn alignment.** Lingua aligns turns by hashing history messages (`PreparedSpan`). Audio added to one copy of a message changes its hash and splits turns.
3. **Late data.** Audio selections and transcripts arrive after the message was logged into LLM inputs: segments upload later, and realtime transcripts arrive late. A keyed map can be merged later; content inside an earlier `input` array cannot.
4. **Header-only reads.** Lingua builds `voice_calls` from span headers (`SpanContext.voice`) without payloads. Metadata keys on the allow-list keep that true; content parts would force payload fetches.
5. **Content capture off.** With capture off the map still carries timing, state and audio; only `text` is dropped.

## Writing entries

Braintrust merges span `metadata` across logs with `mergeDicts`. Objects deep-merge; arrays and scalars are replaced; keys cannot be deleted. The contract depends on that:

- **One accumulator per message.** The integration keeps one in-memory record per message. Every write logs that message's **whole current entry** as `{"voice.messages": {[id]: entry}}`. `selections` is always the full array, never a delta.
- **Fields only move forward:**
  - `state`: from `open` to one terminal value (`complete`, `interrupted` or `unplayed`), never back.
  - `text_status`:
    - `partial` → `final`
    - `partial` → `missing` at the deadline
    - `missing` → `final` if a transcript arrives late
    - `not_captured` never changes
    - `final` never changes
    - `missing` never goes back to `partial`
  - `selections` and bounds only grow.
  - `committed` never changes after the first write.
- **Never write optional fields as `null`.** An absent field is simply not in the entry. A field that later disappears can't be removed by merge, so the accumulator must not emit a field it may need to retract (for example, write `text` only once it is final or partial, never speculatively).
- **Lingua validates only the merged row**, the final state of the call span's metadata. Individual writes are not validated.

## IDs and relationships

- **Message id:**
  - LiveKit: the `ChatMessage.id` (`item_…`). In realtime this is the provider's conversation item id.
  - Pipecat: no native id; the integration mints one (see [Pipecat ids](#pipecat-ids)).
  - Minted only by the integration:
    - the LiveKit `speech_id` itself (already unique and prefixed `speech_`, from `shortuuid("speech_")` in `SpeechHandle`) for assistant speech that never got an item;
    - `vad_<seq>` for uncommitted user speech.
- **User message → LLM step:** the first LLM span whose `voice.context_message_ids` contains the message id ("heard by"), inferred by Lingua.
- **Assistant message → LLM step:** `produced_by_span_id`, mirrored by `voice.output_message_id` on that span.
- **Message → audio:** `selections`, on channel 0 for the user and channel 1 for the assistant.
- **Message → tools:** indirect. A tool call is a separate context entry with its own id in `voice.context_message_ids`. Tool spans keep their existing `gen_ai.tool.call.id` and `contrib.livekit.request_span_id` links.
- **Turn spans:** optional. Lingua does not need them.

## Message grain

- **User message:** takes **every** VAD interval that ended after the previous user commit and before its own commit, excluding intervals already written as uncommitted. LiveKit and Pipecat merge speech fragments separated by short pauses into one item, so one user message can have several `selections` ranges. `start_ms`/`end_ms` are the outer bounds.
- **Assistant message:** takes only its own speech's playout interval, the audio played for that `SpeechHandle` (LiveKit) or TTS context (Pipecat), not the whole agent turn. A turn with a tool filler and a later answer yields two assistant messages.

`examples/cascaded.json` shows a merged fragment: `item_u1` has two ranges, 300–1250 and 1650–2900, because the caller paused for 400 ms after "Hi,".

## Assistant spoken text

The same rule applies in cascaded and realtime pipelines:

- **Spoken `text`:** the text aligned to the audio that actually played, with `text_source: "playout_aligned"`.
  - LiveKit: `playbackFinished.synchronizedTranscript` (content mode).
  - Pipecat: the `TTSTextFrame`s that passed the output transport before `InterruptionFrame` or `BotStoppedSpeakingFrame`. This counts as `playout_aligned` only when the TTS service is word-timestamped.
- **`generated_text`:** the full generated text, set only when it differs from `text`.
  - Cascaded: the TTS input.
  - Realtime: that item's output transcript.
- **While `open`:** the assistant entry omits `text` until playout ends. Partial spoken text is never written. `text_status` is `missing` (or `not_captured` with capture off) until then, and its final value is set when playout ends.
- **Fallback:** when there is no aligned text (no synchronized transcript, or TTS without word timestamps), `text` is the generated text. `text_source` is then `tts_input` (cascaded) or `realtime_output_transcript` (realtime), meaning it may overstate what was heard, and `generated_text` is omitted.

All examples use `playout_aligned`; none show the fallback.

## Uncommitted user speech

A VAD interval becomes an uncommitted entry only when all of these hold:

1. VAD stopped;
2. the uncommitted-speech timeout passed without any user item being added (`UNCOMMITTED_SPEECH_TIMEOUT_MS`, default 5000; it must exceed the framework's longest end-of-turn delay);
3. no end-of-turn decision is in progress for it. If one starts, the timer waits for it to finish. If `userTurnCompleted` finishes and no item was added, the entry is written at once.

Until then the interval stays in memory, and a later user item takes it under [Message grain](#message-grain). The written entry is `committed: false`, `role: "user"`, `state: "complete"`, `text_status: "missing"` (or `"not_captured"`), with no `text`, the VAD bounds and selections, and id `vad_<seq>`. It is never upgraded, and later user items do not take its interval.

Sources the MVP uses:

| Integration      | VAD start/stop                                                                                                                         | End-of-turn in progress                                                       | Item added                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| LiveKit cascaded | native `user_speaking` span start/end (already seen by `LiveKitSpanProcessor`)                                                         | `AgentActivity.onEndOfTurn` … `AgentActivity.userTurnCompleted` (both hooked) | `AgentSession._conversationItemAdded` (hooked)                                                              |
| LiveKit realtime | `input_speech_started` / `input_speech_stopped` receipt (already observed in `realtime.ts`)                                            | none: server turn detection has no commit event                               | new user item in `realtimeSession.chatCtx.items` at `_realtimeGenerationTaskImpl` entry (chat-context diff) |
| Pipecat cascaded | `UserStartedSpeakingFrame` / `UserStoppedSpeakingFrame` (already handled by the observer)                                              | none observed                                                                 | user aggregator push                                                                                        |
| Pipecat realtime | **dropped in the MVP**: speech the provider never commits has no item and no guaranteed provider event pairing in the realtime service | —                                                                             | —                                                                                                           |

## Tool-only and cancelled speech

LiveKit creates a new `SpeechHandle` for each reply, including each reply after a tool call. An LLM step that only calls a tool therefore gets a speech record with no generated text and no audio.

- **Never written:** a speech record with no generated text and no played audio. Its `seq` is a gap. In the examples, the `find_slots` and `reschedule` steps leave gaps at seq 1 and 4.
- **`unplayed`:** only for speech that has generated text but no played audio. `text` is the generated text (`tts_input`), and `selections` is empty.
- **`interrupted`:** speech that played some audio before stopping.
- **Committed or not:** a cancelled assistant speech that never entered the chat context is `committed: false`, with `unplayed` or `interrupted`. LiveKit adds an interrupted reply to the context, so that one is `committed: true`.

## Timing semantics

- `start_ms`/`end_ms` and `selections` describe the same audible intervals.
  - **Selections:** what playback uses. They are clipped to ready segments and are empty if audio is unavailable.
  - **`start_ms`/`end_ms`:** survive audio loss.
- **User bounds:** VAD or provider speech events, mapped to call ms by `event_time_unix_ms - voice.origin_unix_ms`. That mapping is arrival time, not sample time; `timing_source` says which. Only `provider_events` carries the provider's own audio ms.
- **Assistant bounds:** local playout (`playbackStarted`/`playbackProgressed`/`playbackFinished`), not generation. Generation timing stays on LLM and TTS spans.
- **Derived values, computed by the app and stored by neither the SDK nor Lingua:**
  - **Response latency:** next assistant `start_ms` − user `end_of_turn_ms`.
  - **End-of-turn delay:** `end_of_turn_ms` − user `end_ms`.
  - **Transcript lag:** `transcript_final_ms` − `end_ms`.
  - **Overlap:** any intersection of a user and an assistant interval.
  - **Transcript after reply:** `transcript_final_ms` later than the start of the LLM step that heard the message.

## What integrations capture and when

### LiveKit (JS)

Citations are to `@livekit/agents` 1.9.2 `src/` (`AA` = `voice/agent_activity.ts`). Hooks marked "hooked" are already instrumented on the base branch.

**User message:**

- **Record:** a pending in-memory record (seq assigned) is created at the first VAD interval.
  - Cascaded: native `user_speaking` start.
  - Realtime: `input_speech_started`, subscribed at `AA:895`.
- **Bounds and selections, cascaded:** grow from each VAD interval and from `EndOfTurnInfo.startedSpeakingAt`/`stoppedSpeakingAt` (`onEndOfTurn`, `AA:2690`, hooked). `timing_source: "vad_events"`.
- **Bounds and selections, realtime:**
  - `input_speech_started`/`input_speech_stopped` carry no provider times; `InputSpeechStoppedEvent` is `{userTranscriptionEnabled}` (`llm/realtime.ts:16`). Bounds are therefore the **local receipt times**, with `timing_source: "local_receipt"`.
  - The end includes the provider's server-VAD silence padding. The integration subtracts it only if it is given the silence setting through its own config (the realtime plugin's turn-detection option, passed through). Otherwise nothing is subtracted.
  - Provider-ms timing (`provider_events`) is available only to integrations that see raw provider events, such as Pipecat with OpenAI.
- **`end_of_turn_ms`:**
  - **Cascaded:** `onEndOfTurn` entry.
  - **Realtime with server turn detection:** there is no commit event, because `userTurnCompleted` returns early when `capabilities.turnDetection` is set (`AA:3275`, `AA:3302`). So `end_of_turn_ms` is the entry of `_realtimeGenerationTaskImpl` (`AA:4496`, hooked) for the generation that answers the user input.
- **Id and commit:**
  - **Cascaded:** at `_conversationItemAdded` (hooked) for the user item.
  - **Realtime:** LiveKit adds the user item to the agent's chat context only when a non-empty final transcript arrives (`onInputAudioTranscriptionCompleted`, `AA:2021`; insert and `_conversationItemAdded` at `AA:2053`). So at `_realtimeGenerationTaskImpl` entry, the integration diffs `realtimeSession.chatCtx.items` against the previous snapshot. It pairs the oldest new user item with the oldest open user record. That sets the id and `committed: true` even when the transcript never arrives.
- **Text and `transcript_final_ms`:**
  - **Cascaded:** text is the item's `textContent` at `_conversationItemAdded`. `transcript_final_ms` comes from the AgentSession `user_input_transcribed` event with `isFinal` (`voice/events.ts:26`). The base branch does not subscribe to it yet; add a listener at `_startImpl`.
  - **Realtime:** `input_audio_transcription_completed` (`AA:898`) with `isFinal`. A non-final event gives `partial`.

**Realtime transcript deadline:** the first response that heard the item is the first `_realtimeGenerationTaskImpl` whose context includes it. If no final transcript arrives before the next response after that one is created, or before session close, `text_status` becomes `missing`. A later `input_audio_transcription_completed` still upgrades it to `final` and sets `transcript_final_ms` to its arrival.

**Assistant message:**

- **Record:** keyed by `speechHandle.id`.
  - The handle is `stateLease.speechHandle`, the argument of `_pipelineReplyTaskImpl` (`AA:3747`, run inside `withAgentTurn(stateLease.speechHandle, …)` at `AA:4436`) or `_realtimeGenerationTaskImpl` (`AA:4474`/`AA:4496`), both hooked. Seq is assigned at that entry.
  - Each tool continuation runs its own reply task with its own handle.
  - The turn-level `lk.speech_id` span attribute is shared across tool continuations, so it is **not** used.
- **`produced_by_span_id`:** the `llm_response` span started inside that handle's reply task, or the latest one before playback start if there are several.
  - Cascaded: the `llm_node` span.
  - Realtime: the `realtime_inference` span created at `AA:4478`, exported as `llm_response` (type `llm`).
- **Playout:** `playbackStarted` / `playbackFinished {playbackPosition, interrupted, synchronizedTranscript}` (`voice/io.ts:118`, `voice/io.ts:292`) fill bounds, selections, `state`, `interrupted_at_ms` and `text` per [Assistant spoken text](#assistant-spoken-text).
  - These events carry no speech id. The integration attributes them to `activity.currentSpeech` (`AA:1168`) at the first `captureFrame`/`playbackStarted` of each segment.
  - The playback hook is installed independently of audio capture, so calls without audio still get agent bounds.
- **Becomes `item.id`:** at reply-task entry the integration wraps that handle's `_itemAdded` (`voice/speech_handle.ts:741`). LiveKit calls it with the assistant message right before `_conversationItemAdded` (`AA:4272`, `AA:4312` pipeline; `AA:4826` realtime).
  - The wrapper ties the item id to the record directly, with no reliance on `currentSpeech`, which may already point at a newer handle.
  - This is a per-instance wrapper on an object the existing hook already receives, not a new Orchestrion hook.
- **No item:** if the handle finishes without an item (cancelled before entering the chat context), the record is written with `committed: false`, keyed by its `speechHandle.id`, but only if it has generated text or played audio. See [Tool-only and cancelled speech](#tool-only-and-cancelled-speech).

**Realtime pairing:**

- Each `messageStream` entry of a realtime generation (`ev.responseId`, `{messageId, textStream}`; LiveKit's view of the provider's `response.output_item.added`) pairs `messageId` (the item id) with `responseId` and the generation's `realtime_inference` span.
- `source_ids["openai.response_id"]` is `responseId`.
- `generated_text` is the concatenated `textStream` of **that** `messageId` only. It is set only when it differs from the spoken `text`, and it is the fallback `text` when no synchronized transcript exists.
- **`provider_audio_end_ms`** means "truncate sent to the provider".
  - LiveKit sends `realtimeSession.truncate({messageId, audioEndMs})` only when the reply was interrupted and `capabilities.messageTruncation` is on (`AA:4789`).
  - `audioEndMs = floor(playbackPosition * 1000)`, the same local playback position, so for LiveKit it always equals `interrupted_at_ms − start_ms`.
  - The integration records it only in that case.

**LLM span links:**

- `voice.context_message_ids` is read directly from item ids, outside the PII attribute path, so it works with content capture off.
  - **Cascaded:** from `chatCtx.items` at `performLLMInference` (hooked). The instructions are a real chat item with id `lk.agent_task.instructions` (`voice/generation.ts:465`, inserted at `voice/generation.ts:485`), so they are listed by that id, not as `null`.
  - **Realtime:** from `realtimeSession.chatCtx.items` at `_realtimeGenerationTaskImpl` entry. Realtime instructions are session configuration, not chat items, so they are **not listed**.
  - **Manual `wrapLiveKitSession` path:** read the chat context from `llmNode` `args[0]` (`voice/agent.ts:404`).
- **`input`:** the integration logs `input` with one message per chat item, in the same order as the ids.
  - This is a **customer-visible change** for realtime. Today `RealtimeObserver.captureInput` (`realtime.ts`) rewrites session-context items with grouped caller transcripts, and appends transcripts that have no item yet as extra user messages. Under this option, a late transcript only fills its own item's text, and nothing is appended. Turns that today show appended caller text show an empty user message until the item's transcript arrives.
- `voice.output_message_id` is set when the reply item commits.

**Content capture off:**

- `voice.messages` and `voice.context_message_ids` are still written.
- Only `text` and `generated_text` are dropped, with `text_status: "not_captured"`.
- The current `processor.conversation()` returns early when capture is off; the voice writer must not.

### Pipecat (Python; sketch, frames named here are already handled by the current observer unless marked)

- **User message:**
  - `UserStartedSpeakingFrame` / `UserStoppedSpeakingFrame` give the VAD intervals.
  - A final `TranscriptionFrame` gives `text` and `transcript_final_ms`.
  - The user aggregator's push of the context (`LLMContextFrame`) is the commit.
- **Assistant message:**
  - A record per TTS `context_id`, created at `TTSStartedFrame`; seq is assigned then.
  - At TTS start the integration records `context_id` → the most recent LLM span (opened at `LLMFullResponseStartFrame`) whose output feeds that TTS context. That span may already have ended, since TTS can start after the LLM response finished. That span becomes `produced_by_span_id`, and it gets `voice.output_message_id` once the id is known.
  - Bounds come from output-transport writes.
  - Spoken `text` follows [Assistant spoken text](#assistant-spoken-text), from `TTSTextFrame`s that passed the output transport.
  - Interruption comes from `InterruptionFrame` (not handled today; must be added).
  - `generated_text` comes from the LLM span output, because the assistant aggregator truncates the stored message.
  - The record gets its `msg_<uuid>` id (see [Pipecat ids](#pipecat-ids)) when the assistant aggregator appends the assistant message to the context. That append sets `committed: true`. A context that ends without an append is written under `context_id`, following [Tool-only and cancelled speech](#tool-only-and-cancelled-speech).
- **Realtime** (OpenAI Realtime events through the realtime service; new handling):
  - pairing by `response.output_item.added` (`response_id`, `item.id`);
  - `generated_text` from `response.audio_transcript.done` for that `item_id`. Spoken `text` comes from the provider text frames that passed the output transport, by the same rule as cascaded, with `realtime_output_transcript` as the fallback;
  - ids, commit and the LLM span pairing work as in cascaded, with the response span in place of the LLM span;
  - user transcript from `conversation.item.input_audio_transcription.completed`;
  - the same deadline rule as LiveKit realtime;
  - user bounds from the provider's `input_audio_buffer.speech_started`/`speech_stopped` `audio_start_ms`/`audio_end_ms`, with `timing_source: "provider_events"`, when the integration observes the raw provider events. Those bounds exclude the silence padding. Otherwise it uses local receipt, as LiveKit does;
  - `provider_audio_end_ms` from the integration's own observation of the `conversation.item.truncate` it sends. This is independent of local playout, so here it can disagree with `interrupted_at_ms − start_ms`.
- **`voice.context_message_ids`:** the id list from [Pipecat ids](#pipecat-ids) at each `LLMContextFrame` / `response.create`.

### Pipecat ids

Pipecat context messages are plain dicts with no id.

- **Id list:** the integration keeps a list of ids parallel to the context's message indices, with one minted `msg_<uuid>` per message. It is synced on every aggregator append.
- **Context rewrites** (truncation, summarization, `set_messages`): the list is re-mapped by an **in-memory** hash of each message's role and content. The hash is never logged. Unmatched messages get new ids.
- **Duplicates:** messages with identical role and content map in order.

## What Lingua records vs infers

- **Records as logged:** every `VoiceMessage` field except `turn_span_id` and `source_ids`, which are intentionally omitted from the Trajectory. Times are converted to wall-clock `DateTime` with `voice.origin_unix_ms`. `provider_audio_end_ms` stays as a number.
- **Infers:**
  - each user message's step (first LLM span that heard it) and its Trajectory turn (`request_id`);
  - message order (`start_ms`, then `seq`);
  - the existing `VoiceCall.speech` list, built from messages so #22034 and #22036 keep working.
- **Does not store:** the derived values listed under [Timing semantics](#timing-semantics). The app computes them.
- **Never infers:** text from audio, or audio bounds from text.
- **Warnings:**
  - a call has messages but no LLM span carries `voice.context_message_ids`;
  - the ids array and `input` differ in length (checked only when `input` is present);
  - see the Lingua spec for the rest.

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

`examples/cascaded.json` and `examples/realtime.json` encode the shared scenario (`notes/scenario.md`: dental-clinic reschedule with a `find_slots` → `reschedule` tool chain and a barge-in). One deviation: the realtime second turn uses the same 500 ms server-VAD silence as the first, so `input_speech_stopped` arrives at 9000 and `reschedule` is called at 9150 rather than the scenario's 8900.

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
        "end_offset_ms": 1250,
        "channel_index": 0
      },
      {
        "recording_span_id": "c-root",
        "recording_id": "call-0000",
        "start_offset_ms": 1650,
        "end_offset_ms": 2900,
        "channel_index": 0
      }
    ]
  },
  "item_a1": {
    "role": "assistant",
    "seq": 2,
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
    "selections": [
      {
        "recording_span_id": "c-root",
        "recording_id": "call-0000",
        "start_offset_ms": 5300,
        "end_offset_ms": 7900,
        "channel_index": 1
      }
    ]
  }
}
```

`c-llm2.metadata` has `"voice.context_message_ids": ["lk.agent_task.instructions", "item_u1", "item_fc1", "item_fco1"]` and `"voice.output_message_id": "item_a1"`.

| What differs in realtime (`r-root`) | Cascaded                                                                               | Realtime                                                                                                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User transcript                     | `stt`, final at 3450, before the LLM ran                                               | `realtime_input_transcription`, final at **4300**, after the model already called `find_slots` at 4100. `r-llm1.input` shows `""` for the user message, but its id is in `voice.context_message_ids`.                                                        |
| Barge-in transcript                 | `"Nine thirty works."`                                                                 | `text_status: "missing"` with `text_source: "realtime_input_transcription"` and no `text`, marked when `r-llm4` was created. Audio and bounds are still present, so the customer can hear it.                                                                |
| Interruption                        | `interrupted_at_ms: 7900`                                                              | `interrupted_at_ms: 7900` and `provider_audio_end_ms: 2900`: the truncate LiveKit sent, which equals the played position (7900 − 5000). LiveKit cannot show a provider/playout disagreement.                                                                 |
| Assistant pairing                   | `item_a1` ← speech `speech_1` ← `c-llm2`                                               | `item_rt_a1` ← `messageId` of response `resp_2` ← `r-llm2`                                                                                                                                                                                                   |
| Assistant text                      | `text` from `synchronizedTranscript` (`playout_aligned`); `generated_text` = TTS input | `text` from `synchronizedTranscript` (`playout_aligned`); `generated_text` = the item's output transcript                                                                                                                                                    |
| Steps                               | separate `llm_response` + `tts` spans                                                  | one `llm_response` per realtime response; no TTS or STT spans                                                                                                                                                                                                |
| Turn spans                          | `user_turn`/`assistant_turn` present (`turn_span_id`)                                  | only `assistant_turn`; no `turn_span_id`. Nothing depends on turns.                                                                                                                                                                                          |
| Context and input                   | `lk.agent_task.instructions` first, then one id per item                               | no instructions entry; `input` has no system message, one message per session item                                                                                                                                                                           |
| Fragments                           | `item_u1` has two VAD ranges                                                           | single range per user item                                                                                                                                                                                                                                   |
| User end of turn                    | `end_ms` 2900 (VAD), `end_of_turn_ms` 3400 (`onEndOfTurn`), `transcript_final_ms` 3450 | `end_ms` 3400: the `input_speech_stopped` receipt, `local_receipt`, including about 500 ms of server-VAD silence because the integration was not given the setting. `end_of_turn_ms` 3600 (`_realtimeGenerationTaskImpl` for `r-llm1`). Turn 2 ends at 9000. |
| Seq gaps                            | 1 and 4: the tool-only speech of `c-llm1` and `c-llm3` is never written                | 1 and 4: the tool-only responses `r-llm1` and `r-llm3`                                                                                                                                                                                                       |

## Customer usefulness

| Need                          | How well | Notes                                                                                                                                                                                                                                                    |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What was said                 | strong   | One record per message with spoken versus generated text and a transcript source.                                                                                                                                                                        |
| Play matching audio           | strong   | Selections are keyed by the same id the thread view renders, so no time-based guessing.                                                                                                                                                                  |
| Diagnose delays               | medium   | End-of-turn delay, transcript lag and response latency come from message fields. Per-stage STT/LLM/TTS timing still needs the step spans. Nothing records why a gap happened.                                                                            |
| Interruptions and overlap     | medium   | `interrupted_at_ms`, `generated_text` and overlapping intervals. Uncommitted speech is visible (LiveKit and Pipecat cascaded). But an interruption is a property of the interrupted message only: what caused it is inferred from overlap, not recorded. |
| Follow tools                  | medium   | Tools sit between messages through the existing LLM and tool spans and context ids. A filler phrase spoken during a tool call ("let me check") is just another assistant message, which is fine.                                                         |
| Missing or uncertain evidence | strong   | `text_status`, `text_source`, `timing_source`, `committed`, `open`, empty `selections`, and the truncate point sent to the provider.                                                                                                                     |

## Edge cases and weaknesses

- **Barge-in truncation:** handled (`text` vs `generated_text`, `interrupted_at_ms`). Pipecat's assistant aggregator truncates the stored message, so `generated_text` must come from the LLM span output.
- **Overlap:** intervals overlap freely. The app must pick which message to highlight; #22036's "latest start wins" rule still works.
- **Late or missing realtime transcript:** late updates rewrite the whole entry, and `missing` can upgrade to `final`. The upgrade also sets `transcript_final_ms` to the late arrival time. An LLM span logged before the transcript shows empty user text, and the id still links it.
- **Uncommitted speech:**
  - Visible only after the timeout. A call that ends inside the timeout writes pending intervals as uncommitted at close.
  - The MVP drops it for Pipecat realtime.
  - It has no text by design.
- **Failed or omitted segments:** `selections` is empty or partial. `start_ms`/`end_ms` still place the message, and recording omission reasons stay in `audio.recordings`.
- **Unknown clock offset:** if the recording started late, its descriptor origin differs from `voice.origin_unix_ms`. Lingua uses the descriptor timeline for selections and `voice.origin_unix_ms` for `*_ms`, and warns when they differ by more than 1 ms. The contract does not say how large an offset is acceptable.
- **Call in progress:** entries with `state: "open"`. Lingua shows them without a step link if no LLM span has heard them yet.
- **Content capture off:** `text_status: "not_captured"`. Ids, timing and audio remain, because context ids are read from `chatCtx.items` directly.
- **Tool cancelled by interruption:** the cancelled tool span ends with an error. The partially spoken assistant message is `interrupted`; speech that never got an item is keyed by its `speech_id`. Nothing records "this tool was cancelled because of that barge-in"; that is inferred from timing.
- **Agent handoff:** messages stay keyed per call, and `produced_by_span_id` points into the new agent's spans. Per-agent attribution is inferred from the span tree. The capture rules (cascaded or realtime) are chosen by the pipeline at call start. A handoff that switches between a cascaded LLM and a realtime model mid-call is out of MVP scope.
- **Provider/playout disagreement:** LiveKit's truncate is derived from local playout, so the two never differ there. A Pipecat realtime integration that sees the provider's own events can record a different `provider_audio_end_ms`. That is the only place a disagreement is observable.
- **Large calls:** one root metadata map grows with call length (about 1 KB per message). Every write re-sends one whole entry, and the row stores the merged map. A 30-minute call stays well under 1 MB, but this is the main scaling cost.
- **Pipecat context rewrites:** summarization replaces messages with new content, so new ids are minted. The thread then shows the summary as a message with no audio, which is correct but loses the link back to the original speech.

## Implementation starting point

1. **Accumulator.** Add a call-scoped `VoiceMessages` accumulator: one record per message with forward-only setters, and `flush(id)` logging the whole entry to the call span.
2. **User records.** Create user records from VAD (native `user_speaking`, realtime `input_speech_*`). Move them to `item.id` at `_conversationItemAdded`, and add the uncommitted timer.
3. **Assistant records.** Create assistant records keyed by speech id at `_pipelineReplyTaskImpl` / `_realtimeGenerationTaskImpl`, and fill them from `playback.ts` events.
4. **Audio selections.** Re-target selection publishing: the publisher's `TurnSelection.span.log` adapter writes the record's full `selections` through the accumulator instead of `audio.selections` on turn spans.
5. **LLM span links.** Read `chatCtx.items` ids at `performLLMInference` and `_realtimeGenerationTaskImpl`, outside the content gate, and log `voice.context_message_ids`. Log `voice.output_message_id` at reply commit.
6. **Realtime.** Pair `messageStream` items with `responseId`, and apply the transcript deadline.
7. **Pipecat.** Port the steps above to the Python observer, with the id list described in [Pipecat ids](#pipecat-ids).
8. **Lingua.** Follow `specs/voice-schema-message-audio.md`.

## Open questions

- Should `voice.messages` live on the call span, as here, or on each message's owning turn span? The call span is simpler for Lingua and is header-only. Turn spans keep rows small but need a lookup across spans.
- Is `UNCOMMITTED_SPEECH_TIMEOUT_MS = 5000` safe for every LiveKit end-of-turn configuration, or should it read the session's endpointing settings? Pipecat has no signal that an end-of-turn decision is in progress, so there the timeout alone must exceed the turn analyzer's longest wait.
- Should `end_of_turn_ms` move to the assistant message as `responding_to_end_ms`, to make latency explicit per reply?
