import { Attachment } from "../logger";

/**
 * Get file extension from IANA media type
 */
export function getExtensionFromMediaType(mediaType: string): string {
  const extensionMap: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "application/pdf": "pdf",
    "application/json": "json",
    "text/plain": "txt",
    "text/html": "html",
    "text/csv": "csv",
  };

  return extensionMap[mediaType] || "bin";
}

/**
 * Converts data (base64 string, URL, ArrayBuffer, Uint8Array, etc.) to a Blob
 */
export function convertDataToBlob(data: any, mediaType: string): Blob | null {
  try {
    if (typeof data === "string") {
      // Could be base64, data URL, or regular URL
      if (data.startsWith("data:")) {
        // Data URL - extract the base64 part
        const base64Match = data.match(/^data:[^;]+;base64,(.+)$/);
        if (base64Match) {
          const base64 = base64Match[1];
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return new Blob([bytes], { type: mediaType });
        }
      } else if (data.startsWith("http://") || data.startsWith("https://")) {
        // URL - we can't fetch it here, so return null to skip
        return null;
      } else {
        // Assume raw base64
        const binaryString = atob(data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new Blob([bytes], { type: mediaType });
      }
    } else if (data instanceof Uint8Array) {
      return new Blob([data as any], { type: mediaType });
    } else if (data instanceof ArrayBuffer) {
      return new Blob([data as any], { type: mediaType });
    } else if (typeof Buffer !== "undefined" && data instanceof Buffer) {
      return new Blob([data as any], { type: mediaType });
    }
  } catch (error) {
    // If conversion fails, return null
    return null;
  }
  return null;
}

/**
 * Process input to extract and convert image/file content parts to Attachments
 * Similar to processImagesInOutput in oai_responses.ts - replaces data in-place
 */
export function processInputAttachments(input: any): any {
  if (!input) {
    return input;
  }

  let attachmentIndex = 0;

  // Helper to process a single content part
  const processContentPart = (part: any): any => {
    if (!part || typeof part !== "object") {
      return part;
    }

    // Handle image content parts
    if (part.type === "image" && part.image) {
      const mediaType = "image/png"; // Default, could be inferred
      const blob = convertDataToBlob(part.image, mediaType);

      if (blob) {
        const filename = `input_image_${attachmentIndex}.${getExtensionFromMediaType(mediaType)}`;
        attachmentIndex++;

        const attachment = new Attachment({
          data: blob,
          filename: filename,
          contentType: mediaType,
        });

        // Replace image data with Attachment object in-place
        return {
          ...part,
          image: attachment,
        };
      }
    }

    // Handle file content parts
    if (part.type === "file" && part.data) {
      const mediaType = part.mediaType || "application/octet-stream";
      const blob = convertDataToBlob(part.data, mediaType);

      if (blob) {
        const filename =
          part.filename ||
          `input_file_${attachmentIndex}.${getExtensionFromMediaType(mediaType)}`;
        attachmentIndex++;

        const attachment = new Attachment({
          data: blob,
          filename: filename,
          contentType: mediaType,
        });

        // Replace data with Attachment object in-place
        return {
          ...part,
          data: attachment,
        };
      }
    }

    return part;
  };

  // Helper to process a message
  const processMessage = (message: any): any => {
    if (!message || typeof message !== "object") {
      return message;
    }

    // If message has content array, process each part
    if (Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map(processContentPart),
      };
    }

    return message;
  };

  // Process different input types
  if (Array.isArray(input)) {
    // Array of messages
    return input.map(processMessage);
  } else if (typeof input === "object" && input.content) {
    // Single message with content
    return processMessage(input);
  }

  // Simple string or other input - no processing needed
  return input;
}
