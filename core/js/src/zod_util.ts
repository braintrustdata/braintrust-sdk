import { z } from "zod";
import { forEachMissingKey } from "./util";

// Recurses through a zod schema and applies the given function to all
// sub-objects. Iteration order is unspecified, but the helper function can
// return a boolean to indicate we stop recursing beyond a specific input.
export function zodDeepForEach(
  initial: z.ZodType,
  fn: (val: z.ZodType) => boolean,
) {
  function helper(x: z.ZodType) {
    if (!fn(x)) {
      return;
    }
    if (x instanceof z.ZodObject) {
      Object.values(x.shape as z.ZodRawShape).forEach(helper);
    } else if (x instanceof z.ZodArray) {
      helper(x.element as z.ZodTypeAny);
    } else if (x instanceof z.ZodUnion) {
      (x.options as z.ZodUnionOptions).forEach(helper);
    } else if (x instanceof z.ZodDiscriminatedUnion) {
      (x.options as z.ZodDiscriminatedUnionOption<any>[]).forEach(helper);
    } else if (x instanceof z.ZodIntersection) {
      [x._def.left, x._def.right].forEach(helper);
    } else if (x instanceof z.ZodTuple) {
      (x.items as z.ZodTypeAny[]).forEach(helper);
    } else if (x instanceof z.ZodRecord || x instanceof z.ZodMap) {
      helper(x.valueSchema);
    } else if (x instanceof z.ZodSet) {
      helper(x._def.valueType);
    } else if (x instanceof z.ZodFunction) {
      helper(x.parameters());
      helper(x.returnType());
    } else if (x instanceof z.ZodLazy) {
      helper(x.schema);
    } else if (x instanceof z.ZodLiteral && x.value instanceof z.ZodLiteral) {
      helper(x.value);
    } else if (
      x instanceof z.ZodPromise ||
      x instanceof z.ZodOptional ||
      x instanceof z.ZodNullable ||
      x instanceof z.ZodBranded
    ) {
      helper(x.unwrap());
    } else if (x instanceof z.ZodDefault) {
      helper(x.removeDefault());
    } else if (x instanceof z.ZodCatch) {
      helper(x.removeCatch());
    } else if (x instanceof z.ZodPipeline) {
      ([x._def.in, x._def.out] as z.ZodTypeAny[]).forEach(helper);
    } else if (x instanceof z.ZodReadonly) {
      helper(x._def.innerType);
    }
  }
  helper(initial);
}

export function checkUnknownKeysSetting(
  x: z.ZodType,
  allowedUnknownKeys: z.UnknownKeysParam[],
) {
  zodDeepForEach(x, (x: z.ZodType) => {
    if (x instanceof z.ZodObject) {
      const unknownKeys = x._def.unknownKeys;
      if (!allowedUnknownKeys.includes(unknownKeys)) {
        throw new Error(
          `Schema includes invalid unknownKeys setting ${unknownKeys}`,
        );
      }
    }
    return true;
  });
}

// Parses a zod schema, checking afterwards that no fields were stripped during
// parsing.
//
// Note: this check is not exactly equivalent to a deep version of `z.strict()`.
// For instance, schemas which intentionally strip keys from objects using
// something like `z.transform` can fail this check.
export function parseNoStrip<T extends z.ZodType>(schema: T, input: unknown) {
  const output = schema.parse(input) as z.infer<T>;
  forEachMissingKey({
    lhs: output,
    rhs: input,
    fn: ({ k, path }) => {
      throw new Error(
        `Key ${JSON.stringify(k)} at path ${JSON.stringify(
          path,
        )} was stripped from input`,
      );
    },
  });
  return output;
}
