export const OPENAI_CHANNEL_SUFFIX = {
  CHAT_COMPLETIONS_CREATE: "chat.completions.create",
  EMBEDDINGS_CREATE: "embeddings.create",
  BETA_CHAT_COMPLETIONS_PARSE: "beta.chat.completions.parse",
  BETA_CHAT_COMPLETIONS_STREAM: "beta.chat.completions.stream",
  MODERATIONS_CREATE: "moderations.create",
  RESPONSES_CREATE: "responses.create",
  RESPONSES_STREAM: "responses.stream",
  RESPONSES_PARSE: "responses.parse",
} as const;

export const OPENAI_CHANNEL = {
  CHAT_COMPLETIONS_CREATE: "orchestrion:openai:chat.completions.create",
  EMBEDDINGS_CREATE: "orchestrion:openai:embeddings.create",
  BETA_CHAT_COMPLETIONS_PARSE: "orchestrion:openai:beta.chat.completions.parse",
  BETA_CHAT_COMPLETIONS_STREAM:
    "orchestrion:openai:beta.chat.completions.stream",
  MODERATIONS_CREATE: "orchestrion:openai:moderations.create",
  RESPONSES_CREATE: "orchestrion:openai:responses.create",
  RESPONSES_STREAM: "orchestrion:openai:responses.stream",
  RESPONSES_PARSE: "orchestrion:openai:responses.parse",
} as const;
