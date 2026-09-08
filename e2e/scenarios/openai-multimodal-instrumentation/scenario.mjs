import { Writable } from "node:stream";
import { once } from "node:events";
import assert from "node:assert/strict";
import { wrapOpenAI } from "braintrust";
import { runTracedScenario } from "../../helpers/provider-runtime.mjs";
import { MINIMAL_PNG_BASE64 } from "../../helpers/media-fixtures.mjs";

const packageName = process.env.OPENAI_PACKAGE_NAME;
const { default: OpenAI, toFile } = await import(packageName);
const major = Number(packageName.match(/v(\d)/)[1]);
const wrapped = process.env.INSTRUMENTATION_MODE === "wrapped";
const client = new OpenAI({ maxRetries: 0, timeout: 180_000 });
const ai = wrapped ? wrapOpenAI(client) : client;
const imageModel = "gpt-image-2";

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
    // A short real speech response supplies the transcription input.
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
    // multipart cassette.
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
  },
});
