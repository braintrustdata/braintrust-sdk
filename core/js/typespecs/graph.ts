import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { promptBlockDataSchema } from "./prompt";

extendZodWithOpenApi(z);

// Define a placeholder for functionIdSchema
// This approach creates a reference to the type with OpenAPI metadata
// We can't use z.lazy directly as it's not supported by zod-to-openapi
const functionIdRef = z.object({}).passthrough().openapi("FunctionId", {
  description: "Options for identifying a function",
});

const graphElemIdSchema = z.string().max(1024);

const nodeIdSchema = graphElemIdSchema.describe(
  "The id of the node in the graph",
);
const edgeIdSchema = graphElemIdSchema.describe(
  "The id of the edge in the graph",
);

const baseNodeDataSchema = z.object({
  description: z.string().nullish().describe("The description of the node"),
  position: z
    .object({
      x: z.number().describe("The x position of the node"),
      y: z.number().describe("The y position of the node"),
    })
    .nullish()
    .describe("The position of the node"),
});

export const graphNodeSchema = z.union([
  baseNodeDataSchema.extend({
    type: z.literal("function"),
    function: functionIdRef,
  }),
  baseNodeDataSchema.extend({
    type: z.literal("input").describe("The input to the graph"),
  }),
  baseNodeDataSchema.extend({
    type: z.literal("output").describe("The output of the graph"),
  }),
  baseNodeDataSchema.extend({
    type: z.literal("literal"),
    value: z.unknown().describe("A literal value to be returned"),
  }),
  baseNodeDataSchema.extend({
    type: z.literal("btql"),
    expr: z.string().describe("A BTQL expression to be evaluated"),
  }),
  baseNodeDataSchema.extend({
    type: z.literal("gate"),
    condition: z
      .string()
      .nullish()
      .describe("A BTQL expression to be evaluated"),
  }),
  baseNodeDataSchema.extend({
    type: z.literal("aggregator"),
  }),
  baseNodeDataSchema.extend({
    type: z.literal("prompt_template"),
    prompt: promptBlockDataSchema,
  }),
]);
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeDataSchema = z.object({
  node: nodeIdSchema,
  variable: z.string(),
});

export const graphEdgeSchema = z.object({
  source: graphEdgeDataSchema,
  target: graphEdgeDataSchema,
  purpose: z
    .enum(["control", "data", "messages"])
    .describe("The purpose of the edge"),
});

export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphDataSchema = z.object({
  type: z.literal("graph"),
  // Use record so that updates can be efficient
  nodes: z.record(nodeIdSchema, graphNodeSchema),
  edges: z.record(edgeIdSchema, graphEdgeSchema),
});

export type GraphData = z.infer<typeof graphDataSchema>;
