import { z } from "zod";

export const BRAINTRUST_ATTACHMENT = "braintrust_attachment";

export const attachmentReferenceSchema = z.object({
  type: z.literal(BRAINTRUST_ATTACHMENT),
  filename: z.string().min(1),
  content_type: z.string().min(1),
  key: z.string().min(1),
});

/**
 * Represents an attachment in an external object store.
 *
 * @property type An identifier to help disambiguate parsing.
 * @property filename Human-readable filename for user interfaces. Not related to attachment storage.
 * @property content_type MIME type of this file.
 * @property key Key in the object store bucket for this attachment.
 */
export type AttachmentReference = z.infer<typeof attachmentReferenceSchema>;

export const uploadStatusSchema = z.enum(["uploading", "done", "error"]);

/**
 * - `uploading`: The span has uploaded but attachment upload is still in progress.
 * - `done`: Attachment can be read at the key.
 * - `error`: The attachment couldn't be uploaded.
 */
export type UploadStatus = z.infer<typeof uploadStatusSchema>;

export const attachmentStatusSchema = z.object({
  upload_status: uploadStatusSchema,
  error_message: z
    .string()
    .nullish()
    .transform((x) => x || undefined),
});

/**
 * Attachments may be uploaded asynchronously with respect to the containing
 * log. This object is used to track the status and error, if any.
 *
 * @property upload_status See {@link UploadStatus}.
 * @property error_message Describes the error encountered while uploading.
 */
export type AttachmentStatus = z.infer<typeof attachmentStatusSchema>;
