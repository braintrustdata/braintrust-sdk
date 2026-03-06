import type {
  OpenAIBeta,
  OpenAIChat,
  OpenAIEmbeddings,
  OpenAIModerations,
  OpenAIResponses,
} from "./openai-common";

export interface OpenAIV4Client {
  chat: OpenAIChat;
  embeddings: OpenAIEmbeddings;
  moderations: OpenAIModerations;
  beta?: OpenAIBeta;
  responses?: OpenAIResponses;
}
