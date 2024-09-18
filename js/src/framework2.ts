import path from "path";
import { wrapTraced } from "./logger";
import slugifyLib from "slugify";
import { _initializeSpanContext, GenericFunction } from "./framework";
import { z } from "zod";
import { FunctionType } from "@braintrust/core/typespecs";

type NameOrId = { name: string } | { id: string };
type IfExists = "error" | "ignore" | "replace";
const DEFAULT_IF_EXISTS: IfExists = "error";

export type CreateProjectOpts = NameOrId & { ifExists?: IfExists };
class ProjectBuilder {
  create(opts: CreateProjectOpts) {
    return new Project(opts);
  }
}
export const project = new ProjectBuilder();

export class Project {
  public readonly name?: string;
  public readonly id?: string;
  private ifExists?: IfExists;
  public tool: ToolBuilder;

  constructor(args: CreateProjectOpts) {
    _initializeSpanContext();
    this.name = "name" in args ? args.name : undefined;
    this.id = "id" in args ? args.id : undefined;
    this.ifExists = args.ifExists ?? DEFAULT_IF_EXISTS;
    this.tool = new ToolBuilder(this);
  }
}

export class ToolBuilder {
  private taskCounter = 0;
  constructor(private readonly project: Project) {}

  public create<Input, Output, Fn extends GenericFunction<Input, Output>>(
    opts: ToolOpts<Input, Output, Fn>,
  ): CodeFunction<Input, Output, Fn> {
    this.taskCounter++;
    opts = opts ?? {};

    const { handler, name, slug, ...rest } = opts;
    let resolvedName = name ?? handler.name;

    if (resolvedName.trim().length === 0) {
      resolvedName = `Tool ${path.basename(__filename)} ${this.taskCounter}`;
    }

    const tool: CodeFunction<Input, Output, Fn> = new CodeFunction(
      this.project,
      {
        handler,
        name: resolvedName,
        slug: slug ?? slugifyLib(resolvedName, { lower: true, strict: true }),
        type: "tool",
        ...rest,
      },
    );

    if (globalThis._lazy_load) {
      globalThis._evals.functions.push(
        tool as CodeFunction<
          unknown,
          unknown,
          GenericFunction<unknown, unknown>
        >,
      );
    }

    return tool;
  }
}

type Schema<Input, Output> = Partial<{
  parameters: z.ZodSchema<Input>;
  returns: z.ZodSchema<Output>;
}>;

export type ToolOpts<
  Params,
  Returns,
  Fn extends GenericFunction<Params, Returns>,
> = {
  name?: string;
  slug?: string;
  description?: string;
  handler: Fn;
  ifExists?: IfExists;
} & Schema<Params, Returns>;

export class CodeFunction<
  Input,
  Output,
  Fn extends GenericFunction<Input, Output>,
> {
  public readonly handler: Fn;
  public readonly name: string;
  public readonly slug: string;
  public readonly type: FunctionType;
  public readonly description?: string;
  public readonly parameters?: z.ZodSchema<Input>;
  public readonly returns?: z.ZodSchema<Output>;

  private ifExists: IfExists;
  private wrappedHandler: Fn;

  constructor(
    public readonly project: Project,
    opts: Omit<ToolOpts<Input, Output, Fn>, "name" | "slug"> & {
      name: string;
      slug: string;
      type: FunctionType;
    },
  ) {
    this.handler = opts.handler;

    this.name = opts.name;
    this.slug = opts.slug;
    this.description = opts.description;
    this.type = opts.type;

    this.ifExists = opts.ifExists ?? DEFAULT_IF_EXISTS;

    this.parameters = opts.parameters;
    this.returns = opts.returns;

    if (this.returns && !this.parameters) {
      throw new Error("parameters are required if return type is defined");
    }

    this.wrappedHandler = wrapTraced(this.handler, {
      name: this.name,
      asyncFlush: true,
    }) as Fn;
  }
}
