import path from "path";
import slugifyLib from "slugify";
import { _initializeSpanContext } from "./framework";
import { z } from "zod";
import {
  FunctionType,
  IfExists,
  Message,
  ModelParams,
  SavedFunctionId,
  PromptBlockData,
  PromptData,
  toolFunctionDefinitionSchema,
  type ToolFunctionDefinition,
} from "@braintrust/core/typespecs";
import { TransactionId } from "@braintrust/core";
import { Prompt, PromptRowWithId } from "./logger";
import { GenericFunction } from "./framework-types";

export { toolFunctionDefinitionSchema, ToolFunctionDefinition };

type NameOrId = { name: string } | { id: string };

export type CreateProjectOpts = NameOrId;
class ProjectBuilder {
  create(opts: CreateProjectOpts) {
    return new Project(opts);
  }
}
export const projects = new ProjectBuilder();

export class Project {
  public readonly name?: string;
  public readonly id?: string;
  public tools: ToolBuilder;
  public prompts: PromptBuilder;
  public scorers: ScorerBuilder;

  constructor(args: CreateProjectOpts) {
    _initializeSpanContext();
    this.name = "name" in args ? args.name : undefined;
    this.id = "id" in args ? args.id : undefined;
    this.tools = new ToolBuilder(this);
    this.prompts = new PromptBuilder(this);
    this.scorers = new ScorerBuilder(this);
  }
}

export class ToolBuilder {
  private taskCounter = 0;
  constructor(private readonly project: Project) {}

  public create<Input, Output, Fn extends GenericFunction<Input, Output>>(
    opts: CodeOpts<Input, Output, Fn>,
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
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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

export class ScorerBuilder {
  private taskCounter = 0;
  constructor(private readonly project: Project) {}

  public create<
    Output,
    Input,
    Params,
    Returns,
    Fn extends GenericFunction<
      Exact<Params, ScorerArgs<Output, Input>>,
      Returns
    >,
  >(opts: ScorerOpts<Output, Input, Params, Returns, Fn>) {
    this.taskCounter++;

    let resolvedName = opts.name;
    if (!resolvedName && "handler" in opts) {
      resolvedName = opts.handler.name;
    }
    if (!resolvedName || resolvedName.trim().length === 0) {
      resolvedName = `Scorer ${path.basename(__filename)} ${this.taskCounter}`;
    }
    const slug =
      opts.slug ?? slugifyLib(resolvedName, { lower: true, strict: true });

    if ("handler" in opts) {
      const scorer: CodeFunction<
        Exact<Params, ScorerArgs<Output, Input>>,
        Returns,
        Fn
      > = new CodeFunction(this.project, {
        ...opts,
        name: resolvedName,
        slug,
        type: "scorer",
      });
      if (globalThis._lazy_load) {
        globalThis._evals.functions.push(
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          scorer as CodeFunction<
            unknown,
            unknown,
            GenericFunction<unknown, unknown>
          >,
        );
      }
    } else {
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
      const promptData: PromptData = {
        prompt: promptBlock,
        options: {
          model: opts.model,
          params: opts.params,
        },
        parser: {
          type: "llm_classifier",
          use_cot: opts.useCot,
          choice_scores: opts.choiceScores,
        },
      };
      const codePrompt = new CodePrompt(
        this.project,
        promptData,
        [],
        {
          ...opts,
          name: resolvedName,
          slug,
        },
        "scorer",
      );
      if (globalThis._lazy_load) {
        globalThis._evals.prompts.push(codePrompt);
      }
    }
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

export type CodeOpts<
  Params,
  Returns,
  Fn extends GenericFunction<Params, Returns>,
> = Partial<BaseFnOpts> & {
  handler: Fn;
} & Schema<Params, Returns>;

type ScorerPromptOpts = Partial<BaseFnOpts> &
  PromptOpts<false, false, false, false> & {
    useCot: boolean;
    choiceScores: Record<string, number>;
  };

// A more correct ScorerArgs than that in core/js/src/score.ts.
type ScorerArgs<Output, Input> = {
  output: Output;
  expected?: Output;
  input?: Input;
  metadata?: Record<string, unknown>;
};

type Exact<T, Shape> = T extends Shape
  ? Exclude<keyof T, keyof Shape> extends never
    ? T
    : never
  : never;

export type ScorerOpts<
  Output,
  Input,
  Params,
  Returns,
  Fn extends GenericFunction<Exact<Params, ScorerArgs<Output, Input>>, Returns>,
> =
  | CodeOpts<Exact<Params, ScorerArgs<Output, Input>>, Returns, Fn>
  | ScorerPromptOpts;

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
  public readonly ifExists?: IfExists;

  constructor(
    public readonly project: Project,
    opts: Omit<CodeOpts<Input, Output, Fn>, "name" | "slug"> & {
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

    this.ifExists = opts.ifExists;

    this.parameters = opts.parameters;
    this.returns = opts.returns;

    if (this.returns && !this.parameters) {
      throw new Error("parameters are required if return type is defined");
    }
  }

  public key(): string {
    return JSON.stringify([
      this.project.id ?? "",
      this.project.name ?? "",
      this.slug,
    ]);
  }
}

type GenericCodeFunction = CodeFunction<
  // This has to be marked as any because we want to support arrays of
  // functions that return different things.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GenericFunction<any, any>
>;

export class CodePrompt {
  public readonly project: Project;
  public readonly name: string;
  public readonly slug: string;
  public readonly prompt: PromptData;
  public readonly ifExists?: IfExists;
  public readonly description?: string;
  public readonly id?: string;
  public readonly functionType?: FunctionType;
  public readonly toolFunctions: (SavedFunctionId | GenericCodeFunction)[];

  constructor(
    project: Project,
    prompt: PromptData,
    toolFunctions: (SavedFunctionId | GenericCodeFunction)[],
    opts: Omit<PromptOpts<false, false, false, false>, "name" | "slug"> & {
      name: string;
      slug: string;
    },
    functionType?: FunctionType,
  ) {
    this.project = project;
    this.name = opts.name;
    this.slug = opts.slug;
    this.prompt = prompt;
    this.toolFunctions = toolFunctions;
    this.ifExists = opts.ifExists;
    this.description = opts.description;
    this.id = opts.id;
    this.functionType = functionType;
  }
}

interface PromptId {
  id: string;
}

interface PromptVersion {
  version: TransactionId;
}

interface PromptTools {
  tools: (GenericCodeFunction | SavedFunctionId | ToolFunctionDefinition)[];
}

interface PromptNoTrace {
  noTrace: boolean;
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
  HasTools extends boolean = true,
  HasNoTrace extends boolean = true,
> = (Partial<Omit<BaseFnOpts, "name">> & { name: string }) &
  (HasId extends true ? PromptId : Partial<PromptId>) &
  (HasVersion extends true ? PromptVersion : Partial<PromptVersion>) &
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  (HasTools extends true ? Partial<PromptTools> : {}) &
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  (HasNoTrace extends true ? Partial<PromptNoTrace> : {}) &
  PromptContents & {
    model: string;
    params?: ModelParams;
  };
export class PromptBuilder {
  constructor(private readonly project: Project) {}

  public create<
    HasId extends boolean = false,
    HasVersion extends boolean = false,
  >(opts: PromptOpts<HasId, HasVersion>): Prompt<HasId, HasVersion> {
    const toolFunctions: (SavedFunctionId | GenericCodeFunction)[] = [];
    const rawTools: ToolFunctionDefinition[] = [];

    for (const tool of opts.tools ?? []) {
      if (tool instanceof CodeFunction) {
        toolFunctions.push(tool);
      } else if ("type" in tool && !("function" in tool)) {
        toolFunctions.push(tool);
      } else {
        rawTools.push(tool);
      }
    }

    const promptBlock: PromptBlockData =
      "messages" in opts
        ? {
            type: "chat",
            messages: opts.messages,
            tools:
              rawTools && rawTools.length > 0
                ? JSON.stringify(rawTools)
                : undefined,
          }
        : {
            type: "completion",
            content: opts.prompt,
          };

    const slug =
      opts.slug ?? slugifyLib(opts.name, { lower: true, strict: true });

    const promptData: PromptData = {
      prompt: promptBlock,
      options: {
        model: opts.model,
        params: opts.params,
      },
    };

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const promptRow: PromptRowWithId<HasId, HasVersion> = {
      id: opts.id,
      _xact_id: opts.version,
      name: opts.name,
      slug: slug,
      prompt_data: promptData,
    } as PromptRowWithId<HasId, HasVersion>;

    const prompt = new Prompt<HasId, HasVersion>(
      promptRow,
      {}, // It doesn't make sense to specify defaults here.
      opts.noTrace ?? false,
    );

    const codePrompt = new CodePrompt(this.project, promptData, toolFunctions, {
      ...opts,
      slug,
    });

    if (globalThis._lazy_load) {
      globalThis._evals.prompts.push(codePrompt);
    }

    return prompt;
  }
}
