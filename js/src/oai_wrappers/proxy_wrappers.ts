import { _internalGetGlobalState, currentSpan } from "../logger";

function getProxyBaseUrlDefault({ version }: { version: number }): string {
  return (
    process.env["BRAINTRUST_PROXY_URL"] ??
    `https://braintrustproxy.com/v${version}`
  );
}

function getProxyApiKeyDefault(): string | undefined {
  return process.env["BRAINTRUST_API_KEY"];
}

// Defined in
// https://github.com/braintrustdata/braintrust-proxy/blob/main/packages/proxy/src/tracing.ts.
const PARENT_SPAN_HEADER = "x-bt-parent-span";
const SERIALIZED_STATE_HEADER = "x-bt-serialized-state";

type Fetch = (url: RequestInfo, init?: RequestInit) => Promise<Response>;

function wrapFetch(origFetch: Fetch): Fetch {
  return async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
    const augmentedInit = init ?? ({} as RequestInit);
    if (!(augmentedInit.headers instanceof Headers)) {
      augmentedInit.headers = new Headers(augmentedInit.headers);
    }
    augmentedInit.headers.set(PARENT_SPAN_HEADER, currentSpan().serialize());
    augmentedInit.headers.set(
      SERIALIZED_STATE_HEADER,
      _internalGetGlobalState().serializeLoginInfo()
    );
    return await origFetch(url, augmentedInit);
  };
}

// This wraps v4 versions of the openai module, eg.
// https://github.com/openai/openai-node/tree/v4.22.1.
export function openAIV4ProxyWrapper({
  openai,
  proxyBaseUrl,
  proxyApiKey,
}: {
  openai: any;
  proxyBaseUrl?: string | null;
  proxyApiKey?: string | null;
}) {
  if (proxyBaseUrl === undefined) {
    proxyBaseUrl = getProxyBaseUrlDefault({ version: 1 });
  }
  if (proxyBaseUrl) {
    openai.baseURL = proxyBaseUrl;
  }

  if (proxyApiKey === undefined) {
    proxyApiKey = getProxyApiKeyDefault();
  }
  if (proxyApiKey) {
    openai.apiKey = proxyApiKey;
  }

  openai.fetch = wrapFetch(openai.fetch);
  return openai;
}
