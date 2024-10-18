import { z } from "zod";

export const BRAINTRUST_ATTACHMENT = "braintrust_attachment";

export const attachmentReferenceSchema = z.object({
  type: z
    .literal(BRAINTRUST_ATTACHMENT)
    .describe("An identifier to help disambiguate parsing."),
  filename: z
    .string()
    .min(1)
    .describe(
      "Human-readable filename for user interfaces. Not related to attachment storage.",
    ),
  content_type: z.string().min(1).describe("MIME type of this file."),
  key: z
    .string()
    .min(1)
    .describe("Key in the object store bucket for this attachment."),
  upload_status: z
    .enum(["uploading", "done", "error"])
    .describe(
      "Uploading: The span has uploaded but attachment upload is still in progress. Done: Attachment can be read at `key`. Error: The attachment couldn't be uploaded.",
    ),
  error_message: z
    .string()
    .nullish()
    .describe("Describes the error encountered while uploading."),
});

export type AttachmentReference = z.infer<typeof attachmentReferenceSchema>;
