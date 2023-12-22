import { openAIV4NonProxyWrapper } from "./oai_wrappers/non_proxy_wrappers";
import { openAIV4ProxyWrapper } from "./oai_wrappers/proxy_wrappers";

/**
 * Wrap an `OpenAI` object (created with `new OpenAI(...)`) to add tracing.
 *
 * Currently, this only supports the `v4` API.
 *
 * @param openai The `OpenAI` object.
 * @param options.useProxy By default (or if `false`), the wrapper does not trace through the proxy. Pass `true` to use the Braintrust proxy as the base URL. The URL is obtained from the environment variable `BRAINTRUST_PROXY_URL`, defaulting to `https://braintrustproxy.com/v1. Pass a string to use a custom proxy URL.
 * @param options.apiKey Only used when `useProxy` is set. By default, the API key is set from `BRAINTRUST_API_KEY` if available. Pass a string to use a custom API key.
 * @returns The wrapped `OpenAI` object.
 */
export function wrapOpenAI<T extends object>(
  openai: T,
  options?: { useProxy?: string | boolean; apiKey?: string }
): T {
  if ((openai as any)?.chat?.completions?.create) {
    const useProxyOpt = options?.useProxy;
    if (useProxyOpt) {
      return openAIV4ProxyWrapper({
        openai: openai as any,
        useProxy: useProxyOpt,
        apiKey: options?.apiKey,
      }) as T;
    } else {
      return openAIV4NonProxyWrapper(openai as any) as T;
    }
  } else {
    console.warn("Unsupported OpenAI library (potentially v3). Not wrapping.");
    return openai;
  }
}
