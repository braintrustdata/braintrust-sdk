/**
 * Zod compatibility layer for Braintrust SDK
 *
 * This module provides a stable import point for zod that works with both
 * zod 3.x and 4.x versions. It re-exports from 'zod/v3' which exists in both
 * major versions, ensuring API compatibility.
 *
 * Why use zod/v3 export even with zod 4 installed:
 * - zod 3.x: provides 'zod/v3' export that points to the v3 API
 * - zod 4.x: provides 'zod/v3' export for backward compatibility
 *
 * This ensures schemas created by the SDK are compatible with both versions
 * and work reliably across the ecosystem.
 *
 * For JSON Schema conversion, see zod-to-json-compat.ts which detects the
 * installed version and uses the appropriate converter.
 *
 * @module zod-compat
 */

// Re-export from zod/v3 which exists in both zod 3.x and 4.x
export { z, ZodError } from "zod/v3";

// Re-export commonly used types
export type {
  ZodType,
  ZodSchema,
  ZodObject,
  ZodArray,
  ZodString,
  ZodNumber,
  ZodBoolean,
  ZodDate,
  ZodUndefined,
  ZodNull,
  ZodAny,
  ZodUnknown,
  ZodNever,
  ZodVoid,
  ZodOptional,
  ZodNullable,
  ZodDefault,
  ZodCatch,
  ZodPromise,
  ZodEffects,
  ZodTransformer,
  ZodLiteral,
  ZodEnum,
  ZodNativeEnum,
  ZodTuple,
  ZodRecord,
  ZodMap,
  ZodSet,
  ZodFunction,
  ZodLazy,
  ZodUnion,
  ZodDiscriminatedUnion,
  ZodIntersection,
  ZodTypeAny,
} from "zod/v3";
