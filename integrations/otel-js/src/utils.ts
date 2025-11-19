export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const uint8Array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    uint8Array[i] = binary.charCodeAt(i);
  }
  return uint8Array;
}

export function getExportVersion(exportedSpan: string): number {
  const exportedBytes = base64ToUint8Array(exportedSpan);
  return exportedBytes[0];
}

/**
 * Create a BasicTracerProvider with span processors in a way that works with both OTel 1.x and 2.x.
 *
 * In OTel 1.x: Uses addSpanProcessor() method (constructor config doesn't work properly)
 * In OTel 2.x: Uses constructor config with spanProcessors (addSpanProcessor removed)
 *
 * This helper detects which API is available and uses the correct approach.
 */
export function createTracerProvider(
  ProviderClass: any,
  processors: any[],
  config?: any,
): any {
  // Create a test provider to detect which API version we're using
  const testProvider = new ProviderClass(config || {});

  if (typeof testProvider.addSpanProcessor === "function") {
    // OTel 1.x: Has addSpanProcessor method
    const provider = new ProviderClass(config);
    for (const processor of processors) {
      provider.addSpanProcessor(processor);
    }
    return provider;
  } else {
    // OTel 2.x: Must use constructor config
    const provider = new ProviderClass({
      ...config,
      spanProcessors: processors,
    });
    return provider;
  }
}
