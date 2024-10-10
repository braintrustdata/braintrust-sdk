import { z } from "zod";

export const attachmentReferenceSchema = z.object({
  name: z.string().min(1),
  content_type: z.string().min(1),
  key: z.string().min(1),
});

export type AttachmentReference = z.infer<typeof attachmentReferenceSchema>;
