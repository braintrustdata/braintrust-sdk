// Type definitions for operating on the app database.

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
extendZodWithOpenApi(z);

import { datetimeStringSchema } from "./common_types";
import { customTypes } from "./custom_types";

// Section: App DB table schemas

function generateBaseTableSchema(
  objectName: string,
  opts?: { underProject?: boolean }
) {
  let nameDescription = `Name of the ${objectName}`;
  if (opts?.underProject) {
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
  underProject: true,
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
  underProject: true,
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

const privilegeEnum = z
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
      "Each privilege permits a certain type of operation on an object in the system",
      "Privileges can be assigned to to objects on an individual basis, or grouped into roles",
    ].join("\n\n")
  );
export type Privilege = z.infer<typeof privilegeEnum>;

const roleBaseSchema = generateBaseTableSchema("role", { underProject: false });
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
        ].join("\n\n")
      ),
    user_id: roleBaseSchema.shape.user_id,
    created: roleBaseSchema.shape.created,
    name: roleBaseSchema.shape.name,
    description: roleBaseSchema.shape.description,
    deleted_at: roleBaseSchema.shape.deleted_at,
    member_privileges: z
      .array(privilegeEnum)
      .nullish()
      .describe("Privileges which belong to this role"),
    member_roles: z
      .array(z.string().uuid())
      .nullish()
      .describe(
        [
          "Ids of the roles this role inherits from",
          "An inheriting role has all the privileges contained in its member roles, as well as all of their inherited privileges",
        ].join("\n\n")
      ),
  })
  .strict()
  .describe(
    [
      "A role is a collection of privileges which can be granted as part of an ACL",
      "Roles can consist of individual privileges, as well as a set of roles they inherit from",
    ].join("\n\n")
  )
  .openapi("Role");
export type Role = z.infer<typeof roleSchema>;

const teamBaseSchema = generateBaseTableSchema("team", { underProject: false });
export const teamSchema = z
  .object({
    id: teamBaseSchema.shape.id,
    org_id: z
      .string()
      .uuid()
      .describe(
        [
          "Unique id for the organization that the team belongs under",
          "It is forbidden to change the org after creating a team",
        ].join("\n\n")
      ),
    user_id: teamBaseSchema.shape.user_id,
    created: teamBaseSchema.shape.created,
    name: teamBaseSchema.shape.name,
    description: teamBaseSchema.shape.description,
    deleted_at: teamBaseSchema.shape.deleted_at,
    member_users: z
      .array(z.string().uuid())
      .nullish()
      .describe("Ids of users which belong to this team"),
    member_teams: z
      .array(z.string().uuid())
      .nullish()
      .describe(
        [
          "Ids of the teams this team inherits from",
          "An inheriting team has all the users contained in its member teams, as well as all of their inherited users",
        ].join("\n\n")
      ),
  })
  .strict()
  .describe(
    [
      "A team is a collection of users which can be assigned an ACL",
      "Teams can consist of individual users, as well as a set of teams they inherit from",
    ].join("\n\n")
  )
  .openapi("Team");
export type Team = z.infer<typeof teamSchema>;

export const aclObjectTypeEnum = z
  .enum([
    "organization",
    "project",
    "experiment",
    "dataset",
    "prompt_session",
    "project_score",
    "project_tag",
    "team",
    "role",
  ])
  .describe("The object type that the ACL applies to");
export type AclObjectType = z.infer<typeof aclObjectTypeEnum>;

const aclBaseSchema = generateBaseTableSchema("acl", { underProject: false });
export const aclObjectSchema = z
  .object({
    id: aclBaseSchema.shape.id,
    object_type: aclObjectTypeEnum,
    object_id: z
      .string()
      .uuid()
      .describe("The id of the object the ACL applies to"),
    created: aclBaseSchema.shape.created,
  })
  .strict();
const aclUserObjectSchema = z
  .object({
    user_id: z.string().uuid().describe("Id of the user the ACL applies to"),
  })
  .strict();
const aclTeamObjectSchema = z
  .object({
    team_id: z.string().uuid().describe("Id of the team the ACL applies to"),
  })
  .strict();
const aclPrivilegeObjectSchema = z
  .object({
    privilege: privilegeEnum.describe("Privilege the ACL grants"),
  })
  .strict();
const aclRoleObjectSchema = z
  .object({
    role_id: z.string().uuid().describe("Role the ACL grants"),
  })
  .strict();

export const aclSchema = z
  .union([
    aclObjectSchema
      .merge(aclUserObjectSchema)
      .merge(aclPrivilegeObjectSchema)
      .openapi("UserPrivilegeAcl"),
    aclObjectSchema
      .merge(aclUserObjectSchema)
      .merge(aclRoleObjectSchema)
      .openapi("UserRoleAcl"),
    aclObjectSchema
      .merge(aclTeamObjectSchema)
      .merge(aclPrivilegeObjectSchema)
      .openapi("TeamPrivilegeAcl"),
    aclObjectSchema
      .merge(aclTeamObjectSchema)
      .merge(aclRoleObjectSchema)
      .openapi("TeamRoleAcl"),
  ])
  .describe(
    [
      "An ACL grants a certain privilege or role to a certain user or team on an object",
      "ACLs are inherited across the object hierarchy. So for example, if a user has read privileges on a project, they will also have read privileges on any experiment, dataset, etc. created within that project",
    ].join("\n\n")
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

const createRoleBaseSchema = generateBaseTableOpSchema("role");
const createRoleSchema = z
  .object({
    name: roleSchema.shape.name,
    description: roleSchema.shape.description,
    member_privileges: roleSchema.shape.member_privileges,
    member_roles: roleSchema.shape.member_roles,
    org_name: createRoleBaseSchema.shape.org_name,
  })
  .strict()
  .openapi("CreateRole");

const patchRoleSchema = createRoleSchema
  .omit({ name: true, org_name: true })
  .merge(
    z.object({
      name: createRoleSchema.shape.name.nullish(),
    })
  )
  .openapi("PatchRole");

const createTeamBaseSchema = generateBaseTableOpSchema("team");
const createTeamSchema = z
  .object({
    name: teamSchema.shape.name,
    description: teamSchema.shape.description,
    member_users: teamSchema.shape.member_users,
    member_teams: teamSchema.shape.member_teams,
    org_name: createTeamBaseSchema.shape.org_name,
  })
  .strict()
  .openapi("CreateTeam");

const patchTeamSchema = createTeamSchema
  .omit({ name: true, org_name: true })
  .merge(
    z.object({
      name: createTeamSchema.shape.name.nullish(),
    })
  )
  .openapi("PatchTeam");

const createAclObjectSchema = aclObjectSchema.omit({ id: true, created: true });
const createAclSchema = z
  .union([
    createAclObjectSchema
      .merge(aclUserObjectSchema)
      .merge(aclPrivilegeObjectSchema)
      .openapi("CreateUserPrivilegeAcl"),
    createAclObjectSchema
      .merge(aclUserObjectSchema)
      .merge(aclRoleObjectSchema)
      .openapi("CreateUserRoleAcl"),
    createAclObjectSchema
      .merge(aclTeamObjectSchema)
      .merge(aclPrivilegeObjectSchema)
      .openapi("CreateTeamPrivilegeAcl"),
    createAclObjectSchema
      .merge(aclTeamObjectSchema)
      .merge(aclRoleObjectSchema)
      .openapi("CreateTeamRoleAcl"),
  ])
  .openapi("CreateAcl");

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
  role: {
    create: createRoleSchema,
    patch: patchRoleSchema,
    object: roleSchema,
  },
  team: {
    create: createTeamSchema,
    patch: patchTeamSchema,
    object: teamSchema,
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
};
