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
  .object({
    filter: z.array(customTypes.any).nullish(),
    tag: z.array(customTypes.any).nullish(),
    match: z.array(customTypes.any).nullish(),
    sort: z.array(customTypes.any).nullish(),
  })
  .strip()
  .openapi("ViewDataSearch");
export const viewDataSchema = z
  .object({
    search: viewDataSearchSchema.nullish(),
  })
  .strip()
  .openapi("ViewData");
export type ViewData = z.infer<typeof viewDataSchema>;

export const viewOptionsSchema = z
  .object({
    columnVisibility: z.record(z.boolean()).nullish(),
    columnOrder: z.array(z.string()).nullish(),
    columnSizing: z.record(z.number()).nullish(),
  })
  .strip()
  .openapi("ViewOptions");
export type ViewOptions = z.infer<typeof viewOptionsSchema>;
