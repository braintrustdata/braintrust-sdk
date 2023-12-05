import { openAIV4NonProxyWrapper } from "./oai_wrappers/non_proxy_wrappers";
import { openAIV4ProxyWrapper } from "./oai_wrappers/proxy_wrappers";

/**
 * Wrap an `OpenAI` object (created with `new OpenAI(...)`) to add tracing.
 *
 * Currently, this only supports the `v4` API.
 *
 * @param openai The `OpenAI` object.
 * @param proxyBaseUrl Use the Braintrust proxy (https://github.com/braintrustdata/braintrust-proxy) as the base URL. When left `undefined`, the URL is obtained from the environment variable `BRAINTRUST_PROXY_URL`, defaulting to `https://braintrustproxy.com/v[api_version]`. Pass `null` to leave the original base URL intact and use the non-proxy wrapper, or pass a string to use a custom URL.
 * @param proxyApiKey For clients using the proxy wrapper (`proxyBaseUrl` is not `null`). When left `undefined`, the API key is set from `BRAINTRUST_API_KEY` if available. Pass `null` to leave the original API key intact, or pass a string to use a custom API key.
 * @returns The wrapped `OpenAI` object.
 */
export function wrapOpenAI<T extends object>(
  openai: T,
  args?: { proxyBaseUrl?: string | null; proxyApiKey?: string | null }
): T {
  if ((openai as any)?.chat?.completions?.create) {
    if (args?.proxyBaseUrl === null) {
      return openAIV4NonProxyWrapper(openai as any) as T;
    } else {
      return openAIV4ProxyWrapper({ openai: openai as any, ...args }) as T;
    }
  } else {
    console.warn("Unsupported OpenAI library (potentially v3). Not wrapping.");
    return openai;
  }
}
