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
  opts?: { uniqueName?: boolean },
) {
  let nameDescription = `Name of the ${objectName}`;
  if (opts?.uniqueName) {
    nameDescription += `. Within a project, ${objectName} names are unique`;
  }

  return z.strictObject({
    id: z.string().uuid().describe(`Unique identifier for the ${objectName}`),
    project_id: z
      .string()
      .uuid()
      .describe(
        `Unique identifier for the project that the ${objectName} belongs under`,
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
        `Date of ${objectName} deletion, or null if the ${objectName} is still active`,
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
  .strictObject({
    id: userBaseSchema.shape.id,
    given_name: z.string().nullish().describe("Given name of the user"),
    family_name: z.string().nullish().describe("Family name of the user"),
    email: z.string().nullish().describe("The user's email"),
    avatar_url: z.string().nullish().describe("URL of the user's Avatar image"),
    created: userBaseSchema.shape.created,
  })
  .openapi("User");
export type User = z.infer<typeof userSchema>;

const organizationBaseSchema = generateBaseTableSchema("organization");
export const organizationSchema = z
  .strictObject({
    id: organizationBaseSchema.shape.id,
    name: organizationBaseSchema.shape.name,
    api_url: z.string().nullish(),
    proxy_url: z.string().nullish(),
    realtime_url: z.string().nullish(),
    created: organizationBaseSchema.shape.created,
  })
  .openapi("Organization");
export type Organization = z.infer<typeof organizationSchema>;

export const maxOverWindowSchema = z
  .strictObject({
    window_size_days: z.number().int().positive(),
    max_value: z.number().nonnegative(),
  })
  .openapi("MaxOverWindow");

export type MaxOverWindow = z.infer<typeof maxOverWindowSchema>;

export const resourcesSchema = z
  .strictObject({
    org_id: organizationSchema.shape.id,
    forbid_toggle_experiment_public_to_private: z.boolean().nullish(),
    num_private_experiment_row_actions: maxOverWindowSchema.nullish(),
    forbid_insert_datasets: z.boolean().nullish(),
    forbid_insert_prompt_sessions: z.boolean().nullish(),
    forbid_access_sql_explorer: z.boolean().nullish(),
    num_production_log_row_actions: maxOverWindowSchema.nullish(),
    num_dataset_row_actions: maxOverWindowSchema.nullish(),
  })
  .openapi("Resources");

export type Resources = z.infer<typeof resourcesSchema>;

export const memberSchema = z
  .strictObject({
    org_id: organizationSchema.shape.id,
    user_id: userSchema.shape.id,
  })
  .openapi("Member");
export type Member = z.infer<typeof memberSchema>;

const orgSecretsBaseSchema = generateBaseTableSchema("org secrets");
export const orgSecretsSchema = z
  .strictObject({
    id: orgSecretsBaseSchema.shape.id,
    created: orgSecretsBaseSchema.shape.created,
    key_id: z.string().uuid(),
    org_id: organizationSchema.shape.id,
    name: orgSecretsBaseSchema.shape.name,
    secret: z.string().nullish(),
    type: z.string().nullish(),
    metadata: customTypes.any,
  })
  .openapi("OrgSecrets");
export type OrgSecrets = z.infer<typeof orgSecretsSchema>;

const apiKeyBaseSchema = generateBaseTableSchema("api key");
export const apiKeySchema = z
  .strictObject({
    id: apiKeyBaseSchema.shape.id,
    created: apiKeyBaseSchema.shape.created,
    name: apiKeyBaseSchema.shape.name,
    preview_name: z.string(),
    user_id: userSchema.shape.id.nullish(),
    org_id: organizationSchema.shape.id.nullish(),
  })
  .openapi("ApiKey");
export type ApiKey = z.infer<typeof apiKeySchema>;

export const projectSettingsSchema = z
  .strictObject({
    comparison_key: z
      .string()
      .nullish()
      .describe("The key used to join two experiments (defaults to `input`)."),
  })
  .strip();
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

const projectBaseSchema = generateBaseTableSchema("project");
export const projectSchema = z
  .strictObject({
    id: projectBaseSchema.shape.id,
    org_id: z
      .string()
      .uuid()
      .describe(
        "Unique id for the organization that the project belongs under",
      ),
    name: projectBaseSchema.shape.name,
    created: projectBaseSchema.shape.created,
    deleted_at: projectBaseSchema.shape.deleted_at,
    user_id: projectBaseSchema.shape.user_id,
    settings: projectSettingsSchema.nullish(),
  })
  .openapi("Project");
export type Project = z.infer<typeof projectSchema>;

const datasetBaseSchema = generateBaseTableSchema("dataset", {
  uniqueName: true,
});
export const datasetSchema = z
  .strictObject({
    id: datasetBaseSchema.shape.id,
    project_id: datasetBaseSchema.shape.project_id.nullish(),
    name: datasetBaseSchema.shape.name,
    description: datasetBaseSchema.shape.description,
    created: datasetBaseSchema.shape.created,
    deleted_at: datasetBaseSchema.shape.deleted_at,
    user_id: datasetBaseSchema.shape.user_id,
  })
  .openapi("Dataset");
export type Dataset = z.infer<typeof datasetSchema>;

export const validRuntimesEnum = z.enum(["node"]);
export type Runtime = z.infer<typeof validRuntimesEnum>;

export const runtimeContextSchema = z.strictObject({
  runtime: validRuntimesEnum,
  version: z.string(),
});
export type RuntimeContext = z.infer<typeof runtimeContextSchema>;

const promptBaseSchema = generateBaseTableSchema("prompt");
const promptSchemaObject = z.strictObject({
  id: promptBaseSchema.shape.id,
  // This has to be copy/pasted because zod blows up when there are circular dependencies
  _xact_id: z
    .string()
    .describe(
      `The transaction id of an event is unique to the network operation that processed the event insertion. Transaction ids are monotonically increasing over time and can be used to retrieve a versioned snapshot of the prompt (see the \`version\` parameter)`,
    ),
  project_id: promptBaseSchema.shape.project_id,
  log_id: z
    .literal("p")
    .describe("A literal 'p' which identifies the object as a project prompt"),
  org_id: organizationSchema.shape.id,
  name: promptBaseSchema.shape.name,
  slug: z.string().describe("Unique identifier for the prompt"),
  description: promptBaseSchema.shape.description,
  created: promptBaseSchema.shape.created,
  prompt_data: promptDataSchema
    .nullish()
    .describe("The prompt, model, and its parameters"),
  tags: z.array(z.string()).nullish().describe("A list of tags for the prompt"),
  metadata: promptBaseSchema.shape.metadata,
});

export const promptSchema = promptSchemaObject.openapi("Prompt");
export type Prompt = z.infer<typeof promptSchema>;

export const codeBundleSchema = z.strictObject({
  runtime_context: z.strictObject({
    runtime: validRuntimesEnum,
    version: z.string(),
  }),
  // This should be a union, once we support code living in different places
  // Other options should be:
  //  - a "handler" function that has some signature [does AWS lambda assume it's always called "handler"?]
  location: z.strictObject({
    type: z.literal("experiment"),
    eval_name: z.string(),
    position: z.union([
      z.literal("task"),
      z.strictObject({ score: z.number() }),
    ]),
  }),
  bundle_id: z.string(),
});
export type CodeBundle = z.infer<typeof codeBundleSchema>;

export const functionDataSchema = z.union([
  z.strictObject({
    type: z.literal("prompt"),
    // For backwards compatibility reasons, this is hoisted out and stored
    // in the outer object
  }),
  z.strictObject({
    type: z.literal("code"),
    data: codeBundleSchema,
  }),
  z.strictObject({
    type: z.literal("global"),
    name: z.string(),
  }),
]);

export const functionSchema = promptSchemaObject
  .merge(
    z.strictObject({
      function_data: functionDataSchema,
    }),
  )
  .openapi("Function");

// NOTE: suffix "Object" helps avoid a name conflict with the built-in `Function` type
export type FunctionObject = z.infer<typeof functionSchema>;

const repoInfoSchema = z
  .strictObject({
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
        "Whether or not the repo had uncommitted changes when snapshotted",
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
        "If the repo was dirty when run, this includes the diff between the current state of the repo and the most recent commit.",
      ),
  })
  .describe(
    "Metadata about the state of the repo when the experiment was created",
  )
  .openapi("RepoInfo");

const experimentBaseSchema = generateBaseTableSchema("experiment", {
  uniqueName: true,
});
export const experimentSchema = z
  .strictObject({
    id: experimentBaseSchema.shape.id,
    project_id: experimentBaseSchema.shape.project_id,
    name: experimentBaseSchema.shape.name,
    description: experimentBaseSchema.shape.description,
    created: experimentBaseSchema.shape.created,
    repo_info: repoInfoSchema.nullish(),
    commit: z
      .string()
      .nullish()
      .describe("Commit, taken directly from `repo_info.commit`"),
    base_exp_id: z
      .string()
      .uuid()
      .nullish()
      .describe(
        "Id of default base experiment to compare against when viewing this experiment",
      ),
    deleted_at: experimentBaseSchema.shape.deleted_at,
    dataset_id: z
      .string()
      .uuid()
      .nullish()
      .describe(
        "Identifier of the linked dataset, or null if the experiment is not linked to a dataset",
      ),
    dataset_version: z
      .string()
      .nullish()
      .describe(
        "Version number of the linked dataset the experiment was run against. This can be used to reproduce the experiment after the dataset has been modified.",
      ),
    public: z
      .boolean()
      .describe(
        "Whether or not the experiment is public. Public experiments can be viewed by anybody inside or outside the organization",
      ),
    user_id: experimentBaseSchema.shape.user_id,
    metadata: experimentBaseSchema.shape.metadata,
  })
  .openapi("Experiment");
export type Experiment = z.infer<typeof experimentSchema>;

const promptSessionBaseSchema = generateBaseTableSchema("promptSession", {
  uniqueName: true,
});
export const promptSessionSchema = z
  .strictObject({
    id: promptSessionBaseSchema.shape.id,
    name: promptSessionBaseSchema.shape.name,
    description: promptSessionBaseSchema.shape.description,
    created: promptSessionBaseSchema.shape.created,
    deleted_at: promptSessionBaseSchema.shape.deleted_at,
    user_id: promptSessionBaseSchema.shape.user_id,
    project_id: promptSessionBaseSchema.shape.project_id,
    org_id: organizationSchema.shape.id
      .nullish()
      .describe(
        "This field is deprecated and will be removed in a future revision",
      ),
  })
  .openapi("PromptSession");
export type PromptSession = z.infer<typeof promptSessionSchema>;

export const permissionEnum = z
  .enum([
    "create",
    "read",
    "update",
    "delete",
    "create_acls",
    "read_acls",
    "update_acls",
    "delete_acls",
  ])
  .describe(
    [
      "Each permission permits a certain type of operation on an object in the system",
      "Permissions can be assigned to to objects on an individual basis, or grouped into roles",
    ].join("\n\n"),
  );
export type Permission = z.infer<typeof permissionEnum>;

export const aclObjectTypeEnum = z
  .enum([
    "organization",
    "project",
    "experiment",
    "dataset",
    "prompt",
    "prompt_session",
    "group",
    "role",
    "org_member",
    "project_log",
    "org_project",
  ])
  .describe("The object type that the ACL applies to");
export type AclObjectType = z.infer<typeof aclObjectTypeEnum>;

const roleBaseSchema = generateBaseTableSchema("role");
export const roleSchema = z
  .strictObject({
    id: roleBaseSchema.shape.id,
    org_id: z
      .string()
      .uuid()
      .nullish()
      .describe(
        [
          "Unique id for the organization that the role belongs under",
          "A null org_id indicates a system role, which may be assigned to anybody and inherited by any other role, but cannot be edited.",
          "It is forbidden to change the org after creating a role",
        ].join("\n\n"),
      ),
    user_id: roleBaseSchema.shape.user_id,
    created: roleBaseSchema.shape.created,
    name: roleBaseSchema.shape.name,
    description: roleBaseSchema.shape.description,
    deleted_at: roleBaseSchema.shape.deleted_at,
    member_permissions: z
      .array(
        z.strictObject({
          permission: permissionEnum,
          restrict_object_type: aclObjectTypeEnum.nullish(),
        }),
      )
      .nullish()
      .describe(
        "(permission, restrict_object_type) tuples which belong to this role",
      ),
    member_roles: z
      .array(z.string().uuid())
      .nullish()
      .describe(
        [
          "Ids of the roles this role inherits from",
          "An inheriting role has all the permissions contained in its member roles, as well as all of their inherited permissions",
        ].join("\n\n"),
      ),
  })
  .describe(
    [
      "A role is a collection of permissions which can be granted as part of an ACL",
      "Roles can consist of individual permissions, as well as a set of roles they inherit from",
    ].join("\n\n"),
  )
  .openapi("Role");
export type Role = z.infer<typeof roleSchema>;

const groupBaseSchema = generateBaseTableSchema("group");
export const groupSchema = z
  .strictObject({
    id: groupBaseSchema.shape.id,
    org_id: z
      .string()
      .uuid()
      .describe(
        [
          "Unique id for the organization that the group belongs under",
          "It is forbidden to change the org after creating a group",
        ].join("\n\n"),
      ),
    user_id: groupBaseSchema.shape.user_id,
    created: groupBaseSchema.shape.created,
    name: groupBaseSchema.shape.name,
    description: groupBaseSchema.shape.description,
    deleted_at: groupBaseSchema.shape.deleted_at,
    member_users: z
      .array(z.string().uuid())
      .nullish()
      .describe("Ids of users which belong to this group"),
    member_groups: z
      .array(z.string().uuid())
      .nullish()
      .describe(
        [
          "Ids of the groups this group inherits from",
          "An inheriting group has all the users contained in its member groups, as well as all of their inherited users",
        ].join("\n\n"),
      ),
  })
  .describe(
    [
      "A group is a collection of users which can be assigned an ACL",
      "Groups can consist of individual users, as well as a set of groups they inherit from",
    ].join("\n\n"),
  )
  .openapi("Group");
export type Group = z.infer<typeof groupSchema>;

export const projectScoreTypeEnum = z
  .enum(["slider", "categorical", "weighted", "minimum"])
  .describe("The type of the configured score");
export type ProjectScoreType = z.infer<typeof projectScoreTypeEnum>;

export const projectScoreCategory = z
  .object({
    name: z.string().describe("Name of the category"),
    value: z
      .number()
      .describe(
        "Numerical value of the category. Must be between 0 and 1, inclusive",
      ),
  })
  .describe("For categorical-type project scores, defines a single category")
  .openapi("ProjectScoreCategory");
export type ProjectScoreCategory = z.infer<typeof projectScoreCategory>;

const projectScoreBaseSchema = generateBaseTableSchema("project score");
export const projectScoreSchema = z
  .strictObject({
    id: projectScoreBaseSchema.shape.id,
    project_id: projectScoreBaseSchema.shape.project_id,
    user_id: projectScoreBaseSchema.shape.user_id.unwrap().unwrap(),
    created: projectScoreBaseSchema.shape.created,
    name: projectScoreBaseSchema.shape.name,
    description: projectScoreBaseSchema.shape.description,
    score_type: projectScoreTypeEnum,
    categories: z
      .union([
        projectScoreCategory
          .array()
          .describe(
            "For categorical-type project scores, the list of all categories",
          ),
        z
          .record(z.number())
          .describe(
            "For weighted-type project scores, the weights of each score",
          ),
        z
          .array(z.string())
          .describe(
            "For minimum-type project scores, the list of included scores",
          ),
      ])
      .nullish(),
    config: z
      .strictObject({
        multi_select: z.boolean().nullish(),
        destination: z.literal("expected").nullish(),
      })
      .nullish(),
  })
  .describe(
    "A project score is a user-configured score, which can be manually-labeled through the UI",
  )
  .openapi("ProjectScore");
export type ProjectScore = z.infer<typeof projectScoreSchema>;

const projectTagBaseSchema = generateBaseTableSchema("project tag");
export const projectTagSchema = z
  .strictObject({
    id: projectTagBaseSchema.shape.id,
    project_id: projectTagBaseSchema.shape.project_id,
    user_id: projectTagBaseSchema.shape.user_id.unwrap().unwrap(),
    created: projectTagBaseSchema.shape.created,
    name: projectTagBaseSchema.shape.name,
    description: projectTagBaseSchema.shape.description,
    color: z.string().nullish().describe("Color of the tag for the UI"),
  })
  .describe(
    "A project tag is a user-configured tag for tracking and filtering your experiments, logs, and other data",
  )
  .openapi("ProjectTag");
export type ProjectTag = z.infer<typeof projectTagSchema>;

const aclBaseSchema = generateBaseTableSchema("acl");
export const aclSchema = z
  .strictObject({
    id: aclBaseSchema.shape.id,
    object_type: aclObjectTypeEnum,
    object_id: z
      .string()
      .uuid()
      .describe("The id of the object the ACL applies to"),
    user_id: z
      .string()
      .uuid()
      .nullish()
      .describe(
        "Id of the user the ACL applies to. Exactly one of `user_id` and `group_id` will be provided",
      ),
    group_id: z
      .string()
      .uuid()
      .nullish()
      .describe(
        "Id of the group the ACL applies to. Exactly one of `user_id` and `group_id` will be provided",
      ),
    permission: permissionEnum
      .nullish()
      .describe(
        "Permission the ACL grants. Exactly one of `permission` and `role_id` will be provided",
      ),
    restrict_object_type: aclObjectTypeEnum
      .nullish()
      .describe(
        "When setting a permission directly, optionally restricts the permission grant to just the specified object type. Cannot be set alongside a `role_id`.",
      ),
    role_id: z
      .string()
      .uuid()
      .nullish()
      .describe(
        "Id of the role the ACL grants. Exactly one of `permission` and `role_id` will be provided",
      ),
    _object_org_id: z
      .string()
      .uuid()
      .describe("The organization the ACL's referred object belongs to"),
    created: aclBaseSchema.shape.created,
  })
  .describe(
    [
      "An ACL grants a certain permission or role to a certain user or group on an object.",
      "ACLs are inherited across the object hierarchy. So for example, if a user has read permissions on a project, they will also have read permissions on any experiment, dataset, etc. created within that project.",
      "To restrict a grant to a particular sub-object, you may specify `restrict_object_type` in the ACL, as part of a direct permission grant or as part of a role.",
    ].join("\n\n"),
  )
  .openapi("Acl");
export type Acl = z.infer<typeof aclSchema>;

// Section: Schemas for REST operations on app DB tables

export const appLimitSchema = z
  .number()
  .int()
  .nonnegative()
  .describe("Limit the number of objects to return");

function generateBaseTableOpSchema(objectName: string) {
  return z.strictObject({
    org_name: z
      .string()
      .nullish()
      .describe(
        `For nearly all users, this parameter should be unnecessary. But in the rare case that your API key belongs to multiple organizations, you may specify the name of the organization the ${objectName} belongs in.`,
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
    ].join("\n\n"),
  )
  .openapi("StartingAfter");

export const endingBeforeSchema = z
  .string()
  .uuid()
  .describe(
    [
      "Pagination cursor id.",
      "For example, if the initial item in the last page you fetched had an id of `foo`, pass `ending_before=foo` to fetch the previous page. Note: you may only pass one of `starting_after` and `ending_before`",
    ].join("\n\n"),
  )
  .openapi("EndingBefore");

// Schema for filtering by object IDs.
export function makeObjectIdsFilterSchema(objectName: string) {
  const item = z.string().uuid();
  return z
    .union([item, item.array()])
    .describe(
      `Filter search results to a particular set of ${objectName} IDs. To specify a list of IDs, include the query param multiple times`,
    )
    .openapi(`${objectName}IdsFilter`);
}

const createProjectBaseSchema = generateBaseTableOpSchema("project");
const createProjectSchema = z
  .strictObject({
    name: projectSchema.shape.name,
    org_name: createProjectBaseSchema.shape.org_name,
  })
  .openapi("CreateProject");

const patchProjectSchema = z
  .strictObject({
    name: projectSchema.shape.name.nullish(),
    settings: projectSchema.shape.settings
      .describe(
        "Project settings. Patch operations replace all settings, so make sure you include all settings you want to keep.",
      )
      .nullish(),
  })
  .openapi("PatchProject");

const createExperimentSchema = z
  .strictObject({
    project_id: experimentSchema.shape.project_id,
    name: experimentSchema.shape.name.nullish(),
    description: experimentSchema.shape.description,
    repo_info: experimentSchema.shape.repo_info,
    base_exp_id: experimentSchema.shape.base_exp_id,
    dataset_id: experimentSchema.shape.dataset_id,
    dataset_version: experimentSchema.shape.dataset_version,
    public: experimentSchema.shape.public.nullish(),
    metadata: experimentSchema.shape.metadata,
    ensure_new: z
      .boolean()
      .nullish()
      .describe(
        "Normally, creating an experiment with the same name as an existing experiment will return the existing one un-modified. But if `ensure_new` is true, registration will generate a new experiment with a unique name in case of a conflict.",
      ),
  })
  .openapi("CreateExperiment");

const patchExperimentSchema = createExperimentSchema
  .omit({ project_id: true, ensure_new: true })
  .openapi("PatchExperiment");

const createDatasetSchema = z
  .strictObject({
    project_id: datasetSchema.shape.project_id,
    name: datasetSchema.shape.name,
    description: datasetSchema.shape.description,
  })
  .openapi("CreateDataset");

const patchDatasetSchema = z
  .strictObject({
    name: datasetSchema.shape.name.nullish(),
    description: datasetSchema.shape.description,
  })
  .openapi("PatchDataset");

const createPromptSchema = promptSchema
  .omit({
    id: true,
    _xact_id: true,
    org_id: true,
    log_id: true,
    created: true,
    metadata: true,
  })
  .openapi("CreatePrompt");

const createFunctionSchema = functionSchema
  .omit({
    id: true,
    _xact_id: true,
    org_id: true,
    log_id: true,
    created: true,
    metadata: true,
  })
  .openapi("CreateFunction");

const patchPromptSchema = z
  .strictObject({
    name: promptSchema.shape.name.nullish(),
    description: promptSchema.shape.description.nullish(),
    prompt_data: promptSchema.shape.prompt_data.nullish(),
    tags: promptSchema.shape.tags.nullish(),
  })
  .openapi("PatchPrompt");

const patchFunctionSchema = z
  .strictObject({
    name: functionSchema.shape.name.nullish(),
    description: functionSchema.shape.description.nullish(),
    prompt_data: functionSchema.shape.prompt_data.nullish(),
    function_data: functionSchema.shape.function_data.nullish(),
    tags: functionSchema.shape.tags.nullish(),
  })
  .openapi("PatchFunction");

const createRoleBaseSchema = generateBaseTableOpSchema("role");
const createRoleSchema = z
  .strictObject({
    name: roleSchema.shape.name,
    description: roleSchema.shape.description,
    member_permissions: roleSchema.shape.member_permissions,
    member_roles: roleSchema.shape.member_roles,
    org_name: createRoleBaseSchema.shape.org_name,
  })
  .openapi("CreateRole");

const patchRoleSchema = createRoleSchema
  .omit({
    name: true,
    org_name: true,
    member_permissions: true,
    member_roles: true,
  })
  .merge(
    z.strictObject({
      name: createRoleSchema.shape.name.nullish(),
      add_member_permissions: roleSchema.shape.member_permissions
        .nullish()
        .describe("A list of permissions to add to the role"),
      remove_member_permissions: roleSchema.shape.member_permissions
        .nullish()
        .describe("A list of permissions to remove from the role"),
      add_member_roles: roleSchema.shape.member_roles
        .nullish()
        .describe(
          "A list of role IDs to add to the role's inheriting-from set",
        ),
      remove_member_roles: roleSchema.shape.member_roles
        .nullish()
        .describe(
          "A list of role IDs to remove from the role's inheriting-from set",
        ),
    }),
  )
  .openapi("PatchRole");

const createGroupBaseSchema = generateBaseTableOpSchema("group");
const createGroupSchema = z
  .strictObject({
    name: groupSchema.shape.name,
    description: groupSchema.shape.description,
    member_users: groupSchema.shape.member_users,
    member_groups: groupSchema.shape.member_groups,
    org_name: createGroupBaseSchema.shape.org_name,
  })
  .openapi("CreateGroup");

const patchGroupSchema = createGroupSchema
  .omit({ name: true, org_name: true, member_users: true, member_groups: true })
  .merge(
    z.strictObject({
      name: createGroupSchema.shape.name.nullish(),
      add_member_users: groupSchema.shape.member_users
        .nullish()
        .describe("A list of user IDs to add to the group"),
      remove_member_users: groupSchema.shape.member_users
        .nullish()
        .describe("A list of user IDs to remove from the group"),
      add_member_groups: groupSchema.shape.member_groups
        .nullish()
        .describe(
          "A list of group IDs to add to the group's inheriting-from set",
        ),
      remove_member_groups: groupSchema.shape.member_groups
        .nullish()
        .describe(
          "A list of group IDs to remove from the group's inheriting-from set",
        ),
    }),
  )
  .openapi("PatchGroup");

const createAclSchema = aclSchema
  .omit({
    id: true,
    created: true,
    _object_org_id: true,
  })
  .openapi("CreateAcl");

const createProjectScoreSchema = z
  .strictObject({
    project_id: projectScoreSchema.shape.project_id,
    name: projectScoreSchema.shape.name,
    description: projectScoreSchema.shape.description,
    score_type: projectScoreSchema.shape.score_type,
    categories: projectScoreSchema.shape.categories,
  })
  .openapi("CreateProjectScore");

const patchProjectScoreSchema = z
  .strictObject({
    name: projectScoreSchema.shape.name.nullish(),
    description: projectScoreSchema.shape.description,
    score_type: projectScoreSchema.shape.score_type.nullish(),
    categories: projectScoreSchema.shape.categories,
  })
  .openapi("PatchProjectScore");

const createProjectTagSchema = z
  .strictObject({
    project_id: projectTagSchema.shape.project_id,
    name: projectTagSchema.shape.name,
    description: projectTagSchema.shape.description,
    color: projectTagSchema.shape.color,
  })
  .openapi("CreateProjectTag");

const patchProjectTagSchema = z
  .strictObject({
    name: projectTagSchema.shape.name.nullish(),
    description: projectTagSchema.shape.description,
    color: projectTagSchema.shape.color,
  })
  .openapi("PatchProjectTag");

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
  function: {
    create: createFunctionSchema,
    patch: patchFunctionSchema,
    object: functionSchema,
  },
  role: {
    create: createRoleSchema,
    patch: patchRoleSchema,
    object: roleSchema,
  },
  group: {
    create: createGroupSchema,
    patch: patchGroupSchema,
    object: groupSchema,
  },
  acl: {
    create: createAclSchema,
    patch: undefined,
    object: aclSchema,
  },
  user: {
    create: undefined,
    patch: undefined,
    object: userSchema,
  },
  prompt_session: {
    create: undefined,
    patch: undefined,
    object: undefined,
  },
  project_score: {
    create: createProjectScoreSchema,
    patch: patchProjectScoreSchema,
    object: projectScoreSchema,
  },
  project_tag: {
    create: createProjectTagSchema,
    patch: patchProjectTagSchema,
    object: projectTagSchema,
  },
};
