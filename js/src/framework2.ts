import { _initializeSpanContext } from "./framework";
import type { Trace } from "./trace";
import iso from "./isomorph";
import { slugify } from "../util/string_util";
import { z } from "zod/v3";
import { Project as projectSchema } from "./sdk-schemas";
import type {
  FunctionTypeEnum as FunctionType,
  IfExists,
  PromptData,
  ToolFunctionDefinition,
} from "./sdk-types";
import { loadPrettyXact, TransactionId } from "../util/index";
import {
  _internalGetGlobalState,
  login,
  Prompt,
  PromptRowWithId,
} from "./logger";
import type { BaseFnOpts, GenericFunction } from "./framework-types";
import {
  promptDefinitionToPromptData,
  type PromptDefinition,
} from "./prompt-schemas";
import type { ZodSchema } from "./zod/utils";

// Safe access to __filename (only exists in Node.js CJS)
const currentFilename =
  typeof __filename !== "undefined" ? __filename : "unknown";

type CreateProjectOpts =
  | {
      name: string;
      /**
       * If specified, creates the project inside the project group with this name when the project
       * does not already exist. Requires permission to create projects in that group.
       */
      projectGroupName?: string;
    }
  | { id: string };
class ProjectBuilder {
  create(opts: CreateProjectOpts) {
    return new Project(opts);
  }
}
export const projects = new ProjectBuilder();

class Project {
  public readonly name?: string;
  public readonly id?: string;
  public readonly projectGroupName?: string;
  public prompts: PromptBuilder;
  public scorers: ScorerBuilder;
  public classifiers: ClassifierBuilder;

  private _publishableCodeFunctions: CodeFunction<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    GenericFunction<any, any>
  >[] = [];
  private _publishablePrompts: CodePrompt[] = [];

  constructor(args: CreateProjectOpts) {
    _initializeSpanContext();
    this.name = "name" in args ? args.name : undefined;
    this.id = "id" in args ? args.id : undefined;
    this.projectGroupName = "name" in args ? args.projectGroupName : undefined;
    this.prompts = new PromptBuilder(this);
    this.scorers = new ScorerBuilder(this);
    this.classifiers = new ClassifierBuilder(this);
  }

  public addPrompt(prompt: CodePrompt) {
    this._publishablePrompts.push(prompt);
    if (globalThis._lazy_load) {
      globalThis._evals.prompts.push(prompt);
    }
  }

  public addCodeFunction(
    fn: CodeFunction<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      GenericFunction<any, any>
    >,
  ) {
    this._publishableCodeFunctions.push(fn);
    if (globalThis._lazy_load) {
      globalThis._evals.functions.push(fn);
    }
  }

  async publish() {
    if (globalThis._lazy_load) {
      // eslint-disable-next-line no-restricted-properties -- preserving intentional console usage.
      console.warn("publish() is a no-op when running `bt push`.");
      return;
    }
    await login();
    const functionDefinitions: PromptFunctionEvent[] = [];
    if (this._publishableCodeFunctions.length > 0) {
      // eslint-disable-next-line no-restricted-properties -- preserving intentional console usage.
      console.warn(
        "Code functions cannot be published directly. Use `bt push` instead.",
      );
    }
    if (this._publishablePrompts.length > 0) {
      const projectId =
        this.id ??
        z.object({ project: projectSchema }).parse(
          await _internalGetGlobalState()
            .appConn()
            .post_json("api/project/register", {
              project_name: this.name,
              ...(this.projectGroupName
                ? { project_group_name: this.projectGroupName }
                : {}),
            }),
        ).project.id;
      for (const prompt of this._publishablePrompts) {
        functionDefinitions.push(prompt.toFunctionDefinition(projectId));
      }
    }

    await _internalGetGlobalState().apiConn().post_json("insert-functions", {
      functions: functionDefinitions,
    });
  }
}

class ScorerBuilder {
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
      resolvedName = `Scorer ${iso.basename(currentFilename)} ${this.taskCounter}`;
    }
    const slug =
      opts.slug ?? slugify(resolvedName, { lower: true, strict: true });

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
      this.project.addCodeFunction(scorer);
    } else {
      const promptData: PromptData = {
        ...promptDefinitionToPromptData(opts),
        parser: {
          type: "llm_classifier",
          use_cot: opts.useCot,
          choice_scores: opts.choiceScores,
        },
      };
      const codePrompt = new CodePrompt(
        this.project,
        promptData,
        {
          ...opts,
          name: resolvedName,
          slug,
        },
        "scorer",
      );
      this.project.addPrompt(codePrompt);
    }
  }
}

class ClassifierBuilder {
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
  >(opts: CodeOpts<Exact<Params, ScorerArgs<Output, Input>>, Returns, Fn>) {
    this.taskCounter++;

    let resolvedName = opts.name ?? opts.handler.name;
    if (!resolvedName || resolvedName.trim().length === 0) {
      resolvedName = `Classifier ${iso.basename(currentFilename)} ${this.taskCounter}`;
    }
    const slug =
      opts.slug ?? slugify(resolvedName, { lower: true, strict: true });

    const classifier: CodeFunction<
      Exact<Params, ScorerArgs<Output, Input>>,
      Returns,
      Fn
    > = new CodeFunction(this.project, {
      ...opts,
      name: resolvedName,
      slug,
      type: "classifier",
    });
    this.project.addCodeFunction(classifier);
    return classifier;
  }
}

type CodeOpts<
  Params,
  Returns,
  Fn extends GenericFunction<Params, Returns>,
> = Partial<BaseFnOpts> & {
  handler: Fn;
  parameters?: ZodSchema<Params>;
  returns?: ZodSchema<Returns>;
};

type ScorerPromptOpts = Partial<BaseFnOpts> &
  PromptDefinition & {
    name: string;
    id?: string;
    version?: TransactionId;
    useCot: boolean;
    choiceScores: Record<string, number>;
  };

// A more correct ScorerArgs than that in core/js/src/score.ts.
type ScorerArgs<Output, Input> = {
  output: Output;
  expected?: Output;
  input?: Input;
  metadata?: Record<string, unknown>;
  trace?: Trace;
};

type Exact<T, Shape> = T extends Shape
  ? Exclude<keyof T, keyof Shape> extends never
    ? T
    : never
  : never;

type ScorerOpts<
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
  public readonly parameters?: ZodSchema<Input>;
  public readonly returns?: ZodSchema<Output>;
  public readonly ifExists?: IfExists;
  public readonly tags?: string[];
  public readonly metadata?: Record<string, unknown>;

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
    this.tags = opts.tags;
    this.metadata = opts.metadata;

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

export class CodePrompt {
  public readonly project: Project;
  public readonly name: string;
  public readonly slug: string;
  public readonly prompt: PromptData;
  public readonly ifExists?: IfExists;
  public readonly description?: string;
  public readonly id?: string;
  public readonly functionType?: FunctionType;
  public readonly tags?: string[];
  public readonly metadata?: Record<string, unknown>;
  public readonly environmentSlugs?: string[];

  constructor(
    project: Project,
    prompt: PromptData,
    opts: Partial<BaseFnOpts> & {
      name: string;
      slug: string;
      id?: string;
      environments?: string[];
    },
    functionType?: FunctionType,
  ) {
    this.project = project;
    this.name = opts.name;
    this.slug = opts.slug;
    this.prompt = prompt;
    this.ifExists = opts.ifExists;
    this.description = opts.description;
    this.id = opts.id;
    this.functionType = functionType;
    this.tags = opts.tags;
    this.metadata = opts.metadata;
    this.environmentSlugs = opts.environments;
  }

  toFunctionDefinition(projectId: string): PromptFunctionEvent {
    return {
      project_id: projectId,
      name: this.name,
      slug: this.slug,
      description: this.description ?? "",
      function_data: {
        type: "prompt",
      },
      function_type: this.functionType,
      prompt_data: this.prompt,
      if_exists: this.ifExists,
      tags: this.tags,
      metadata: this.metadata,
      environments:
        this.environmentSlugs && this.environmentSlugs.length > 0
          ? this.environmentSlugs.map((slug) => ({ slug }))
          : undefined,
    };
  }
}

type PromptOpts<
  HasId extends boolean,
  HasVersion extends boolean,
> = Partial<BaseFnOpts> & {
  name: string;
  tools?: ToolFunctionDefinition[];
  noTrace?: boolean;
} & (HasId extends true ? { id: string } : { id?: string }) &
  (HasVersion extends true
    ? { version: TransactionId }
    : { version?: TransactionId }) &
  PromptDefinition;

class PromptBuilder {
  constructor(private readonly project: Project) {}

  public create<
    HasId extends boolean = false,
    HasVersion extends boolean = false,
  >(opts: PromptOpts<HasId, HasVersion>): Prompt<HasId, HasVersion> {
    const slug = opts.slug ?? slugify(opts.name, { lower: true, strict: true });

    const promptData: PromptData = promptDefinitionToPromptData(
      opts,
      opts.tools,
    );

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const promptRow: PromptRowWithId<HasId, HasVersion> = {
      id: opts.id,
      _xact_id: opts.version ? loadPrettyXact(opts.version) : undefined,
      name: opts.name,
      slug: slug,
      prompt_data: promptData,
      tags: opts.tags,
      ...(this.project.id !== undefined ? { project_id: this.project.id } : {}),
    } as PromptRowWithId<HasId, HasVersion>;

    const prompt = new Prompt<HasId, HasVersion>(
      promptRow,
      {}, // It doesn't make sense to specify defaults here.
      opts.noTrace ?? false,
    );

    const codePrompt = new CodePrompt(this.project, promptData, {
      ...opts,
      slug,
    });
    this.project.addPrompt(codePrompt);

    return prompt;
  }
}

interface PromptFunctionEvent {
  prompt_data: PromptData;
  function_data: { type: "prompt" };
  project_id: string;
  slug: string;
  name: string;
  description: string;
  function_type?: FunctionType;
  if_exists?: IfExists;
  tags?: string[];
  metadata?: Record<string, unknown>;
  environments?: { slug: string }[];
}
