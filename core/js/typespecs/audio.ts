import { z } from "zod";

export const audioJsonSchema = z.object({
  audio_codec: z
    .discriminatedUnion("name", [
      z.object({
        name: z.literal("pcm"),
        byte_order: z.enum(["little", "big"]).default("little"),
        number_encoding: z.enum(["int", "float"]).default("int"),
      }),
      z.object({
        name: z.literal("g711"),
        algorithm: z.enum(["a", "mu"]),
      }),
    ])
    .and(
      z.object({
        // Common codec parameters.
        channels: z.number().nonnegative().int(),
        sample_rate: z.number().nonnegative().int(),
        bits_per_sample: z.number().nonnegative().int(),
      }),
    ),

  // Actual audio data as base64. May be split over multiple, individually encoded base64 strings to allow incremental encoding.
  buffers: z.array(z.string().describe("base64")),
});

export type AudioJson = z.infer<typeof audioJsonSchema>;

export type AudioCodec = AudioJson["audio_codec"];
export type AudioCodecType = AudioCodec["name"];

export const attachmentSchema = z.object({
  attachments: z.object({
    input: audioJsonSchema.optional(),
    output: audioJsonSchema.optional(),
  }),
});
