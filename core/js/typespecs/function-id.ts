import { z } from "zod";

export const permanentFunctionId = z
  .union([
    z
      .object({
        function_id: z.string().describe("The ID of the function"),
        version: z.string().optional().describe("The version of the function"),
      })
      .describe("Function id"),
    z
      .object({
        project_name: z
          .string()
          .describe("The name of the project containing the function"),
        slug: z.string().describe("The slug of the function"),
        version: z.string().optional().describe("The version of the function"),
      })
      .describe("Project name and slug"),
    z
      .object({
        global_function: z
          .string()
          .describe(
            "The name of the global function. Currently, the global namespace includes the functions in autoevals",
          ),
      })
      .describe("Global function name"),
    z
      .object({
        prompt_session_id: z.string().describe("The ID of the prompt session"),
        prompt_session_function_id: z
          .string()
          .describe("The ID of the function in the prompt session"),
        version: z.string().optional().describe("The version of the function"),
      })
      .describe("Prompt session id"),
  ])
  .describe("Options for identifying a function");
