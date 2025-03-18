import { z } from "zod";

export const BRAINTRUST_ATTACHMENT = "braintrust_attachment";
export const EXTERNAL_ATTACHMENT = "external_attachment";

export const braintrustAttachmentReferenceSchema = z
  .object({
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
  })
  .openapi("BraintrustAttachmentReference");

export const externalAttachmentReferenceSchema = z
  .object({
    type: z
      .literal(EXTERNAL_ATTACHMENT)
      .describe("An identifier to help disambiguate parsing."),
    filename: z
      .string()
      .min(1)
      .describe(
        "Human-readable filename for user interfaces. Not related to attachment storage.",
      ),
    content_type: z.string().min(1).describe("MIME type of this file."),
    url: z
      .string()
      .min(1)
      .describe(
        "Fully qualified URL to the object in the external object store.",
      ),
  })
  .openapi("ExternalAttachmentReference");

export const attachmentReferenceSchema = z
  .discriminatedUnion("type", [
    braintrustAttachmentReferenceSchema,
    externalAttachmentReferenceSchema,
  ])
  .openapi("AttachmentReference");

/**
 * Represents an attachment in the Braintrust object store.
 *
 * @property type An identifier to help disambiguate parsing.
 * @property filename Human-readable filename for user interfaces. Not related to attachment storage.
 * @property content_type MIME type of this file.
 * @property key Key in the object store bucket for this attachment.
 */
export type BraintrustAttachmentReference = z.infer<
  typeof braintrustAttachmentReferenceSchema
>;

/**
 * Represents an attachment in an external object store.
 *
 * @property type An identifier to help disambiguate parsing.
 * @property filename Human-readable filename for user interfaces. Not related to attachment storage.
 * @property content_type MIME type of this file.
 * @property url Fully qualified URL to the object in the external object store.
 */
export type ExternalAttachmentReference = z.infer<
  typeof externalAttachmentReferenceSchema
>;

export type AttachmentReference = z.infer<typeof attachmentReferenceSchema>;

export const uploadStatusSchema = z
  .enum(["uploading", "done", "error"])
  .openapi("UploadStatus");

/**
 * - `uploading`: The span has uploaded but attachment upload is still in progress.
 * - `done`: Attachment can be read at the key.
 * - `error`: The attachment couldn't be uploaded.
 */
export type UploadStatus = z.infer<typeof uploadStatusSchema>;

export const attachmentStatusSchema = z
  .object({
    upload_status: uploadStatusSchema,
    error_message: z
      .string()
      .nullish()
      .transform((x) => x || undefined)
      .describe("Describes the error encountered while uploading."),
  })
  .openapi("AttachmentStatus");

/**
 * Attachments may be uploaded asynchronously with respect to the containing
 * log. This object is used to track the status and error, if any.
 *
 * @property upload_status See {@link UploadStatus}.
 * @property error_message Describes the error encountered while uploading.
 */
export type AttachmentStatus = z.infer<typeof attachmentStatusSchema>;
