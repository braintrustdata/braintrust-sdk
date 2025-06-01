// Type definitions for operating on the app database.

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { objectNullish } from "../src/zod_util";
import { ObjectType, datetimeStringSchema } from "./common_types";
import { customTypes } from "./custom_types";
import { promptDataSchema } from "./prompt";
import { viewDataSchema, viewOptionsSchema, viewTypeEnum } from "./view";
import { functionDataSchema, functionTypeEnum } from "./functions";
import { savedFunctionIdSchema } from "./function_id";
import { repoInfoSchema } from "./git_types";
import {
  automationConfigSchema,
  btqlExportAutomationConfigSchema,
  logAutomationConfigSchema,
} from "./automations";
extendZodWithOpenApi(z);

// Section: App DB table schemas

function generateBaseTableSchema(
  objectName: string,
  opts?: { uniqueName?: boolean },
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
    updated_at: datetimeStringSchema
      .nullish()
      .describe(`Date of last ${objectName} update`),
    user_id: z
      .string()
      .uuid()
      .nullish()
      .describe(`Identifies the user who created the ${objectName}`),
    metadata: z
      .record(customTypes.unknown)
      .nullish()
      .describe(`User-controlled metadata about the ${objectName}`),
  });
}

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
  .describe("The object type that the ACL applies to")
  .openapi("AclObjectType");
export type AclObjectType = z.infer<typeof aclObjectTypeEnum>;

const userBaseSchema = generateBaseTableSchema("user");
export const userSchema = z
  .object({
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
  .object({
    id: organizationBaseSchema.shape.id,
    name: organizationBaseSchema.shape.name,
    api_url: z.string().nullish(),
    is_universal_api: z.boolean().nullish(),
    proxy_url: z.string().nullish(),
    realtime_url: z.string().nullish(),
    created: organizationBaseSchema.shape.created,
  })
  .openapi("Organization");
export type Organization = z.infer<typeof organizationSchema>;

export const maxOverWindowSchema = z
  .object({
    window_size_days: z.number().int().positive(),
    max_value: z.number().nonnegative(),
  })
  .openapi("MaxOverWindow");

export type MaxOverWindow = z.infer<typeof maxOverWindowSchema>;

export const resourcesSchema = z
  .object({
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
  .object({
    org_id: organizationSchema.shape.id,
    user_id: userSchema.shape.id,
  })
  .openapi("Member");
export type Member = z.infer<typeof memberSchema>;

const aiSecretBaseSchema = generateBaseTableSchema("AI secret");
export const aiSecretSchema = z
  .object({
    id: aiSecretBaseSchema.shape.id,
    created: aiSecretBaseSchema.shape.created,
    updated_at: aiSecretBaseSchema.shape.updated_at,
    org_id: organizationSchema.shape.id,
    name: aiSecretBaseSchema.shape.name,
    type: z.string().nullish(),
    metadata: z.record(customTypes.unknown).nullish(),
    preview_secret: z.string().nullish(),
  })
  .openapi("AISecret");
export type AISecret = z.infer<typeof aiSecretSchema>;

export const envVarObjectTypeEnum = z
  .enum(["organization", "project", "function"])
  .describe("The type of the object the environment variable is scoped for");

const envVarBaseSchema = generateBaseTableSchema("environment variable");
export const envVarSchema = z
  .object({
    id: envVarBaseSchema.shape.id,
    object_type: envVarObjectTypeEnum,
    object_id: z
      .string()
      .uuid()
      .describe("The id of the object the environment variable is scoped for"),
    name: z.string().describe("The name of the environment variable"),
    created: envVarBaseSchema.shape.created,
    used: datetimeStringSchema
      .nullish()
      .describe(`Date the environment variable was last used`),
  })
  .openapi("EnvVar");
export type EnvVar = z.infer<typeof envVarSchema>;

const customColumnBaseSchema = generateBaseTableSchema("custom columns");
export const customColumnSchema = z
  .object({
    id: customColumnBaseSchema.shape.id,
    object_type: aclObjectTypeEnum,
    object_id: z
      .string()
      .uuid()
      .describe("The id of the object the custom column is scoped for"),
    subtype: aclObjectTypeEnum.nullable(),
    name: z.string().describe("The name of the custom column"),
    expr: z
      .string()
      .describe(
        "The expression used to extract the value for the custom column",
      ),
    created: customColumnBaseSchema.shape.created,
  })
  .openapi("CustomColumn");
export type CustomColumn = z.infer<typeof customColumnSchema>;

const apiKeyBaseSchema = generateBaseTableSchema("api key");
export const apiKeySchema = z
  .object({
    id: apiKeyBaseSchema.shape.id,
    created: apiKeyBaseSchema.shape.created,
    name: apiKeyBaseSchema.shape.name,
    preview_name: z.string(),
    user_id: userSchema.shape.id.nullish(),
    user_email: userSchema.shape.email.nullish(),
    user_given_name: userSchema.shape.given_name.nullish(),
    user_family_name: userSchema.shape.family_name.nullish(),
    org_id: organizationSchema.shape.id.nullish(),
  })
  .openapi("ApiKey");
export type ApiKey = z.infer<typeof apiKeySchema>;

export const spanFieldOrderItem = z.object({
  object_type: z.string(),
  column_id: z.string(),
  position: z.string(),
  layout: z.literal("full").or(z.literal("two_column")).nullish(),
});
export type SpanFieldOrderItem = z.infer<typeof spanFieldOrderItem>;

export const remoteEvalSourceSchema = z.object({
  url: z.string(),
  name: z.string(),
  description: z.string().nullish(),
});
export type RemoteEvalSource = z.infer<typeof remoteEvalSourceSchema>;

export const projectSettingsSchema = z
  .object({
    comparison_key: z
      .string()
      .nullish()
      .describe("The key used to join two experiments (defaults to `input`)"),
    baseline_experiment_id: z
      .string()
      .uuid()
      .nullish()
      .describe(
        "The id of the experiment to use as the default baseline for comparisons",
      ),
    spanFieldOrder: z
      .array(spanFieldOrderItem)
      .nullish()
      .describe("The order of the fields to display in the trace view"),
    remote_eval_sources: z
      .array(remoteEvalSourceSchema)
      .nullish()
      .describe("The remote eval sources to use for the project"),
  })
  .openapi("ProjectSettings");
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

const projectBaseSchema = generateBaseTableSchema("project");
export const projectSchema = z
  .object({
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
  .object({
    id: datasetBaseSchema.shape.id,
    project_id: datasetBaseSchema.shape.project_id,
    name: datasetBaseSchema.shape.name,
    description: datasetBaseSchema.shape.description,
    created: datasetBaseSchema.shape.created,
    deleted_at: datasetBaseSchema.shape.deleted_at,
    user_id: datasetBaseSchema.shape.user_id,
    metadata: datasetBaseSchema.shape.metadata,
  })
  .openapi("Dataset");
export type Dataset = z.infer<typeof datasetSchema>;

export const promptLogIdLiteralSchema = z
  .literal("p")
  .describe("A literal 'p' which identifies the object as a project prompt");

export const playgroundLogsLogIdLiteralSchema = z
  .literal("x")
  .describe("A literal 'x' which identifies the object as a playground log");

export const promptBaseSchema = generateBaseTableSchema("prompt");
const promptSchemaObject = z.object({
  id: promptBaseSchema.shape.id,
  // This has to be copy/pasted because zod blows up when there are circular dependencies
  _xact_id: z
    .string()
    .describe(
      `The transaction id of an event is unique to the network operation that processed the event insertion. Transaction ids are monotonically increasing over time and can be used to retrieve a versioned snapshot of the prompt (see the \`version\` parameter)`,
    ),
  project_id: promptBaseSchema.shape.project_id,
  log_id: promptLogIdLiteralSchema,
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
  // An empty (unspecified) function_type is equivalent to "task".
  function_type: functionTypeEnum.nullish(),
});

export const promptSchema = promptSchemaObject.openapi("Prompt");
export type Prompt = z.infer<typeof promptSchema>;

export const functionSchema = promptSchemaObject
  .merge(
    z.object({
      function_data: functionDataSchema,
      origin: z
        .object({
          object_type: aclObjectTypeEnum,
          object_id: z
            .string()
            .uuid()
            .describe("Id of the object the function is originating from"),
          internal: z
            .boolean()
            .nullish()
            .describe(
              "The function exists for internal purposes and should not be displayed in the list of functions.",
            ),
        })
        .nullish(),
      function_schema: z
        .object({
          parameters: customTypes.unknown,
          returns: customTypes.unknown.optional(),
        })
        .nullish()
        .describe("JSON schema for the function's parameters and return type"),
    }),
  )
  .openapi("Function");

// NOTE: suffix "Object" helps avoid a name conflict with the built-in `Function` type
export type FunctionObject = z.infer<typeof functionSchema>;

const experimentBaseSchema = generateBaseTableSchema("experiment", {
  uniqueName: true,
});
export const experimentSchema = z
  .object({
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
  .object({
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
  )
  .openapi("Permission");
export type Permission = z.infer<typeof permissionEnum>;

const roleBaseSchema = generateBaseTableSchema("role");
export const roleSchema = z
  .object({
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
        z.object({
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
  .object({
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
  .enum([
    "slider",
    "categorical",
    "weighted",
    "minimum",
    "maximum",
    "online",
    "free-form",
  ])
  .describe("The type of the configured score")
  .openapi("ProjectScoreType");
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

const projectAutomationBaseSchema =
  generateBaseTableSchema("project automation");
export const projectAutomationSchema = z
  .object({
    id: projectAutomationBaseSchema.shape.id,
    project_id: projectAutomationBaseSchema.shape.project_id,
    user_id: projectAutomationBaseSchema.shape.user_id,
    created: projectAutomationBaseSchema.shape.created,
    name: projectAutomationBaseSchema.shape.name,
    description: projectAutomationBaseSchema.shape.description,
    config: automationConfigSchema.describe(
      "The configuration for the automation rule",
    ),
  })
  .openapi("ProjectAutomation");

export type ProjectAutomation = z.infer<typeof projectAutomationSchema>;
export const logAutomationSchema = projectAutomationSchema.merge(
  z.object({
    config: logAutomationConfigSchema,
  }),
);
export type LogAutomation = z.infer<typeof logAutomationSchema>;

export const btqlExportAutomationSchema = projectAutomationSchema.merge(
  z.object({
    config: btqlExportAutomationConfigSchema,
  }),
);
export type BtqlExportAutomation = z.infer<typeof btqlExportAutomationSchema>;

export const onlineScoreConfigSchema = z
  .object({
    sampling_rate: z
      .number()
      .min(0)
      .max(1)
      .describe("The sampling rate for online scoring"),
    scorers: z
      .array(savedFunctionIdSchema)
      .describe("The list of scorers to use for online scoring"),
    apply_to_root_span: z
      .boolean()
      .nullish()
      .describe(
        "Whether to trigger online scoring on the root span of each trace",
      ),
    apply_to_span_names: z
      .string()
      .array()
      .nullish()
      .describe("Trigger online scoring on any spans with a name in this list"),
    skip_logging: z
      .boolean()
      .nullish()
      .describe("Whether to skip adding scorer spans when computing scores"),
  })
  .refine((val) => val.apply_to_root_span || val.apply_to_span_names?.length, {
    message: "Online scoring rule does not apply to any rows",
  })
  .openapi("OnlineScoreConfig");
export type OnlineScoreConfig = z.infer<typeof onlineScoreConfigSchema>;

const projectScoreBaseSchema = generateBaseTableSchema("project score");
export const projectScoreSchema = z
  .object({
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
          )
          .openapi({ title: "categorical" }),
        z
          .record(z.number())
          .describe(
            "For weighted-type project scores, the weights of each score",
          )
          .openapi({ title: "weighted" }),
        z
          .array(z.string())
          .describe(
            "For minimum-type project scores, the list of included scores",
          )
          .openapi({ title: "minimum" }),
      ])
      .nullish()
      .openapi("ProjectScoreCategories"),
    config: z
      .object({
        multi_select: z.boolean().nullish(),
        destination: z.string().nullish(),
        online: onlineScoreConfigSchema.nullish(),
      })
      .nullish()
      .openapi("ProjectScoreConfig"),
    position: z
      .string()
      .nullish()
      .describe(
        "An optional LexoRank-based string that sets the sort position for the score in the UI",
      ),
  })
  .describe(
    "A project score is a user-configured score, which can be manually-labeled through the UI",
  )
  .openapi("ProjectScore");
export type ProjectScore = z.infer<typeof projectScoreSchema>;

const projectTagBaseSchema = generateBaseTableSchema("project tag");
export const projectTagSchema = z
  .object({
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

export const spanIframeBaseSchema = generateBaseTableSchema("span iframe");
export const spanIframeSchema = z
  .object({
    id: spanIframeBaseSchema.shape.id,
    project_id: spanIframeBaseSchema.shape.project_id,
    user_id: spanIframeBaseSchema.shape.user_id,
    created: spanIframeBaseSchema.shape.created,
    deleted_at: spanIframeBaseSchema.shape.deleted_at,
    name: spanIframeBaseSchema.shape.name,
    description: spanIframeBaseSchema.shape.description,
    url: z.string().describe("URL to embed the project viewer in an iframe"),
    post_message: z
      .boolean()
      .nullish()
      .describe(
        "Whether to post messages to the iframe containing the span's data. This is useful when you want to render more data than fits in the URL.",
      ),
  })
  .openapi("SpanIFrame");
export type SpanIFrame = z.infer<typeof spanIframeSchema>;

const viewBaseSchema = generateBaseTableSchema("view");
export const viewSchema = z
  .object({
    id: viewBaseSchema.shape.id,
    object_type: aclObjectTypeEnum,
    object_id: z
      .string()
      .uuid()
      .describe("The id of the object the view applies to"),
    view_type: viewTypeEnum,
    name: viewBaseSchema.shape.name,
    created: viewBaseSchema.shape.created,
    view_data: viewDataSchema.nullish().describe("The view definition"),
    options: viewOptionsSchema
      .nullish()
      .describe("Options for the view in the app"),
    user_id: viewBaseSchema.shape.user_id,
    deleted_at: roleBaseSchema.shape.deleted_at,
  })
  .openapi("View");
export type View = z.infer<typeof viewSchema>;

const aclBaseSchema = generateBaseTableSchema("acl");
export const aclSchema = z
  .object({
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

export const appLimitParamSchema = z.coerce
  .number()
  .int()
  .nonnegative()
  .describe("Limit the number of objects to return")
  .openapi("AppLimit");

function generateBaseTableOpSchema(objectName: string) {
  return z.object({
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

function makeNonempty(s: z.ZodString): z.ZodString {
  return (s.minLength ?? 0) > 0 ? s : s.min(1);
}

const createProjectBaseSchema = generateBaseTableOpSchema("project");
export const createProjectSchema = z
  .object({
    name: makeNonempty(projectSchema.shape.name),
    org_name: createProjectBaseSchema.shape.org_name,
  })
  .openapi("CreateProject");

export const patchProjectSchema = z
  .object({
    name: projectSchema.shape.name.nullish(),
    settings: projectSchema.shape.settings
      .describe(
        "Project settings. Patch operations replace all settings, so make sure you include all settings you want to keep.",
      )
      .nullish(),
  })
  .openapi("PatchProject");

export const createExperimentSchema = z
  .object({
    project_id: experimentSchema.shape.project_id,
    name: makeNonempty(experimentSchema.shape.name).nullish(),
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

export const patchExperimentSchema = createExperimentSchema
  .omit({ project_id: true, ensure_new: true })
  .extend({ name: experimentSchema.shape.name.nullish() })
  .openapi("PatchExperiment");

export const createDatasetSchema = z
  .object({
    project_id: datasetSchema.shape.project_id,
    name: makeNonempty(datasetSchema.shape.name),
    description: datasetSchema.shape.description,
    metadata: datasetSchema.shape.metadata,
  })
  .openapi("CreateDataset");

export const patchDatasetSchema = z
  .object({
    name: datasetSchema.shape.name.nullish(),
    description: datasetSchema.shape.description,
    metadata: datasetSchema.shape.metadata,
  })
  .openapi("PatchDataset");

export const createPromptSchema = promptSchema
  .omit({
    id: true,
    _xact_id: true,
    org_id: true,
    log_id: true,
    created: true,
    metadata: true,
  })
  .extend({
    name: makeNonempty(promptSchema.shape.name),
    slug: makeNonempty(promptSchema.shape.slug),
  })
  .openapi("CreatePrompt");

export const createFunctionSchema = functionSchema
  .omit({
    id: true,
    _xact_id: true,
    org_id: true,
    log_id: true,
    created: true,
    metadata: true,
  })
  .extend({
    name: makeNonempty(promptSchema.shape.name),
    slug: makeNonempty(promptSchema.shape.slug),
  })
  .openapi("CreateFunction");

export const patchPromptSchema = z
  .object({
    name: promptSchema.shape.name.nullish(),
    slug: promptSchema.shape.slug.nullish(),
    description: promptSchema.shape.description.nullish(),
    prompt_data: promptSchema.shape.prompt_data.nullish(),
    tags: promptSchema.shape.tags.nullish(),
  })
  .openapi("PatchPrompt");

const patchFunctionSchema = z
  .object({
    name: functionSchema.shape.name.nullish(),
    description: functionSchema.shape.description.nullish(),
    prompt_data: functionSchema.shape.prompt_data.nullish(),
    function_data: functionSchema.shape.function_data
      .nullish()
      .openapi("FunctionDataNullish"),
    tags: functionSchema.shape.tags.nullish(),
  })
  .openapi("PatchFunction");

const createRoleBaseSchema = generateBaseTableOpSchema("role");
const createRoleSchema = z
  .object({
    name: makeNonempty(roleSchema.shape.name),
    description: roleSchema.shape.description,
    member_permissions: roleSchema.shape.member_permissions,
    member_roles: roleSchema.shape.member_roles,
    org_name: createRoleBaseSchema.shape.org_name,
  })
  .openapi("CreateRole");

export const patchRoleSchema = createRoleSchema
  .omit({
    name: true,
    org_name: true,
    member_permissions: true,
    member_roles: true,
  })
  .merge(
    z.object({
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
export const createGroupSchema = z
  .object({
    name: makeNonempty(groupSchema.shape.name),
    description: groupSchema.shape.description,
    member_users: groupSchema.shape.member_users,
    member_groups: groupSchema.shape.member_groups,
    org_name: createGroupBaseSchema.shape.org_name,
  })
  .openapi("CreateGroup");

export const patchGroupSchema = createGroupSchema
  .omit({ name: true, org_name: true, member_users: true, member_groups: true })
  .merge(
    z.object({
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

export const aclItemSchema = aclSchema
  .omit({
    id: true,
    created: true,
    _object_org_id: true,
  })
  .openapi("AclItem");

export type AclItem = z.infer<typeof aclItemSchema>;

export const aclBatchUpdateRequestSchema = z
  .object({
    add_acls: aclItemSchema.array().nullish(),
    remove_acls: aclItemSchema.array().nullish(),
  })
  .openapi("AclBatchUpdateRequest");

export type AclBatchUpdateRequest = z.infer<typeof aclBatchUpdateRequestSchema>;

export const aclBatchUpdateResponseSchema = z
  .object({
    added_acls: aclSchema.array(),
    removed_acls: aclSchema.array(),
  })
  .openapi("AclBatchUpdateResponse");

export type AclBatchUpdateResponse = z.infer<
  typeof aclBatchUpdateResponseSchema
>;

export const createProjectAutomationSchema = projectAutomationSchema
  .pick({
    project_id: true,
    name: true,
    description: true,
    config: true,
  })
  .openapi("CreateProjectAutomation");

export const patchProjectAutomationSchema = objectNullish(
  createProjectAutomationSchema,
)
  .omit({ project_id: true })
  .openapi("PatchProjectAutomation");

export const createProjectScoreSchema = projectScoreSchema
  .pick({
    project_id: true,
    name: true,
    description: true,
    score_type: true,
    categories: true,
    config: true,
  })
  .openapi("CreateProjectScore");

export const patchProjectScoreSchema = objectNullish(createProjectScoreSchema)
  .omit({ project_id: true })
  .openapi("PatchProjectScore");

export const createProjectTagSchema = z
  .object({
    project_id: projectTagSchema.shape.project_id,
    name: projectTagSchema.shape.name,
    description: projectTagSchema.shape.description,
    color: projectTagSchema.shape.color,
  })
  .openapi("CreateProjectTag");

export const patchProjectTagSchema = z
  .object({
    name: projectTagSchema.shape.name.nullish(),
    description: projectTagSchema.shape.description,
    color: projectTagSchema.shape.color,
  })
  .openapi("PatchProjectTag");

export const createSpanIframeSchema = spanIframeSchema
  .omit({
    id: true,
    created: true,
    deleted_at: true,
    user_id: true,
  })
  .openapi("CreateSpanIFrame");

export const patchSpanIframeSchema = z
  .object({
    name: spanIframeSchema.shape.name.nullish(),
    url: spanIframeSchema.shape.url.nullish(),
    post_message: spanIframeSchema.shape.post_message.nullish(),
    description: spanIframeSchema.shape.description.nullish(),
  })
  .openapi("PatchSpanIFrame");

export const createViewSchema = viewSchema
  .omit({
    id: true,
    created: true,
  })
  .openapi("CreateView");

export const patchViewSchema = z
  .object({
    object_type: viewSchema.shape.object_type,
    object_id: viewSchema.shape.object_id,
    view_type: viewSchema.shape.view_type.nullish(),
    name: viewSchema.shape.name.nullish(),
    view_data: viewSchema.shape.view_data,
    options: viewSchema.shape.options,
    user_id: viewSchema.shape.user_id,
  })
  .openapi("PatchView");

const deleteViewSchema = z
  .object({
    object_type: viewSchema.shape.object_type,
    object_id: viewSchema.shape.object_id,
  })
  .openapi("DeleteView");

export const patchOrganizationSchema = z
  .object({
    name: organizationSchema.shape.name.nullish(),
    api_url: organizationSchema.shape.api_url.nullish(),
    is_universal_api: organizationSchema.shape.is_universal_api.nullish(),
    proxy_url: organizationSchema.shape.proxy_url.nullish(),
    realtime_url: organizationSchema.shape.realtime_url.nullish(),
  })
  .openapi("PatchOrganization");

const createApiKeyBaseSchema = generateBaseTableOpSchema("API key");
export const createApiKeySchema = z.object({
  name: z.string().describe("Name of the api key. Does not have to be unique"),
  org_name: createApiKeyBaseSchema.shape.org_name,
});

export const createApiKeyOutputSchema = apiKeySchema
  .merge(
    z.object({
      key: z
        .string()
        .describe("The raw API key. It will only be exposed this one time"),
    }),
  )
  .openapi("CreateApiKeyOutput");

export const organizationMembersSchema = z
  .object({
    members: userSchema.pick({ id: true, email: true }).array(),
  })
  .openapi("OrganizationMembers");

export const patchOrganizationMembersSchema = z
  .object({
    invite_users: z
      .object({
        ids: userSchema.shape.id
          .array()
          .nullish()
          .describe("Ids of existing users to invite"),
        emails: userSchema.shape.email
          .unwrap()
          .unwrap()
          .array()
          .nullish()
          .describe("Emails of users to invite"),
        send_invite_emails: z
          .boolean()
          .nullish()
          .describe(
            "If true, send invite emails to the users who wore actually added",
          ),
        group_ids: groupSchema.shape.id
          .array()
          .nullish()
          .describe(
            "Optional list of group ids to add newly-invited users to.",
          ),
        group_names: groupSchema.shape.name
          .array()
          .nullish()
          .describe(
            "Optional list of group names to add newly-invited users to.",
          ),
        group_id: groupSchema.shape.id
          .nullish()
          .describe("Singular form of group_ids"),
        group_name: groupSchema.shape.name
          .nullish()
          .describe("Singular form of group_names"),
      })
      .nullish()
      .describe("Users to invite to the organization"),
    remove_users: z
      .object({
        ids: userSchema.shape.id
          .array()
          .nullish()
          .describe("Ids of users to remove"),
        emails: userSchema.shape.email
          .unwrap()
          .unwrap()
          .array()
          .nullish()
          .describe("Emails of users to remove"),
      })
      .nullish()
      .describe("Users to remove from the organization"),
    org_name: z
      .string()
      .nullish()
      .describe(
        `For nearly all users, this parameter should be unnecessary. But in the rare case that your API key belongs to multiple organizations, or in case you want to explicitly assert the organization you are modifying, you may specify the name of the organization.`,
      ),
    org_id: z
      .string()
      .nullish()
      .describe(
        `For nearly all users, this parameter should be unnecessary. But in the rare case that your API key belongs to multiple organizations, or in case you want to explicitly assert the organization you are modifying, you may specify the id of the organization.`,
      ),
  })
  .openapi("PatchOrganizationMembers");

export const patchOrganizationMembersOutputSchema = z
  .object({
    status: z.literal("success"),
    org_id: z.string().describe("The id of the org that was modified."),
    send_email_error: z
      .string()
      .nullish()
      .describe(
        "If invite emails failed to send for some reason, the patch operation will still complete, but we will return an error message here",
      ),
  })
  .openapi("PatchOrganizationMembersOutput");

const createAISecretBaseSchema = generateBaseTableOpSchema("AI Secret");
export const createAISecretSchema = z
  .object({
    name: aiSecretSchema.shape.name,
    type: aiSecretSchema.shape.type,
    metadata: aiSecretSchema.shape.metadata,
    secret: z
      .string()
      .nullish()
      .describe(
        "Secret value. If omitted in a PUT request, the existing secret value will be left intact, not replaced with null.",
      ),
    org_name: createAISecretBaseSchema.shape.org_name,
  })
  .openapi("CreateAISecret");

export const deleteAISecretSchema = z
  .object({
    name: aiSecretSchema.shape.name,
    org_name: createAISecretBaseSchema.shape.org_name,
  })
  .openapi("DeleteAISecret");

export const patchAISecretSchema = z
  .object({
    name: aiSecretSchema.shape.name.nullish(),
    type: aiSecretSchema.shape.type,
    metadata: aiSecretSchema.shape.metadata,
    secret: z.string().nullish(),
  })
  .openapi("PatchAISecret");

export const createEnvVarSchema = envVarSchema
  .pick({ object_type: true, object_id: true, name: true })
  .extend({
    value: z
      .string()
      .nullish()
      .describe(
        "The value of the environment variable. Will be encrypted at rest.",
      ),
  });

export const patchEnvVarSchema = envVarSchema.pick({ name: true }).extend({
  value: z
    .string()
    .nullish()
    .describe(
      "The value of the environment variable. Will be encrypted at rest.",
    ),
});

// Section: exported schemas, grouped by object type. The schemas are used for
// API spec generation, so their types are not fully-specified. If you wish to
// use individual schema types, import them directly.

export type ObjectSchemasEntry = {
  object?: z.ZodTypeAny;
  create?: z.ZodTypeAny;
  delete?: z.ZodTypeAny;
  patch_id?: z.ZodTypeAny;
  delete_id?: z.ZodTypeAny;
};

export const apiSpecObjectSchemas: Record<ObjectType, ObjectSchemasEntry> = {
  experiment: {
    object: experimentSchema,
    create: createExperimentSchema,
    patch_id: patchExperimentSchema,
  },
  dataset: {
    object: datasetSchema,
    create: createDatasetSchema,
    patch_id: patchDatasetSchema,
  },
  project: {
    object: projectSchema,
    create: createProjectSchema,
    patch_id: patchProjectSchema,
  },
  prompt: {
    object: promptSchema,
    create: createPromptSchema,
    patch_id: patchPromptSchema,
  },
  function: {
    object: functionSchema,
    create: createFunctionSchema,
    patch_id: patchFunctionSchema,
  },
  role: {
    object: roleSchema,
    create: createRoleSchema,
    patch_id: patchRoleSchema,
  },
  group: {
    object: groupSchema,
    create: createGroupSchema,
    patch_id: patchGroupSchema,
  },
  acl: {
    object: aclSchema,
    create: aclItemSchema,
    delete: aclItemSchema,
  },
  user: {
    object: userSchema,
  },
  prompt_session: {},
  project_automation: {
    object: projectAutomationSchema,
    create: createProjectAutomationSchema,
    patch_id: patchProjectAutomationSchema,
  },
  project_score: {
    object: projectScoreSchema,
    create: createProjectScoreSchema,
    patch_id: patchProjectScoreSchema,
  },
  project_tag: {
    object: projectTagSchema,
    create: createProjectTagSchema,
    patch_id: patchProjectTagSchema,
  },
  span_iframe: {
    object: spanIframeSchema,
    create: createSpanIframeSchema,
    patch_id: patchSpanIframeSchema,
  },
  view: {
    object: viewSchema,
    delete_id: deleteViewSchema,
    create: createViewSchema,
    patch_id: patchViewSchema,
  },
  organization: {
    object: organizationSchema,
    patch_id: patchOrganizationSchema,
  },
  api_key: {
    object: apiKeySchema,
    create: createApiKeySchema,
  },
  ai_secret: {
    object: aiSecretSchema,
    create: createAISecretSchema,
    delete: deleteAISecretSchema,
    patch_id: patchAISecretSchema,
  },
  env_var: {
    object: envVarSchema,
    create: createEnvVarSchema,
    patch_id: patchEnvVarSchema,
  },
};
