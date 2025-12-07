"use server";

import { openai } from "@ai-sdk/openai";
import * as ai from "ai";
import { wrapAISDK, initLogger } from "braintrust";
import { createStreamableValue } from "@ai-sdk/rsc";
import { PartialNotification, notificationSchema } from "./schema";

initLogger({ projectName: "example-ai-sdk-next-openai-app" });

const { streamObject } =
  (process.env.WRAPPED || "true") === "true" ? wrapAISDK(ai) : ai;

export async function generateNotifications(context: string) {
  const notificationsStream = createStreamableValue<PartialNotification>();

  const result = streamObject({
    model: openai("gpt-5-mini"),
    prompt: `Generate 3 notifications for a messages app in this context: ${context}`,
    schema: notificationSchema,
  });

  try {
    for await (const partialObject of result.partialObjectStream) {
      notificationsStream.update(partialObject);
    }
  } finally {
    notificationsStream.done();
  }

  return notificationsStream.value;
}
