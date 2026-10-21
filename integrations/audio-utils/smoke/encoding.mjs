import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
for (const api of [
  await import("@braintrust/audio-utils"),
  require("@braintrust/audio-utils"),
]) {
  const codec = await import(api.oggOpus().module);
  const encoded = await codec.encode(new Int16Array(960), 24000, 2);
  assert.equal(Buffer.from(encoded.bytes.subarray(0, 4)).toString(), "OggS");
}
console.log("Ogg encoder loads through ESM and CommonJS exports.");
