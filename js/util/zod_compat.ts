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
      return z.record(valueOrKeySchema, valueSchema);
    }
    // If one argument, default keySchema to z.string()
    return z.record(z.string(), valueOrKeySchema);
  } else {
    // zod 3: only valueSchema
    return z.record(valueOrKeySchema);
  }
}
