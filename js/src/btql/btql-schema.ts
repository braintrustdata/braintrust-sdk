import { z } from "zod";

export default z
  .object({
    dimensions: z.union([z.array(z.any()), z.null()]).optional(),
    pivot: z.union([z.array(z.any()), z.null()]).optional(),
    unpivot: z.union([z.array(z.any()), z.null()]).optional(),
    measures: z.union([z.array(z.any()), z.null()]).optional(),
    select: z
      .union([z.array(z.union([z.any(), z.any()])), z.null()])
      .optional(),
    infer: z.union([z.array(z.union([z.any(), z.any()])), z.null()]).optional(),
    filter: z.union([z.any(), z.null()]).optional(),
    from: z.union([z.union([z.any(), z.any()]), z.null()]).optional(),
    sort: z.union([z.array(z.any()), z.null()]).optional(),
    limit: z.union([z.number().int(), z.null()]).optional(),
    cursor: z.union([z.string(), z.null()]).optional(),
    comparison_key: z.union([z.any(), z.null()]).optional(),
    weighted_scores: z.union([z.array(z.any()), z.null()]).optional(),
    custom_columns: z.union([z.array(z.any()), z.null()]).optional(),
    preview_length: z.union([z.number().int(), z.null()]).optional(),
    inference_budget: z.union([z.number().int(), z.null()]).optional(),
    sample: z.union([z.any(), z.null()]).optional(),
  })
  .strict();
