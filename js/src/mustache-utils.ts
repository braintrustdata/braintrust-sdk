import { getObjValueByPath } from "@braintrust/core";
import {
  chatCompletionMessageParamSchema,
  type Message,
} from "@braintrust/core/typespecs";
import Mustache from "mustache";
import { z } from "zod";

export function lintTemplate(
  template: string,
  context: Record<string, unknown>,
) {
  const variables = getMustacheVars(template);
  for (const variable of variables) {
    const arrPathsReplaced = variable[1].replaceAll(/\.\d+/g, ".0");
    const fieldExists =
      getObjValueByPath(context, arrPathsReplaced.split(".")) !== undefined;
    if (!fieldExists) {
      throw new Error(`Variable '${variable[1]}' does not exist.`);
    }
  }
}

function getMustacheVars(prompt: string) {
  try {
    return Mustache.parse(prompt).filter(
      (span) => span[0] === "name" || span[0] === "&",
    );
  } catch {
    return [];
  }
}

// XXX DEELETE
export function renderExtraMessages(
  extraMessages: string,
  context: Record<string, unknown>,
  strict: boolean,
): Message[] {
  const path = extraMessages.split(".");
  const value = getObjValueByPath(context, path);
  if (value === undefined) {
    if (strict) {
      throw new Error(`Variable '${extraMessages}' does not exist.`);
    } else {
      return [];
    }
  }
  const parsed = z.array(chatCompletionMessageParamSchema).safeParse(value);
  if (!parsed.success) {
    if (strict) {
      throw new Error(
        `Variable '${extraMessages}' is not a valid message: ${parsed.error.message}`,
      );
    } else {
      return [];
    }
  } else {
    return parsed.data;
  }
}
