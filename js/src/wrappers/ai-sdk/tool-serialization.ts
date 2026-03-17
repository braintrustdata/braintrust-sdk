import { zodToJsonSchema } from "../../zod/utils";
import type {
  AISDKOutputResponseFormat,
  AISDKTool,
  AISDKTools,
} from "../../vendor-sdk-types/ai-sdk";

function isZodSchema(value: unknown): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    "_def" in value &&
    typeof (value as { _def?: unknown })._def === "object"
  );
}

function serializeZodSchema(schema: unknown): AISDKOutputResponseFormat {
  try {
    return zodToJsonSchema(schema as any) as AISDKOutputResponseFormat;
  } catch {
    return {
      type: "object",
      description: "Zod schema (conversion failed)",
    };
  }
}

function serializeTool(tool: AISDKTool): AISDKTool {
  if (!tool || typeof tool !== "object") {
    return tool;
  }

  const serialized = { ...tool };

  if (isZodSchema(serialized.inputSchema)) {
    serialized.inputSchema = serializeZodSchema(serialized.inputSchema);
  }

  if (isZodSchema(serialized.parameters)) {
    serialized.parameters = serializeZodSchema(serialized.parameters);
  }

  if ("execute" in serialized) {
    delete serialized.execute;
  }

  if ("render" in serialized) {
    delete serialized.render;
  }

  return serialized;
}

export function serializeAISDKToolsForLogging(
  tools: AISDKTools | undefined,
): AISDKTools | undefined {
  if (!tools || typeof tools !== "object") {
    return tools;
  }

  if (Array.isArray(tools)) {
    return tools.map(serializeTool);
  }

  const serialized: Record<string, AISDKTool> = {};
  for (const [key, tool] of Object.entries(tools)) {
    serialized[key] = serializeTool(tool);
  }
  return serialized;
}
