import { z } from "zod";

/**
 * Compatibility helper for zod v3/v4 record schemas.
 *
 * zod v3: z.record(valueSchema)
 * zod v4: z.record(keySchema, valueSchema)
 *
 * Usage: zRecordCompat(z.unknown())
 */
export function zRecordCompat(
  valueOrKeySchema: unknown,
  valueSchema?: unknown,
) {
  // zod 4 exposes ZodFirstPartyTypeKind
  if ((z as any).ZodFirstPartyTypeKind) {
    // If two arguments, use as keySchema, valueSchema
    if (valueSchema !== undefined) {
      if (!(valueSchema instanceof z.ZodType)) {
        throw new Error(
          "zRecordCompat: valueSchema must be a Zod schema in Zod 4",
        );
      }
      return z.record(z.string(), valueSchema);
    }
    if (!(valueOrKeySchema instanceof z.ZodType)) {
      throw new Error(
        "zRecordCompat: valueOrKeySchema must be a Zod schema in Zod 4",
      );
    }
    return z.record(z.string(), valueOrKeySchema);
  } else {
    // zod 3: only valueSchema
    if (!(valueOrKeySchema instanceof z.ZodType)) {
      throw new Error("zRecordCompat: valueOrKeySchema must be a Zod schema");
    }
    return z.record(z.string(), valueOrKeySchema);
  }
}
