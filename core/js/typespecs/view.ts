import { z } from "zod";

export const viewDataSearchSchema = z
  .strictObject({
    filter: z.array(z.string()).nullish(),
    tag: z.array(z.string()).nullish(),
    match: z.array(z.string()).nullish(),
    sort: z.array(z.string()).nullish(),
  })
  .openapi("ViewDataSearch");

export const viewDataSchema = z
  .strictObject({
    search: viewDataSearchSchema.nullish(),
  })
  .openapi("ViewData");

export type ViewData = z.infer<typeof viewDataSchema>;
