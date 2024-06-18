import { z } from "zod";
import { customTypes } from "./custom_types";

export const viewTypeEnum = z
  .enum([
    "projects",
    "logs",
    "experiments",
    "datasets",
    "prompts",
    "playgrounds",
    "experiment",
    "dataset",
  ])
  .describe("Type of table that the view corresponds to.");
export type ViewType = z.infer<typeof viewTypeEnum>;

export const viewDataSearchSchema = z
  .strictObject({
    filter: z.array(customTypes.any).nullish(),
    tag: z.array(customTypes.any).nullish(),
    match: z.array(customTypes.any).nullish(),
    sort: z.array(customTypes.any).nullish(),
  })
  .openapi("ViewDataSearch");
export const viewDataSchema = z
  .strictObject({
    search: viewDataSearchSchema.nullish(),
  })
  .openapi("ViewData");
export type ViewData = z.infer<typeof viewDataSchema>;

export const viewOptionsSchema = z
  .strictObject({
    columnVisibility: z.record(z.boolean()).nullish(),
    columnOrder: z.array(z.string()).nullish(),
    columnSizing: z.record(z.number()).nullish(),
  })
  .openapi("ViewOptions");
export type ViewOptions = z.infer<typeof viewOptionsSchema>;
