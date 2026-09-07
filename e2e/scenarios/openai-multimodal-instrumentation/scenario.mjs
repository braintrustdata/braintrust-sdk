import { connect } from "node:net";
import { Writable } from "node:stream";
import { once } from "node:events";
import assert from "node:assert/strict";
import { wrapOpenAI, wrapOpenAIRealtime } from "braintrust";
import { runTracedScenario } from "../../helpers/provider-runtime.mjs";
import { MINIMAL_PNG_BASE64 } from "../../helpers/media-fixtures.mjs";
import { realtimeCassette } from "./realtime-cassette.mjs";

const packageName = process.env.OPENAI_PACKAGE_NAME;
const { default: OpenAI, toFile } = await import(packageName);
const major = Number(packageName.match(/v(\d)/)[1]);
const wrapped = process.env.INSTRUMENTATION_MODE === "wrapped";
const client = new OpenAI({ maxRetries: 0, timeout: 180_000 });
const ai = wrapped ? wrapOpenAI(client) : client;
const imageModel = "gpt-image-2";
const realtimeModel = "gpt-realtime-2";

await runTracedScenario({
  projectNameBase: "tmp-luca-openai-multimodal",
  rootName: "multimodal-root",
  metadata: { scenario: "openai-multimodal-instrumentation" },
  callback: async () => {
    const inputImage = await toFile(
      Buffer.from(MINIMAL_PNG_BASE64, "base64"),
      "input.png",
      { type: "image/png" },
    );
    const generated = ai.images.generate({
      model: imageModel,
      prompt: "A plain red square on white.",
      n: 2,
      size: "1024x1024",
      quality: "low",
    });
    assert.equal(typeof generated.withResponse, "function");
    const generation = await generated.withResponse();
    assert.equal(generation.data.data.length, 2);
    assert.equal(await generated.asResponse(), generation.response);
    const edited = await ai.images.edit({
      model: imageModel,
      image: inputImage,
      prompt: "Make a plain blue square on white.",
      size: "1024x1024",
      quality: "low",
    });
    assert.ok(edited.data[0].b64_json);
    // The retired variation endpoint still needs to preserve the real provider error.
    await assert.rejects(
      ai.images.createVariation({ model: "dall-e-2", image: inputImage }),
      (error) => {
        assert.ok(error.status >= 400 && error.status < 500);
        return true;
      },
    );
    if (major >= 5) {
      for (const operation of ["generate", "edit"]) {
        const stream = await ai.images[operation]({
          model: imageModel,
          ...(operation === "edit" ? { image: inputImage } : {}),
          prompt: "A plain green square on white.",
          size: "1024x1024",
          quality: "low",
          stream: true,
          partial_images: 1,
        });
        let completed = false;
        for await (const event of stream) {
          if (event.type.endsWith(".completed")) {
            assert.ok(event.b64_json);
            completed = true;
          }
        }
        assert.ok(completed);
      }
    }
    // A short real speech response supplies the transcription and Realtime input.
    const speech = await ai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      input: "Hello.",
      voice: "coral",
      response_format: "wav",
    });
    assert.equal(speech.bodyUsed, false);
    const wav = Buffer.from(await speech.arrayBuffer());
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    let pcm;
    for (let offset = 12; offset + 8 <= wav.length; ) {
      const length = wav.readUInt32LE(offset + 4);
      if (wav.toString("ascii", offset, offset + 4) === "data") {
        pcm = wav.subarray(offset + 8);
        break;
      }
      offset += 8 + length + (length % 2);
    }
    assert.ok(pcm?.length, "Speech response must contain PCM audio");
    // Keep the complete utterance, downsampled to 12 kHz PCM for a small
    // multipart cassette; Realtime receives the original 24 kHz samples.
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 24_000);
    const transcriptionWav = Buffer.alloc(44 + Math.floor(pcm.length / 4) * 2);
    wav.copy(transcriptionWav, 0, 0, 44);
    transcriptionWav.writeUInt32LE(transcriptionWav.length - 8, 4);
    transcriptionWav.writeUInt32LE(12_000, 24);
    transcriptionWav.writeUInt32LE(24_000, 28);
    transcriptionWav.writeUInt32LE(transcriptionWav.length - 44, 40);
    for (let offset = 0; offset < transcriptionWav.length - 44; offset += 2)
      transcriptionWav.writeInt16LE(pcm.readInt16LE(offset * 2), 44 + offset);
    assert.ok(transcriptionWav.length < 60_000);
    const inputAudio = await toFile(transcriptionWav, "hello.wav", {
      type: "audio/wav",
    });
    const transcript = await ai.audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      file: inputAudio,
      language: "en",
    });
    assert.ok(transcript.text.trim());
    const transcriptionStream = await ai.audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      file: inputAudio,
      stream: true,
    });
    let transcriptDone = false;
    for await (const event of transcriptionStream)
      if (event.type === "transcript.text.done") {
        assert.ok(event.text.trim());
        transcriptDone = true;
      }
    assert.ok(transcriptDone);
    const translation = await ai.audio.translations.create({
      model: "whisper-1",
      file: inputAudio,
    });
    assert.ok(translation.text.trim());
    for (const read of ["reader", "iterate", "pipe", "cancel", "unread"]) {
      const response = await ai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        input: `Hello ${read}.`,
        voice: "coral",
      });
      assert.equal(response.bodyUsed, false);
      let size = 0;
      if (read === "reader" && typeof response.body.getReader === "function") {
        const reader = response.body.getReader();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
        }
      }
      if (
        read === "iterate" ||
        (read === "reader" && typeof response.body.getReader !== "function")
      )
        for await (const chunk of response.body) size += chunk.byteLength;
      if (read === "pipe" && typeof response.body.pipeTo === "function")
        await response.body.pipeTo(
          new WritableStream({
            write(chunk) {
              size += chunk.byteLength;
            },
          }),
        );
      if (read === "pipe" && typeof response.body.pipeTo !== "function") {
        const destination = new Writable({
          write(chunk, _encoding, callback) {
            size += chunk.length;
            callback();
          },
        });
        const finished = once(destination, "finish");
        response.body.pipe(destination);
        await finished;
      }
      if (read === "cancel") {
        if (typeof response.body.cancel === "function")
          await response.body.cancel();
        else response.body.destroy();
      }
      if (!["cancel", "unread"].includes(read)) assert.ok(size > 0);
    }
    const sseSpeech = await ai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      input: "Hello streaming.",
      voice: "coral",
      stream_format: "sse",
    });
    for await (const chunk of sseSpeech.body) assert.ok(chunk.byteLength);

    for (const transport of ["websocket", "ws"]) {
      let beta = false;
      const module = await import(`${packageName}/realtime/${transport}`).catch(
        () => {
          beta = true;
          return import(`${packageName}/beta/realtime/${transport}`);
        },
      );
      const Connection =
        module.OpenAIRealtimeWebSocket ?? module.OpenAIRealtimeWS;
      const cassette = await realtimeCassette({
        transport,
        model: realtimeModel,
        beta,
      });
      const connection = new Connection(
        {
          model: realtimeModel,
          options: {
            createConnection: () => connect(cassette.port, "127.0.0.1"),
          },
          onURL(url) {
            url.protocol = "ws:";
            url.host = `127.0.0.1:${cassette.port}`;
          },
        },
        client,
      );
      const rt = wrapped ? wrapOpenAIRealtime(connection) : connection;
      let rejectFailure;
      const failure = new Promise((_, reject) => {
        rejectFailure = reject;
      });
      rt.on("error", (error) => rejectFailure(error));
      rt.socket.addEventListener("close", () =>
        rejectFailure(new Error("Realtime closed before the expected event")),
      );
      const waitFor = (type) => {
        let timeout;
        return Promise.race([
          rt.emitted(type),
          failure,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error(`${transport}: timed out waiting for ${type}`),
                ),
              60_000,
            );
          }),
        ]).finally(() => clearTimeout(timeout));
      };
      try {
        if (beta) {
          // OpenAI retired the beta protocol. Preserve its real error instead
          // of fabricating successful turns for SDKs that still require it.
          await assert.rejects(
            waitFor("session.created"),
            /Realtime Beta API is no longer supported/,
          );
          continue;
        }
        await waitFor("session.created");
        const updated = waitFor("session.updated");
        const tools = [
          {
            type: "function",
            name: "get_weather",
            description: "Get the weather in Vienna.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        ];
        rt.send({
          type: "session.update",
          session: {
            ...(beta
              ? { modalities: ["text", "audio"], turn_detection: null }
              : {
                  type: "realtime",
                  output_modalities: ["audio"],
                  audio: {
                    input: { turn_detection: null },
                    output: { voice: "marin" },
                  },
                }),
            instructions:
              "Use get_weather when asked. Speak briefly in English.",
            tools,
          },
        });
        await updated;
        const committed = waitFor("input_audio_buffer.committed");
        rt.send({
          type: "input_audio_buffer.append",
          audio: pcm.toString("base64"),
        });
        rt.send({ type: "input_audio_buffer.commit" });
        await committed;
        rt.send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "What is the weather in Vienna?" },
            ],
          },
        });
        let done = waitFor("response.done");
        rt.send({
          type: "response.create",
          response: {
            output_modalities: ["text"],
            instructions:
              "Call get_weather exactly once to look up the weather in Vienna.",
            max_output_tokens: 128,
            tool_choice: { type: "function", name: "get_weather" },
          },
        });
        const toolResponse = (await done).response;
        assert.equal(toolResponse.status, "completed");
        const tool = toolResponse.output.find(
          (item) => item.type === "function_call",
        );
        assert.equal(tool?.name, "get_weather");
        rt.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: tool.call_id,
            output: "Sunny.",
          },
        });
        done = waitFor("response.done");
        rt.send({
          type: "response.create",
          response: {
            instructions: "Say only: It is sunny.",
            max_output_tokens: 128,
            tool_choice: "none",
          },
        });
        const audioResponse = (await done).response;
        assert.equal(audioResponse.status, "completed");
        assert.ok(
          audioResponse.output.some((item) =>
            item.content?.some(
              (part) => part.type === "audio" || part.type === "output_audio",
            ),
          ),
        );
        const started = waitFor("response.created");
        done = waitFor("response.done");
        rt.send({
          type: "response.create",
          response: {
            instructions: "Count slowly from one to one hundred.",
            max_output_tokens: 256,
            tool_choice: "none",
          },
        });
        await started;
        rt.send({ type: "response.cancel" });
        assert.equal((await done).response.status, "cancelled");
        const interrupted = waitFor("response.created");
        rt.send({
          type: "response.create",
          response: {
            instructions: "Count slowly from one to one hundred.",
            max_output_tokens: 256,
            tool_choice: "none",
          },
        });
        await interrupted;
      } finally {
        rt.close();
        // The shared failure promise may reject after the final awaited event.
        void failure.catch(() => {});
        await cassette.close();
      }
    }
  },
});
