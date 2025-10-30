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
