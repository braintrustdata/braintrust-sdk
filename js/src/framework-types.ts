import { type IfExistsType as IfExists } from "./generated_types";
import { z } from "zod";

// Type to accept both regular Zod schemas and OpenAPI-extended ones
type ZodSchema<T = any> =
  | z.ZodType<T, any, any>
  | (z.ZodType<T, any, any> & { openapi?: any });

export type GenericFunction<Input, Output> =
  | ((input: Input) => Output)
  | ((input: Input) => Promise<Output>);

export type Schema<Input, Output> = Partial<{
  parameters: ZodSchema<Input>;
  returns: ZodSchema<Output>;
}>;

interface BaseFnOpts {
  name: string;
  slug: string;
  description: string;
  ifExists: IfExists;
  metadata?: Record<string, unknown>;
}

export type ToolOpts<
  Params,
  Returns,
  Fn extends GenericFunction<Params, Returns>,
> = Partial<BaseFnOpts> & {
  handler: Fn;
} & Schema<Params, Returns>;
