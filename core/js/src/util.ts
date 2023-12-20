// Mutably updates `mergeInto` with the contents of `mergeFrom`, merging objects deeply.
export function mergeDicts(
  mergeInto: Record<string, unknown>,
  mergeFrom: Record<string, unknown>
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
        mergeFromV as Record<string, unknown>
      );
    } else {
      mergeInto[k] = mergeFromV;
    }
  }
}
