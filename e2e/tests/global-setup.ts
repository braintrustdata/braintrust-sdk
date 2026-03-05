import { startMockBraintrustServer } from "./helpers/mock-braintrust-server";

export default async function globalSetup(context: {
  provide: (key: string, value: string) => void;
}) {
  const server = await startMockBraintrustServer();

  context.provide("mockBraintrustApiKey", server.apiKey);
  context.provide("mockBraintrustUrl", server.url);

  return async () => {
    await server.close();
  };
}
