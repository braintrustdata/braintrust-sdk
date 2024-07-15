// Mutably updates `mergeInto` with the contents of `mergeFrom`, merging objects deeply.
export function mergeDicts(
  mergeInto: Record<string, unknown>,
  mergeFrom: Record<string, unknown>,
) {
  for (const [k, mergeFromV] of Object.entries(mergeFrom)) {
    const mergeIntoV = mergeInto[k];
    if (
      mergeIntoV instanceof Object &&
      !Array.isArray(mergeIntoV) &&
      mergeFrom instanceof Object &&
      !Array.isArray(mergeFromV)
    ) {
      mergeDicts(
        mergeIntoV as Record<string, unknown>,
        mergeFromV as Record<string, unknown>,
      );
    } else {
      mergeInto[k] = mergeFromV;
    }
  }
  return mergeInto;
}

// Recursively walks down `lhs` and `rhs`, invoking `fn` for each key in any
// `rhs` subobject which is not in the corresponding `lhs` subobject.
export function forEachMissingKey({
  lhs,
  rhs,
  fn,
}: {
  lhs: unknown;
  rhs: unknown;
  fn: (args: {
    lhs: Record<string, unknown>;
    k: string;
    v: unknown;
    path: string[];
  }) => void;
}) {
  function helper(lhs: unknown, rhs: unknown, path: string[]) {
    if (lhs instanceof Object) {
      if (!(rhs instanceof Object)) {
        throw new Error(
          `Type mismatch between lhs and rhs object at path ${JSON.stringify(
            path,
          )}`,
        );
      }
      const lhsRec = lhs as Record<string, unknown>;
      const rhsRec = rhs as Record<string, unknown>;
      for (const [k, v] of Object.entries(rhsRec)) {
        if (!(k in lhsRec)) {
          fn({ lhs: lhsRec, k, v, path });
        } else {
          helper(lhsRec[k], rhsRec[k], [...path, k]);
        }
      }
    }
  }
  helper(lhs, rhs, []);
}

export function capitalize(s: string, sep?: string) {
  const items = sep ? s.split(sep) : [s];
  return items
    .map((s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(sep || "");
}

export function snakeToCamelCase(s: string) {
  return s
    .split("_")
    .map((s) => capitalize(s))
    .join("");
}

export function snakeToTitleCase(s: string) {
  return capitalize(s, "_").replace("_", " ");
}

export function constructJsonArray(items: string[]) {
  return `[${items.join(",")}]`;
}

export function mapAt<K, V>(m: Map<K, V>, k: K): V {
  const ret = m.get(k);
  if (ret === undefined) {
    throw new Error(`Map does not contain key ${k}`);
  }
  return ret;
}

export function _urljoin(...parts: string[]): string {
  return parts
    .map((x, i) =>
      x.replace(/^\//, "").replace(i < parts.length - 1 ? /\/$/ : "", ""),
    )
    .filter((x) => x.trim() !== "")
    .join("/");
}
