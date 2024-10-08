import { z } from "zod";

export const audioJsonSchema = z.object({
  audio_codec: z.discriminatedUnion("name", [
    z.object({
      name: z.literal("pcm"),
      channels: z.number().nonnegative().int(),
      sample_rate: z.number().nonnegative().int(),
      bits_per_sample: z.number().nonnegative().int(),
      byte_order: z.enum(["little", "big"]).default("little"),
      number_encoding: z.enum(["int", "float"]).default("int"),
    }),
    z.object({
      name: z.literal("g711"),
    }),
  ]),
  buffers: z.array(z.string()),
});

export type AudioJson = z.infer<typeof audioJsonSchema>;

export type AudioBufferType = AudioJson["audio_codec"]["name"];

export const attachmentSchema = z.object({
  attachments: z.object({
    input: audioJsonSchema.optional(),
    output: audioJsonSchema.optional(),
  }),
});
