// Type definitions for operating on the app database.

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
extendZodWithOpenApi(z);

import { datetimeStringSchema } from "./common_types";
import { customTypes } from "./custom_types";
import { promptDataSchema } from "./prompt";

// Section: App DB table schemas

function generateBaseTableSchema(
  objectName: string,
  opts?: { uniqueName?: boolean }
) {
  let nameDescription = `Name of the ${objectName}`;
  if (opts?.uniqueName) {
    nameDescription += `. Within a project, ${objectName} names are unique`;
  }

  return z.object({
    id: z.string().uuid().describe(`Unique identifier for the ${objectName}`),
    project_id: z
      .string()
      .uuid()
      .describe(
        `Unique identifier for the project that the ${objectName} belongs under`
      ),
    name: z.string().describe(nameDescription),
    description: z
      .string()
      .nullish()
      .describe(`Textual description of the ${objectName}`),
    created: datetimeStringSchema
      .nullish()
      .describe(`Date of ${objectName} creation`),
    deleted_at: datetimeStringSchema
      .nullish()
      .describe(
        `Date of ${objectName} deletion, or null if the ${objectName} is still active`
      ),
    user_id: z
      .string()
      .uuid()
      .nullish()
      .describe(`Identifies the user who created the ${objectName}`),
    metadata: z
      .record(customTypes.any)
      .nullish()
      .describe(`User-controlled metadata about the ${objectName}`),
  });
}

const userBaseSchema = generateBaseTableSchema("user");
export const userSchema = z
  .object({
    id: userBaseSchema.shape.id,
    auth_id: z
      .string()
      .uuid()
      .nullish()
      .describe("Internal authentication token used to identify the user"),
    given_name: z.string().nullish().describe("Given name of the user"),
    family_name: z.string().nullish().describe("Family name of the user"),
    email: z.string().nullish().describe("The user's email"),
    avatar_url: z.string().nullish().describe("URL of the user's Avatar image"),
    created: userBaseSchema.shape.created,
  })
  .strict()
  .openapi("User");
export type User = z.infer<typeof userSchema>;

const organizationBaseSchema = generateBaseTableSchema("organization");
export const organizationSchema = z
  .object({
    id: organizationBaseSchema.shape.id,
    name: organizationBaseSchema.shape.name.nullish(),
    api_url: z.string().nullish(),
    created: organizationBaseSchema.shape.created,
  })
  .strict()
  .openapi("Organization");
export type Organization = z.infer<typeof organizationSchema>;

export const memberSchema = z
  .object({
    org_id: organizationSchema.shape.id,
    user_id: userSchema.shape.id,
  })
  .strict()
  .openapi("Member");
export type Member = z.infer<typeof memberSchema>;

export const meSchema = z
  .object({
    id: userSchema.shape.id,
    // By filtering by auth_id equality, we will ensure this is not-null.
    auth_id: userSchema.shape.auth_id.unwrap().unwrap(),
    organizations: z
      .object({
        id: memberSchema.shape.org_id,
        name: organizationSchema.shape.name,
      })
      .array(),
  })
  .strict()
  .openapi("Me");
export type Me = z.infer<typeof meSchema>;

const apiKeyBaseSchema = generateBaseTableSchema("api key");
export const apiKeySchema = z
  .object({
    id: apiKeyBaseSchema.shape.id,
    created: apiKeyBaseSchema.shape.created,
    key_hash: z.string(),
    name: apiKeyBaseSchema.shape.name,
    preview_name: z.string(),
    user_id: userSchema.shape.id.nullish(),
    org_id: organizationSchema.shape.id.nullish(),
  })
  .strict()
  .openapi("ApiKey");
export type ApiKey = z.infer<typeof apiKeySchema>;

const projectBaseSchema = generateBaseTableSchema("project");
export const projectSchema = z
  .object({
    id: projectBaseSchema.shape.id,
    org_id: z
      .string()
      .uuid()
      .describe(
        "Unique id for the organization that the project belongs under"
      ),
    name: projectBaseSchema.shape.name,
    created: projectBaseSchema.shape.created,
    deleted_at: projectBaseSchema.shape.deleted_at,
    user_id: projectBaseSchema.shape.user_id,
  })
  .strict()
  .openapi("Project");
export type Project = z.infer<typeof projectSchema>;

const datasetBaseSchema = generateBaseTableSchema("dataset", {
  uniqueName: true,
});
export const datasetSchema = z
  .object({
    id: datasetBaseSchema.shape.id,
    project_id: datasetBaseSchema.shape.project_id.nullish(),
    name: datasetBaseSchema.shape.name,
    description: datasetBaseSchema.shape.description,
    created: datasetBaseSchema.shape.created,
    deleted_at: datasetBaseSchema.shape.deleted_at,
    user_id: datasetBaseSchema.shape.user_id,
  })
  .strict()
  .openapi("Dataset");
export type Dataset = z.infer<typeof datasetSchema>;

const promptBaseSchema = generateBaseTableSchema("prompt");
export const promptSchema = z.object({
  id: promptBaseSchema.shape.id,
  // This has to be copy/pasted because zod blows up when there are circular dependencies
  _xact_id: z
    .string()
    .describe(
      `The transaction id of an event is unique to the network operation that processed the event insertion. Transaction ids are monotonically increasing over time and can be used to retrieve a versioned snapshot of the prompt (see the \`version\` parameter)`
    ),
  project_id: promptBaseSchema.shape.project_id,
  name: promptBaseSchema.shape.name,
  slug: z.string().describe("Unique identifier for the prompt"),
  description: promptBaseSchema.shape.description,
  prompt_data: promptDataSchema
    .nullish()
    .describe("The prompt, model, and its parameters"),
  tags: z.array(z.string()).nullish().describe("A list of tags for the prompt"),
});
export type Prompt = z.infer<typeof promptSchema>;

const repoInfoSchema = z
  .object({
    commit: z.string().nullish().describe("SHA of most recent commit"),
    branch: z
      .string()
      .nullish()
      .describe("Name of the branch the most recent commit belongs to"),
    tag: z
      .string()
      .nullish()
      .describe("Name of the tag on the most recent commit"),
    dirty: z
      .boolean()
      .nullish()
      .describe(
        "Whether or not the repo had uncommitted changes when snapshotted"
      ),
    author_name: z
      .string()
      .nullish()
      .describe("Name of the author of the most recent commit"),
    author_email: z
      .string()
      .nullish()
      .describe("Email of the author of the most recent commit"),
    commit_message: z.string().nullish().describe("Most recent commit message"),
    commit_time: z
      .string()
      .nullish()
      .describe("Time of the most recent commit"),
    git_diff: z
      .string()
      .nullish()
      .describe(
        "If the repo was dirty when run, this includes the diff between the current state of the repo and the most recent commit."
      ),
  })
  .describe(
    "Metadata about the state of the repo when the experiment was created"
  )
  .openapi("RepoInfo");

const experimentBaseSchema = generateBaseTableSchema("experiment", {
  uniqueName: true,
});
export const experimentSchema = z
  .object({
    id: experimentBaseSchema.shape.id,
    project_id: experimentBaseSchema.shape.project_id.nullish(),
    project_name: projectSchema.shape.name.nullish(),
    org_id: projectSchema.shape.org_id.nullish(),
    name: experimentBaseSchema.shape.name,
    description: experimentBaseSchema.shape.description,
    created: experimentBaseSchema.shape.created,
    repo_info: repoInfoSchema.nullish(),
    ancestor_commits: z
      .array(z.string())
      .nullish()
      .describe("Ancestor commit history, used to find the base experiment"),
    commit: z
      .string()
      .nullish()
      .describe("Commit, taken directly from `repo_info.commit`"),
    base_exp_id: z
      .string()
      .uuid()
      .nullish()
      .describe(
        "Id of default base experiment to compare against when viewing this experiment"
      ),
    deleted_at: experimentBaseSchema.shape.deleted_at,
    dataset_id: z
      .string()
      .uuid()
      .nullish()
      .describe(
        "Identifier of the linked dataset, or null if the experiment is not linked to a dataset"
      ),
    dataset_version: z
      .string()
      .nullish()
      .describe(
        "Version number of the linked dataset the experiment was run against. This can be used to reproduce the experiment after the dataset has been modified."
      ),
    public: z
      .boolean()
      .describe(
        "Whether or not the experiment is public. Public experiments can be viewed by anybody inside or outside the organization"
      ),
    user_id: experimentBaseSchema.shape.user_id,
    metadata: experimentBaseSchema.shape.metadata,
  })
  .strict()
  .openapi("Experiment");
export type Experiment = z.infer<typeof experimentSchema>;

// Section: Schemas for REST operations on app DB tables

export const appLimitSchema = z
  .number()
  .int()
  .nonnegative()
  .describe("Limit the number of objects to return");

function generateBaseTableOpSchema(objectName: string) {
  return z.object({
    org_name: z
      .string()
      .nullish()
      .describe(
        `For nearly all users, this parameter should be unnecessary. But in the rare case that your API key belongs to multiple organizations, you may specify the name of the organization the ${objectName} belongs in.`
      ),
  });
}

// Pagination for listing data objects.

export const startingAfterSchema = z
  .string()
  .uuid()
  .describe(
    [
      "Pagination cursor id.",
      "For example, if the final item in the last page you fetched had an id of `foo`, pass `starting_after=foo` to fetch the next page. Note: you may only pass one of `starting_after` and `ending_before`",
    ].join("\n\n")
  )
  .openapi("StartingAfter");

export const endingBeforeSchema = z
  .string()
  .uuid()
  .describe(
    [
      "Pagination cursor id.",
      "For example, if the initial item in the last page you fetched had an id of `foo`, pass `ending_before=foo` to fetch the previous page. Note: you may only pass one of `starting_after` and `ending_before`",
    ].join("\n\n")
  )
  .openapi("EndingBefore");

const createProjectBaseSchema = generateBaseTableOpSchema("project");
const createProjectSchema = z
  .object({
    name: projectSchema.shape.name,
    org_name: createProjectBaseSchema.shape.org_name,
  })
  .strict()
  .openapi("CreateProject");

const patchProjectSchema = z
  .object({
    name: projectSchema.shape.name.nullish(),
  })
  .strict()
  .openapi("PatchProject");

const createExperimentSchema = z
  .object({
    project_id: experimentSchema.shape.project_id,
    project_name: experimentSchema.shape.project_name,
    org_id: experimentSchema.shape.org_id,
    ancestor_commits: experimentSchema.shape.ancestor_commits,
    name: experimentSchema.shape.name.nullish(),
    description: experimentSchema.shape.description,
    repo_info: experimentSchema.shape.repo_info,
    base_exp_id: experimentSchema.shape.base_exp_id,
    dataset_id: experimentSchema.shape.dataset_id,
    dataset_version: experimentSchema.shape.dataset_version,
    public: experimentSchema.shape.public.nullish(),
    metadata: experimentSchema.shape.metadata,
  })
  .strict()
  .openapi("CreateExperiment");

const patchExperimentSchema = createExperimentSchema
  .omit({ project_id: true })
  .strict()
  .openapi("PatchExperiment");

const createDatasetSchema = z
  .object({
    project_id: datasetSchema.shape.project_id,
    name: datasetSchema.shape.name,
    description: datasetSchema.shape.description,
  })
  .strict()
  .openapi("CreateDataset");

const patchDatasetSchema = createDatasetSchema
  .omit({ project_id: true })
  .strict()
  .openapi("PatchDataset");

const createPromptSchema = promptSchema
  .omit({ id: true, _xact_id: true })
  .strict()
  .openapi("CreatePrompt");

const patchPromptSchema = z
  .object({
    name: promptSchema.shape.name.nullish(),
    description: promptSchema.shape.description.nullish(),
    prompt_data: promptSchema.shape.prompt_data.nullish(),
    tags: promptSchema.shape.tags.nullish(),
  })
  .strict()
  .openapi("PatchPrompt");

// Section: exported schemas, grouped by object type.

export const objectSchemas = {
  experiment: {
    create: createExperimentSchema,
    patch: patchExperimentSchema,
    object: experimentSchema,
  },
  dataset: {
    create: createDatasetSchema,
    patch: patchDatasetSchema,
    object: datasetSchema,
  },
  project: {
    create: createProjectSchema,
    patch: patchProjectSchema,
    object: projectSchema,
  },
  prompt: {
    create: createPromptSchema,
    patch: patchPromptSchema,
    object: promptSchema,
  },
};
