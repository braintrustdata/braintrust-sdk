import { z } from "zod";
import { forEachMissingKey } from "./util";

// Parses a zod schema, checking afterwards that no fields were stripped during
// parsing. There are several reasons we have this function:
//
// - Marking a schema `strict` before parsing is not sufficient:
//
//   - `strict` only works at the top level of an object, not for nested
//   objects. It doesn't seem like support for deep strict
//   (https://github.com/colinhacks/zod/issues/2062) is on the roadmap.
//
//   - `strict` would not work for non-toplevel-object types like unions.
//
//  - Enforcing `strict` for all objects in our typespecs is not feasible:
//
//    - In some contexts, we may want to use the schema in a "less-strict" mode,
//    which just validates the fields it knows about. E.g. openAPI spec
//    validation, or we may just want to pull out a subset of fields we care
//    about. In these cases, if our schemas are deeply-strict, it is very hard
//    to un-strictify them.
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
