import { z } from "zod";
import { customTypes } from "./custom_types";

export const viewTypeEnum = z
  .enum([
    "projects",
    "logs",
    "experiments",
    "datasets",
    "prompts",
    "prompt_sessions",
  ])
  .describe("The type of table that the view applies to");
export type ViewType = z.infer<typeof viewTypeEnum>;

export const viewDataSearchSchema = z
  .strictObject({
    filter: z.array(customTypes.any).nullish(),
    tag: z.array(customTypes.any).nullish(),
    match: z.array(customTypes.any).nullish(),
    sort: z.array(customTypes.any).nullish(),
    // filter: z.array(z.string()).nullish(),
    // tag: z.array(z.string()).nullish(),
    // match: z.array(z.string()).nullish(),
    // sort: z.array(z.string()).nullish(),
  })
  .openapi("ViewDataSearch");

export const viewDataSchema = z
  .strictObject({
    search: viewDataSearchSchema.nullish(),
    table: customTypes.any.nullish(),
  })
  .openapi("ViewData");

export type ViewData = z.infer<typeof viewDataSchema>;
