import path from "path";
import slugifyLib from "slugify";
import { _initializeSpanContext } from "./framework";
import { z } from "zod";
import {
  FunctionType,
  IfExists,
  DEFAULT_IF_EXISTS,
  Message,
  ModelParams,
  SavedFunctionId,
  PromptBlockData,
} from "@braintrust/core/typespecs";
import { TransactionId } from "@braintrust/core";
import { Prompt, PromptRowWithId } from "./logger";
import { GenericFunction } from "./framework-types";

type NameOrId = { name: string } | { id: string };

export type CreateProjectOpts = NameOrId;
class ProjectBuilder {
  create(opts: CreateProjectOpts) {
    return new Project(opts);
  }
}
export const project = new ProjectBuilder();

export class Project {
  public readonly name?: string;
  public readonly id?: string;
  public tool: ToolBuilder;
  public prompt: PromptBuilder;

  constructor(args: CreateProjectOpts) {
    _initializeSpanContext();
    this.name = "name" in args ? args.name : undefined;
    this.id = "id" in args ? args.id : undefined;
    this.tool = new ToolBuilder(this);
    this.prompt = new PromptBuilder(this);
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
  public readonly ifExists: IfExists;

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
  }
}

export interface ToolFunctionDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown> | z.ZodSchema<Record<string, unknown>>;
  strict?: boolean | null;
}

interface PromptId {
  id: string;
  projectId: string;
}

interface PromptVersion {
  version: TransactionId;
}

// This roughly maps to promptBlockDataSchema, but is more ergonomic for the user.
type PromptContents =
  | {
      prompt: string;
    }
  | {
      messages: Message[];
    };

export type PromptOpts<
  HasId extends boolean,
  HasVersion extends boolean,
> = (Partial<Omit<BaseFnOpts, "name">> & { name: string }) &
  (HasId extends true ? PromptId : Partial<PromptId>) &
  (HasVersion extends true ? PromptVersion : Partial<PromptVersion>) &
  PromptContents & {
    model: string;
    params?: ModelParams;
    tools?: (SavedFunctionId | ToolFunctionDefinition)[];
    noTrace?: boolean;
  };

export class PromptBuilder {
  constructor(private readonly project: Project) {}

  public create<
    HasId extends boolean = false,
    HasVersion extends boolean = false,
  >(opts: PromptOpts<HasId, HasVersion>): Prompt<HasId, HasVersion> {
    const promptBlock: PromptBlockData =
      "messages" in opts
        ? {
            type: "chat",
            messages: opts.messages,
          }
        : {
            type: "completion",
            content: opts.prompt,
          };

    const slug =
      opts.slug ?? slugifyLib(opts.name, { lower: true, strict: true });

    const prompt = new Prompt<HasId, HasVersion>(
      {
        id: opts.id,
        project_id: opts.projectId,
        _xact_id: opts.version,
        name: opts.name,
        slug: slug,
        prompt_data: {
          prompt: promptBlock,
          model: opts.model,
          params: opts.params,
          tools: opts.tools,
        },
      } as PromptRowWithId<HasId, HasVersion>,
      {}, // It doesn't make sense to specify defaults here.
      opts.noTrace ?? false,
    );

    if (globalThis._lazy_load) {
      globalThis._evals.prompts.push(
        prompt as Prompt /* this is needed because of HasId, HasVersion*/,
      );
    }

    return prompt;
  }
}
