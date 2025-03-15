import { z } from "zod";
import { functionIdSchema } from "./functions";

export const nodeIdSchema = z
  .string()
  .max(16384)
  .describe("The id of the node");

export const nodeDataSchema = z.union([
  z.object({
    type: z.literal("function"),
    function: functionIdSchema,
  }),
  z.object({
    type: z.literal("input").describe("The input to the graph"),
  }),
  z.object({
    type: z.literal("output").describe("The output of the graph"),
  }),
  z.object({
    type: z.literal("literal"),
    value: z.unknown().describe("A literal value to be returned"),
  }),
  z.object({
    type: z.literal("if"),
  }),
]);

export const graphNodeSchema = z.object({
  id: nodeIdSchema,
  description: z.string().nullish().describe("The description of the node"),
  data: nodeDataSchema,
});

export const graphDataSchema = z.object({
  type: z.literal("graph"),
  nodes: z.array(graphNodeSchema),
  edges: z.array(
    z.object({
      source: nodeIdSchema,
      target: nodeIdSchema,
      variable: z.string().describe("The variable name for the edge"),
    }),
  ),
});

export type GraphData = z.infer<typeof graphDataSchema>;
