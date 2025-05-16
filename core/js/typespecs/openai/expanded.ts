import { z } from "zod";
import { chatCompletionOpenAIMessageParamSchema } from "./messages";

export const expandedMessageSchema = chatCompletionOpenAIMessageParamSchema.and(
  z.object({
    cache_control: z
      .object({
        type: z.enum(["ephemeral"]),
      })
      .optional(),
  }),
);

export type ExpandedMessage = z.infer<typeof expandedMessageSchema>;
