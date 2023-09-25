// TODO REPLACE WITH autoevals version
// https://github.com/braintrustdata/braintrust/issues/218

import { Configuration, OpenAIApi } from "openai";

let _openai: OpenAIApi | null = null;
export function openAI() {
  if (_openai === null && process.env.OPENAI_API_KEY) {
    const config = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
    _openai = new OpenAIApi(config);
  }
  return _openai;
}

export async function chatCompletion(args: any) {
  const openai = openAI();
  if (openai === null) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const completion = await openai.createChatCompletion(args);
  const data = completion.data;
  return data;
}
