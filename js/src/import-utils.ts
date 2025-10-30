export async function importWithTimeout<T>(
  importFn: () => Promise<T>,
  timeoutMs = 3000,
  errorMessage = "Import timeout",
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${errorMessage} after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([importFn(), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export async function tryRequireThenImport<T>(
  packageName: string,
  timeoutMs = 3000,
  errorMessage = "Import timeout",
): Promise<T> {
  if (typeof require !== "undefined") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- Dynamic require for fallback
      return require(packageName) as T;
    } catch {
      // Require failed, fall through to import
    }
  }

  return await importWithTimeout<T>(
    () => import(packageName),
    timeoutMs,
    errorMessage,
  );
}
