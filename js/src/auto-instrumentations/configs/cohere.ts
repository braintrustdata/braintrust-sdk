import type { InstrumentationConfig } from "../orchestrion-js";
import { cohereChannels } from "../../instrumentation/plugins/cohere-channels";

export const cohereConfigs: InstrumentationConfig[] = [
  {
    channelName: cohereChannels.chat.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.0.0 <8.0.0",
      filePath: "Client.js",
    },
    functionQuery: {
      className: "CohereClient",
      methodName: "chat",
    },
  },
  {
    channelName: cohereChannels.chat.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.0.0 <7.21.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2",
      methodName: "chat",
    },
  },
  {
    channelName: cohereChannels.chat.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.21.0 <8.0.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2Client",
      methodName: "chat",
    },
  },
  {
    channelName: cohereChannels.chat.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=8.0.0 <9.0.0",
      filePath: "Client.js",
    },
    functionQuery: {
      className: "CohereClient",
      methodName: "chat",
    },
  },
  {
    channelName: cohereChannels.chat.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=8.0.0 <9.0.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2Client",
      methodName: "chat",
    },
  },
  {
    channelName: cohereChannels.chatStream.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.0.0 <8.0.0",
      filePath: "Client.js",
    },
    functionQuery: {
      className: "CohereClient",
      methodName: "chatStream",
    },
  },
  {
    channelName: cohereChannels.chatStream.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.0.0 <7.21.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2",
      methodName: "chatStream",
    },
  },
  {
    channelName: cohereChannels.chatStream.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.21.0 <8.0.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2Client",
      methodName: "chatStream",
    },
  },
  {
    channelName: cohereChannels.chatStream.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=8.0.0 <9.0.0",
      filePath: "Client.js",
    },
    functionQuery: {
      className: "CohereClient",
      methodName: "chatStream",
    },
  },
  {
    channelName: cohereChannels.chatStream.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=8.0.0 <9.0.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2Client",
      methodName: "chatStream",
    },
  },
  {
    channelName: cohereChannels.embed.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.0.0 <8.0.0",
      filePath: "Client.js",
    },
    functionQuery: {
      className: "CohereClient",
      methodName: "embed",
    },
  },
  {
    channelName: cohereChannels.embed.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.0.0 <7.21.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2",
      methodName: "embed",
    },
  },
  {
    channelName: cohereChannels.embed.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.21.0 <8.0.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2Client",
      methodName: "embed",
    },
  },
  {
    channelName: cohereChannels.embed.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=8.0.0 <9.0.0",
      filePath: "Client.js",
    },
    functionQuery: {
      className: "CohereClient",
      methodName: "embed",
    },
  },
  {
    channelName: cohereChannels.embed.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=8.0.0 <9.0.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2Client",
      methodName: "embed",
    },
  },
  {
    channelName: cohereChannels.rerank.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.0.0 <8.0.0",
      filePath: "Client.js",
    },
    functionQuery: {
      className: "CohereClient",
      methodName: "rerank",
    },
  },
  {
    channelName: cohereChannels.rerank.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.0.0 <7.21.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2",
      methodName: "rerank",
    },
  },
  {
    channelName: cohereChannels.rerank.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=7.21.0 <8.0.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2Client",
      methodName: "rerank",
    },
  },
  {
    channelName: cohereChannels.rerank.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=8.0.0 <9.0.0",
      filePath: "Client.js",
    },
    functionQuery: {
      className: "CohereClient",
      methodName: "rerank",
    },
  },
  {
    channelName: cohereChannels.rerank.channelName,
    module: {
      name: "cohere-ai",
      versionRange: ">=8.0.0 <9.0.0",
      filePath: "api/resources/v2/client/Client.js",
    },
    functionQuery: {
      className: "V2Client",
      methodName: "rerank",
    },
  },
];
