import { z } from "zod";

export const INVOKE_API_VERSION = 1;

export const functionIdSchema = z.union([
  z.object({
    function_id: z.string(),
    version: z.string().optional(),
  }),
  z.object({
    prompt_session_id: z.string(),
    prompt_session_function_id: z.string(),
    version: z.string().optional(),
  }),
  z.object({
    project_name: z.string(),
    slug: z.string(),
    version: z.string().optional(),
  }),
  z.object({
    global_function: z.string(),
  }),
]);
export type FunctionId = z.infer<typeof functionIdSchema>;

// NOTE: After a few attempts to make this work with strictObject, I gave up, which means
// that if the value we're parsing contains extraneous fields, we'll ignore them instead of
// returning an error.
export const useFunctionSchema = z
  .object({
    api_version: z.number().optional().default(INVOKE_API_VERSION),
  })
  .and(functionIdSchema);

export const invokeFunctionSchema = useFunctionSchema.and(
  z.object({
    input: z.any().optional(),
    parent: z.string().optional(),
    stream: z.boolean().optional(),
  }),
);
export type InvokeFunctionRequest = z.infer<typeof invokeFunctionSchema>;

export const baseSSEEventSchema = z.strictObject({
  id: z.string().optional(),
  data: z.string(),
});

// This should eventually move into the typespecs in @braintrust/core
//
export const sseTextEventSchema = baseSSEEventSchema
  .merge(
    z.strictObject({
      event: z.literal("text_delta"),
    }),
  )
  .strip();

export const sseDataEventSchema = baseSSEEventSchema
  .merge(
    z.strictObject({
      event: z.literal("json_delta"),
    }),
  )
  .strip();

export const sseDoneEventSchema = baseSSEEventSchema
  .omit({ data: true })
  .merge(
    z.strictObject({
      event: z.literal("done"),
      data: z.literal(""),
    }),
  )
  .strip();

export const callEventSchema = z.union([
  sseTextEventSchema,
  sseDataEventSchema,
  sseDoneEventSchema,
]);

export type CallEventSchema = z.infer<typeof callEventSchema>;

export function getFunctionId<T extends FunctionId>(functionId: T): FunctionId {
  if ("function_id" in functionId) {
    return { function_id: functionId.function_id, version: functionId.version };
  } else if ("prompt_session_id" in functionId) {
    return {
      prompt_session_id: functionId.prompt_session_id,
      prompt_session_function_id: functionId.prompt_session_function_id,
      version: functionId.version,
    };
  } else if ("project_name" in functionId) {
    return {
      project_name: functionId.project_name,
      slug: functionId.slug,
      version: functionId.version,
    };
  } else {
    return { global_function: functionId.global_function };
  }
}
