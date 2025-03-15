import { z } from "zod";
import { functionIdSchema } from "./functions";

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
  id: z.string().uuid().describe("The id of the node"),
  data: nodeDataSchema,
  description: z.string().describe("The description of the node"),
});

export const graphDataSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(
    z.object({
      source: z.string().uuid().describe("The id of the source node"),
      target: z.string().uuid().describe("The id of the target node"),
      variable: z.string().describe("The variable name for the edge"),
    }),
  ),
});

export type GraphData = z.infer<typeof graphDataSchema>;
