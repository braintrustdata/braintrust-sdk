// Mutably updates `mergeInto` with the contents of `mergeFrom`, merging objects
// deeply. Does not merge any further than `merge_paths`.
export function mergeDictsWithPaths({
  mergeInto,
  mergeFrom,
  mergePaths,
}: {
  mergeInto: Record<string, unknown>;
  mergeFrom: Record<string, unknown>;
  mergePaths: string[][];
}) {
  const mergePathsSerialized = new Set<string>(
    mergePaths.map((p) => JSON.stringify(p)),
  );
  return mergeDictsWithPathsHelper({
    mergeInto,
    mergeFrom,
    path: [],
    mergePaths: mergePathsSerialized,
  });
}

function mergeDictsWithPathsHelper({
  mergeInto,
  mergeFrom,
  path,
  mergePaths,
}: {
  mergeInto: Record<string, unknown>;
  mergeFrom: Record<string, unknown>;
  path: string[];
  mergePaths: Set<string>;
}) {
  Object.entries(mergeFrom).forEach(([k, mergeFromV]) => {
    const fullPath = path.concat([k]);
    const fullPathSerialized = JSON.stringify(fullPath);
    const mergeIntoV = recordFind(mergeInto, k);
    if (
      isObject(mergeIntoV) &&
      isObject(mergeFromV) &&
      !mergePaths.has(fullPathSerialized)
    ) {
      mergeDictsWithPathsHelper({
        mergeInto: mergeIntoV,
        mergeFrom: mergeFromV,
        path: fullPath,
        mergePaths,
      });
    } else {
      mergeInto[k] = mergeFromV;
    }
  });

  return mergeInto;
}

// Mutably updates `mergeInto` with the contents of `mergeFrom`, merging objects deeply.
export function mergeDicts(
  mergeInto: Record<string, unknown>,
  mergeFrom: Record<string, unknown>,
) {
  return mergeDictsWithPaths({ mergeInto, mergeFrom, mergePaths: [] });
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

export function _urljoin(...parts: string[]): string {
  return parts
    .map((x, i) =>
      x.replace(/^\//, "").replace(i < parts.length - 1 ? /\/$/ : "", ""),
    )
    .filter((x) => x.trim() !== "")
    .join("/");
}

export function mapAt<K, V>(m: Map<K, V>, k: K): V {
  const ret = m.get(k);
  if (ret === undefined) {
    throw new Error(`Map does not contain key ${k}`);
  }
  return ret;
}

export function mapSetDefault<K, V>(m: Map<K, V>, k: K, _default: V): V {
  const ret = m.get(k);
  if (ret === undefined) {
    m.set(k, _default);
    return _default;
  } else {
    return ret;
  }
}

export function mapSetNotPresent<K, V>(m: Map<K, V>, k: K, v: V): Map<K, V> {
  if (m.has(k)) {
    throw new Error(`Map already contains key ${k}`);
  }
  return m.set(k, v);
}

export function recordFind<K extends string | number | symbol, V>(
  m: { [k in K]?: V },
  k: K,
): V | undefined {
  return m[k];
}

export function recordAt<K extends string | number | symbol, V>(
  m: { [k in K]?: V },
  k: K,
): V {
  const ret = recordFind(m, k);
  if (ret === undefined) {
    throw new Error(`Record does not contain key ${String(k)}`);
  }
  return ret;
}

export function recordSetDefault<K extends string | number | symbol, V>(
  m: { [k in K]?: V },
  k: K,
  _default: V,
): V {
  const ret = recordFind(m, k);
  if (ret === undefined) {
    m[k] = _default;
    return _default;
  } else {
    return ret;
  }
}

/**
 * @example
 * isObject([1, 2, 3]) // false
 */
export function isObject(value: any): value is { [key: string]: any } {
  return value instanceof Object && !(value instanceof Array);
}

export function isArray(value: any): value is any[] {
  return value instanceof Array;
}

export function isEmpty(a: any): a is null | undefined {
  return a === undefined || a === null;
}

export function isNumber(a: any) {
  return typeof a === "number" || typeof a === "bigint";
}

/**
 * @returns a typed array of the Record's keys
 */
export function getRecordKeys<T extends Record<string | number | symbol, any>>(
  obj: T,
): Array<keyof T> {
  return Object.keys(obj);
}
