import { _internalGetGlobalState, getSpanParentObject } from "../logger";

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
// https://github.com/braintrustdata/braintrust-proxy/blob/main/packages/proxy/src/proxy.ts.
const ORG_NAME_HEADER = "x-bt-org-name";
const PARENT_SPAN_HEADER = "x-bt-parent-span";

type Fetch = (url: RequestInfo, init?: RequestInit) => Promise<Response>;

function wrapFetch(origFetch: Fetch): Fetch {
  return async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
    const augmentedInit = init ?? ({} as RequestInit);
    if (!(augmentedInit.headers instanceof Headers)) {
      augmentedInit.headers = new Headers(augmentedInit.headers);
    }
    augmentedInit.headers.set(
      PARENT_SPAN_HEADER,
      getSpanParentObject().serialize()
    );
    // Serializing the parent object should trigger lazy-login for any
    // lazily-initialized objects, so the global state should also be
    // initialized.
    const orgName = _internalGetGlobalState().orgName;
    if (orgName) {
      augmentedInit.headers.set(ORG_NAME_HEADER, orgName);
    }
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
