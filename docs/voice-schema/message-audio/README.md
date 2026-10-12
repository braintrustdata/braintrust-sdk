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
| `voice.messages`       | `Record<message_id, VoiceMessage>` | required | One entry per spoken or heard message. See [Writing entries](#writing-entries). Written whether or not content capture is on.                                 |

### `VoiceMessage`

All `*_ms` fields are **call ms**: milliseconds since `voice.origin_unix_ms` on the recording clock. The one exception is `provider_audio_end_ms`.

| Field                   | Type                                                                                                | Req.     | Meaning                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `role`                  | `"user" \| "assistant"`                                                                             | required | Speaker. User audio is channel 0, assistant audio channel 1.                                                                                                                                                       |
| `seq`                   | int                                                                                                 | required | Assigned when the integration first creates the in-memory record. Unique and increasing within a call; gaps are allowed for records that were merged and never written. It is the tiebreak when times are missing. |
| `committed`             | boolean                                                                                             | required | Whether the message entered the agent's conversation context. `false` only for uncommitted user speech, see [Uncommitted user speech](#uncommitted-user-speech).                                                   |
| `state`                 | `complete \| interrupted \| unplayed \| open`                                                       | required | `interrupted` and `unplayed` are assistant-only. `unplayed` means generated but never played. `open` means still in progress at the last write.                                                                    |
| `text`                  | string                                                                                              | optional | What was said: the user's final or partial transcript, or the assistant's spoken text. Present iff `text_status` is `final` or `partial`.                                                                          |
| `text_status`           | `final \| partial \| missing \| not_captured`                                                       | required | `missing` means no transcript arrived by the deadline (a later arrival may still upgrade it to `final`). `not_captured` means content capture is off.                                                              |
| `text_source`           | `stt \| realtime_input_transcription \| tts_input \| playout_aligned \| realtime_output_transcript` | optional | Where `text` came from, or would have come from when `text_status` is `missing`. `tts_input` means the text was sent to TTS but playout was not aligned, so it may overstate what was heard.                       |
| `generated_text`        | string                                                                                              | optional | Assistant only, set when the full generated text differs from `text` (interruption).                                                                                                                               |
| `start_ms`, `end_ms`    | number                                                                                              | optional | Outer bounds of the message's audible speech.                                                                                                                                                                      |
| `timing_source`         | `vad_events \| provider_events \| playout_events`                                                   | optional | How the bounds were observed.                                                                                                                                                                                      |
| `end_of_turn_ms`        | number                                                                                              | optional | User only: when the agent decided the user had finished.                                                                                                                                                           |
| `transcript_final_ms`   | number                                                                                              | optional | User only: when the final transcript reached the agent.                                                                                                                                                            |
| `interrupted_at_ms`     | number                                                                                              | optional | Assistant only, required when `state` is `interrupted`: where local playout stopped.                                                                                                                               |
| `provider_audio_end_ms` | number                                                                                              | optional | Assistant realtime only: the provider's truncation point, **relative to the item's own audio start**, copied as reported and never converted.                                                                      |
| `selections`            | `Selection[]`                                                                                       | required | `@braintrust/audio` selections (segment-local ms, `recording_span_id` = call span), always the full current array. Empty while segments are pending or when audio is omitted.                                      |
| `produced_by_span_id`   | string                                                                                              | optional | Assistant only: the LLM span that generated the message.                                                                                                                                                           |
| `turn_span_id`          | string                                                                                              | optional | The turn span, if the integration emits one. Debugging aid only; Lingua ignores it.                                                                                                                                |
| `source_ids`            | `Record<string,string>`                                                                             | optional | Native ids, for example `livekit.item_id`, `livekit.speech_id`, `openai.item_id`, `openai.response_id`, `pipecat.context_id`. Debugging aid only; Lingua ignores it.                                               |

### LLM spans (`type: "llm"`)

| Key                         | Type                 | Req.                                       | Meaning                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice.context_message_ids` | `(string \| null)[]` | optional, expected on every voice LLM span | The model's context items in order: each item's id, or `null` for an input that is not a context item, such as instructions passed outside the chat context. Captured whether or not content capture is on. When content is captured, the integration logs `input` with one message per context item in the same order, so the two arrays line up. |
| `voice.output_message_id`   | string               | optional                                   | The message this call produced, if it produced spoken text. It must equal that message's `produced_by_span_id` back-link.                                                                                                                                                                                                                          |

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

## Uncommitted user speech

A VAD interval becomes an uncommitted entry only when all of these hold:

1. VAD stopped;
2. the uncommitted-speech timeout passed without any user item being added (`UNCOMMITTED_SPEECH_TIMEOUT_MS`, default 5000; it must exceed the framework's longest end-of-turn delay);
3. no end-of-turn decision is in progress for it. If one starts, the timer waits for it to finish. If `userTurnCompleted` finishes and no item was added, the entry is written at once.

Until then the interval stays in memory, and a later user item takes it under [Message grain](#message-grain). The written entry is `committed: false`, `role: "user"`, `state: "complete"`, `text_status: "missing"` (or `"not_captured"`), with no `text`, the VAD bounds and selections, and id `vad_<seq>`. It is never upgraded, and later user items do not take its interval.

Sources the MVP uses:

| Integration      | VAD start/stop                                                                                              | End-of-turn in progress                                                       | Item added                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| LiveKit cascaded | native `user_speaking` span start/end (already seen by `LiveKitSpanProcessor`)                              | `AgentActivity.onEndOfTurn` … `AgentActivity.userTurnCompleted` (both hooked) | `AgentSession._conversationItemAdded` (hooked) |
| LiveKit realtime | `input_speech_started` / `input_speech_stopped` on the realtime session (already observed in `realtime.ts`) | none: the provider commits or not                                             | `_conversationItemAdded`                       |
| Pipecat cascaded | `UserStartedSpeakingFrame` / `UserStoppedSpeakingFrame` (already handled by the observer)                   | none observed                                                                 | user aggregator push                           |
| Pipecat realtime | **dropped in the MVP**: no confirmed speech-start/stop signal that is separate from item creation           | —                                                                             | —                                              |

## Timing semantics

- `start_ms`/`end_ms` and `selections` describe the same audible intervals.
  - **Selections:** what playback uses. They are clipped to ready segments and are empty if audio is unavailable.
  - **`start_ms`/`end_ms`:** survive audio loss.
- **User bounds:** VAD or provider speech events, mapped to call ms by `event_time_unix_ms - voice.origin_unix_ms`. That mapping is arrival time, not sample time; `timing_source` says which.
- **Assistant bounds:** local playout (`playbackStarted`/`playbackProgressed`/`playbackFinished`), not generation. Generation timing stays on LLM and TTS spans.
- **Derived values, computed by the app and stored by neither the SDK nor Lingua:**
  - **Response latency:** next assistant `start_ms` − user `end_of_turn_ms`.
  - **End-of-turn delay:** `end_of_turn_ms` − user `end_ms`.
  - **Transcript lag:** `transcript_final_ms` − `end_ms`.
  - **Overlap:** any intersection of a user and an assistant interval.
  - **Transcript after reply:** `transcript_final_ms` later than the start of the LLM step that heard the message.

## What integrations capture and when

### LiveKit (JS; hooks named here are already instrumented on the base branch)

**User message:**

- **Record:** a pending in-memory record (seq assigned) is created at the first VAD interval (native `user_speaking` start, or realtime `input_speech_started`).
- **Bounds and selections:** grow from each VAD interval and from `EndOfTurnInfo.startedSpeakingAt`/`stoppedSpeakingAt` (`onEndOfTurn`).
- **`end_of_turn_ms`:**
  - cascaded: `onEndOfTurn` entry;
  - realtime: `input_speech_stopped`.
- **Text:**
  - cascaded: the item's `textContent` at `_conversationItemAdded`; `transcript_final_ms` is that time;
  - realtime: `input_audio_transcription_completed` with `isFinal`. A non-final event gives `partial`.
- **Becomes `item.id`:** at `_conversationItemAdded` for a user item.

**Realtime transcript deadline:** the first response that heard the item is the first `_realtimeGenerationTaskImpl` whose context includes it. If no final transcript arrives before the next response after that one is created, or before session close, `text_status` becomes `missing`. A later `input_audio_transcription_completed` still upgrades it to `final`.

**Assistant message:**

- **Record:** a pending record keyed by speech id, created when the `SpeechHandle` first appears at `_pipelineReplyTaskImpl` or `_realtimeGenerationTaskImpl` entry (both hooked; add `id` to the vendored `SpeechHandle` type). Seq is assigned then.
- **Playout:** `playbackStarted` / `playbackProgressed` / `playbackFinished {playbackPosition, interrupted, synchronizedTranscript}` (observed in `playback.ts`) fill bounds, selections, `state`, `interrupted_at_ms` and `text` (`playout_aligned`).
- **Becomes `item.id`:** when `_conversationItemAdded` fires for that speech's assistant item.
- **No item:** if the speech ends without an item (cancelled before commit), the record is written as `unplayed` (or `interrupted`, if any audio played) keyed by its `speech_id`.

**Realtime pairing:**

- Each `messageStream` entry of a realtime generation (`ev.responseId`, `{messageId, textStream}`; LiveKit's view of the provider's `response.output_item.added`) pairs `messageId` (the item id) with `responseId` and the `realtime_inference` span.
- `produced_by_span_id` is that span, and `source_ids["openai.response_id"]` is `responseId`.
- `generated_text` is the concatenated `textStream` of **that** `messageId` only, which corresponds to the provider's `response.audio_transcript.done` for that item.
- `provider_audio_end_ms` is the `audio_end_ms` of the provider truncate for that item, when LiveKit exposes it. Otherwise it is omitted.

**LLM span links:**

- `voice.context_message_ids` is read directly from `chatCtx.items` (`id` of each item) at `performLLMInference` (cascaded) and from `realtimeSession.chatCtx.items` at `_realtimeGenerationTaskImpl` (realtime).
- This is outside the PII attribute path, so it works with content capture off.
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
  - A record per TTS `context_id`, created at `TTSStartedFrame`.
  - Bounds come from output-transport writes.
  - Interruption comes from `InterruptionFrame` (not handled today; must be added).
  - `generated_text` comes from the LLM span output, because the assistant aggregator truncates the stored message.
- **Realtime** (OpenAI Realtime events through the realtime service; new handling):
  - pairing by `response.output_item.added` (`response_id`, `item.id`);
  - `generated_text` from `response.audio_transcript.done` for that `item_id`;
  - user transcript from `conversation.item.input_audio_transcription.completed`;
  - the same deadline rule as LiveKit realtime.
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

`c-llm2.metadata` has `"voice.context_message_ids": [null, "item_u1", "item_fc1", "item_fco1"]` and `"voice.output_message_id": "item_a1"`.

| What differs in realtime (`r-root`) | Cascaded                                              | Realtime                                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User transcript                     | `stt`, final at 3450, before the LLM ran              | `realtime_input_transcription`, final at **4300**, after the model already called `find_slots` at 4100. `r-llm1.input` shows `""` for the user message, but its id is in `voice.context_message_ids`. |
| Barge-in transcript                 | `"Nine thirty works."`                                | `text_status: "missing"` with `text_source: "realtime_input_transcription"` and no `text`, marked when `r-llm4` was created. Audio and bounds are still present, so the customer can hear it.         |
| Interruption                        | `interrupted_at_ms: 7900`                             | `interrupted_at_ms: 7900` (local playout) **and** `provider_audio_end_ms: 2600` (item-relative; provider thought it stopped at 7600 call ms). The 300 ms disagreement stays visible.                  |
| Assistant pairing                   | `item_a1` ← speech `speech_1` ← `c-llm2`              | `item_rt_a1` ← `messageId` of response `resp_2` ← `r-llm2`                                                                                                                                            |
| Steps                               | separate `llm_response` + `tts` spans                 | one `llm_response` per realtime response; no TTS or STT spans                                                                                                                                         |
| Turn spans                          | `user_turn`/`assistant_turn` present (`turn_span_id`) | only `assistant_turn`; no `turn_span_id`. Nothing depends on turns.                                                                                                                                   |
| Fragments                           | `item_u1` has two VAD ranges                          | single range per user item                                                                                                                                                                            |

## Customer usefulness

| Need                          | How well | Notes                                                                                                                                                                                                                                                    |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What was said                 | strong   | One record per message with spoken versus generated text and a transcript source.                                                                                                                                                                        |
| Play matching audio           | strong   | Selections are keyed by the same id the thread view renders, so no time-based guessing.                                                                                                                                                                  |
| Diagnose delays               | medium   | End-of-turn delay, transcript lag and response latency come from message fields. Per-stage STT/LLM/TTS timing still needs the step spans. Nothing records why a gap happened.                                                                            |
| Interruptions and overlap     | medium   | `interrupted_at_ms`, `generated_text` and overlapping intervals. Uncommitted speech is visible (LiveKit and Pipecat cascaded). But an interruption is a property of the interrupted message only: what caused it is inferred from overlap, not recorded. |
| Follow tools                  | medium   | Tools sit between messages through the existing LLM and tool spans and context ids. A filler phrase spoken during a tool call ("let me check") is just another assistant message, which is fine.                                                         |
| Missing or uncertain evidence | strong   | `text_status`, `text_source`, `timing_source`, `committed`, `open`, empty `selections`, and the raw provider truncation.                                                                                                                                 |

## Edge cases and weaknesses

- **Barge-in truncation:** handled (`text` vs `generated_text`, `interrupted_at_ms`). Pipecat's assistant aggregator truncates the stored message, so `generated_text` must come from the LLM span output.
- **Overlap:** intervals overlap freely. The app must pick which message to highlight; #22036's "latest start wins" rule still works.
- **Late or missing realtime transcript:** late updates rewrite the whole entry, and `missing` can upgrade to `final`. An LLM span logged before the transcript shows empty user text, and the id still links it.
- **Uncommitted speech:**
  - Visible only after the timeout. A call that ends inside the timeout writes pending intervals as uncommitted at close.
  - The MVP drops it for Pipecat realtime.
  - It has no text by design.
- **Failed or omitted segments:** `selections` is empty or partial. `start_ms`/`end_ms` still place the message, and recording omission reasons stay in `audio.recordings`.
- **Unknown clock offset:** if the recording started late, its descriptor origin differs from `voice.origin_unix_ms`. Lingua uses the descriptor timeline for selections and `voice.origin_unix_ms` for `*_ms`, and warns when they differ by more than 1 ms. The contract does not say how large an offset is acceptable.
- **Call in progress:** entries with `state: "open"`. Lingua shows them without a step link if no LLM span has heard them yet.
- **Content capture off:** `text_status: "not_captured"`. Ids, timing and audio remain, because context ids are read from `chatCtx.items` directly.
- **Tool cancelled by interruption:** the cancelled tool span ends with an error. The partially spoken assistant message is `interrupted`; speech that never got an item is keyed by its `speech_id`. Nothing records "this tool was cancelled because of that barge-in"; that is inferred from timing.
- **Agent handoff:** messages stay keyed per call, and `produced_by_span_id` points into the new agent's spans. Per-agent attribution is inferred from the span tree.
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
- Is `UNCOMMITTED_SPEECH_TIMEOUT_MS = 5000` safe for every LiveKit end-of-turn configuration, or should it read the session's endpointing settings?
- Should `end_of_turn_ms` move to the assistant message as `responding_to_end_ms`, to make latency explicit per reply?
