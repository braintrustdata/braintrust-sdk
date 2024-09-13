// This module defines several types that can be set based on a build-time
// environment variable: BRAINTRUST_TYPESPECS_MODE.

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
extendZodWithOpenApi(z);

const modeSchema = z.enum(["default", "stainless"]);

const mode = modeSchema.parse(
  typeof process === "undefined"
    ? "default"
    : process?.env?.BRAINTRUST_TYPESPECS_MODE || "default",
);

const modeToTypes = {
  default: {
    unknown: z.unknown(),
    literalTrue: z.literal(true),
    literalFalse: z.literal(false),
  },
  stainless: {
    // Stainless requires schemas which are completely permissive to be
    // tagged.
    unknown: z.unknown().openapi({ ["x-stainless-any"]: true }),
    // Stainless does not support boolean literals in all SDKs.
    literalTrue: z.boolean(),
    literalFalse: z.boolean(),
  },
} as const;

export const customTypes = modeToTypes[mode];
export const customTypesMode = mode;
