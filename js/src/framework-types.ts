import { IfExists } from "@braintrust/core/typespecs";
import { z } from "zod";

export type GenericFunction<Input, Output> =
  | ((input: Input) => Output)
  | ((input: Input) => Promise<Output>);

export type Schema<Input, Output> = Partial<{
  parameters: z.ZodSchema<Input>;
  returns: z.ZodSchema<Output>;
}>;

interface BaseFnOpts {
  name: string;
  slug: string;
  description: string;
  ifExists: IfExists;
}

export type ToolOpts<
  Params,
  Returns,
  Fn extends GenericFunction<Params, Returns>,
> = Partial<BaseFnOpts> & {
  handler: Fn;
} & Schema<Params, Returns>;