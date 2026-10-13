import { expect, expectTypeOf, test } from "vitest";
import { z } from "zod/v3";

import * as publicExports from "./exports";
import type {
  ContextManager,
  ContextParentSpanIds,
  CurrentSpanStore,
  Dataset,
  WorkflowEvalStore,
  EvalScorer,
  EvalTask,
  LangChainCallbackHandlerOptions,
  PropagationContext,
  Span,
  StartSpanArgs,
  TemplateRendererPlugin,
  Trace,
} from "./exports";
import {
  BraintrustLangChainCallbackHandler,
  init,
  initDataset,
  withParent,
} from "./exports";

test("exports only intentional extension types", () => {
  expectTypeOf<Span>().toBeObject();
  expectTypeOf<StartSpanArgs>().toBeObject();
  expectTypeOf<ContextManager>().toBeObject();
  expectTypeOf<ContextParentSpanIds>().toBeObject();
  expectTypeOf<CurrentSpanStore>().toBeObject();
  expectTypeOf<PropagationContext>().toBeObject();
  expectTypeOf(publicExports.configureContextManager).toBeFunction();
  expectTypeOf<Trace>().toBeObject();
  expectTypeOf<WorkflowEvalStore>().toBeObject();
  expectTypeOf<TemplateRendererPlugin>().toBeObject();
  expectTypeOf<LangChainCallbackHandlerOptions>().toBeObject();
  expectTypeOf(BraintrustLangChainCallbackHandler).toBeConstructibleWith();
  expectTypeOf<
    EvalTask<unknown, unknown, unknown, void, never>
  >().toBeFunction();
  expectTypeOf<EvalScorer<unknown, unknown, unknown>>().toBeFunction();
});

test("does not expose deprecated tools or saved configurations", () => {
  expect(publicExports).not.toHaveProperty("loadParameters");
  const project = publicExports.projects.create({ name: "test-project" });
  expect(project).not.toHaveProperty("tools");
  expect(project).not.toHaveProperty("parameters");

  if (false) {
    // @ts-expect-error Saved configurations are no longer supported.
    publicExports.loadParameters;
    // @ts-expect-error Saved tools are no longer supported.
    project.tools;
    // @ts-expect-error Configuration builders are no longer supported.
    project.parameters;

    const evaluator = {
      data: [{ input: 1 }],
      task: (input: number) => input,
      scores: [],
      parameters: { count: z.number().default(1) },
    };
    publicExports.Eval("test", evaluator, {
      // @ts-expect-error Inline overrides must match the parameter schema.
      parameters: { count: "one" },
    });
    publicExports.Eval("test", {
      ...evaluator,
      // @ts-expect-error Only inline schemas are supported, not remote configuration promises.
      parameters: Promise.resolve(evaluator.parameters),
    });

    project.prompts.create({
      name: "test-prompt",
      model: "test-model",
      messages: [],
      // @ts-expect-error Prompts accept inline provider tools, not saved tools.
      tools: [{ type: "function", id: "saved-tool" }],
    });
    publicExports.invoke({
      globalFunction: "test",
      input: {},
      // @ts-expect-error Deprecated function kinds are no longer supported.
      functionType: "tool",
    });
  }
});

test("does not expose runtime schemas or implementation helpers", () => {
  for (const name of [
    "AttachmentReference",
    "braintrustStreamChunkSchema",
    "logs3OverflowUploadSchema",
    "promptContentsSchema",
    "promptDefinitionSchema",
    "promptDefinitionWithToolsSchema",
    "SpanImpl",
    "IDGenerator",
    "_exportsForTestingOnly",
    "serializePromptForCache",
    "serializeParametersForCache",
    "default",
  ]) {
    expect(publicExports).not.toHaveProperty(name);
  }
});

test("accepts only canonical v4 call shapes", () => {
  if (false) {
    init({ project: "project" });
    initDataset({ project: "project", dataset: "dataset" });

    // @ts-expect-error The string-first overload was removed in v4.
    init("project");
    // @ts-expect-error The string-first overload was removed in v4.
    initDataset("project", { dataset: "dataset" });
    // @ts-expect-error Exported span slugs are internal integration plumbing.
    withParent("exported-span", () => undefined);

    const dataset = null as unknown as Dataset;
    // @ts-expect-error Dataset records use `expected`, not the legacy `output` alias.
    dataset.insert({ input: "input", output: "expected" });

    const span = null as unknown as Span;
    // @ts-expect-error Spans end with `end()`; the `close()` alias was removed.
    span.close();
  }

  expect(true).toBe(true);
});
