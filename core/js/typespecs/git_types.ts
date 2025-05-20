import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
extendZodWithOpenApi(z);

export const repoInfoSchema = z
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

export type RepoInfo = z.infer<typeof repoInfoSchema>;

export const gitFieldsSchema = repoInfoSchema.keyof();
export type GitFields = z.infer<typeof gitFieldsSchema>;

const collectMetadataEnum = z.enum(["all", "none", "some"]);
export type CollectMetadata = z.infer<typeof collectMetadataEnum>;

export const gitMetadataSettingsSchema = z.strictObject({
  collect: collectMetadataEnum,
  fields: z.array(gitFieldsSchema).optional(),
});
export type GitMetadataSettings = z.infer<typeof gitMetadataSettingsSchema>;
