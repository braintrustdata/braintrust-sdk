import { APP_URL } from "./constants";

export interface NormalizeOptions {
  useLingua: boolean;
}

export interface NormalizeResponse {
  spans: unknown[];
  converters: Record<string, string>;
}

export const normalizeTrace = async (
  spans: unknown[],
  options: NormalizeOptions,
): Promise<NormalizeResponse> => {
  const response = await fetch(`${APP_URL}/api/trace/normalize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      spans,
      options,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Normalize API failed: ${response.status} - ${error}`);
  }

  return await response.json();
};
