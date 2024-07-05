import { z } from "zod";
import { forEachMissingKey } from "./util";

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
