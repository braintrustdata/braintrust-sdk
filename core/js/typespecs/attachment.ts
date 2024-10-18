import { z } from "zod";

export const BRAINTRUST_ATTACHMENT = "braintrust_attachment";

export const attachmentReferenceSchema = z.object({
  type: z.literal(BRAINTRUST_ATTACHMENT),
  filename: z.string().min(1),
  content_type: z.string().min(1),
  key: z.string().min(1),
  upload_status: z.enum(["uploading", "done", "error"]),
  error_message: z.string().nullish(),
});

export type AttachmentReference = z.infer<typeof attachmentReferenceSchema>;
