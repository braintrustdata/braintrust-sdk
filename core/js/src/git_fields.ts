import { repoInfoSchema } from "typespecs";
import { z } from "zod";

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

export function mergeGitMetadataSettings(
  s1: GitMetadataSettings,
  s2: GitMetadataSettings,
): GitMetadataSettings {
  if (s1.collect === "all") {
    return s2;
  } else if (s2.collect === "all") {
    return s1;
  } else if (s1.collect === "none") {
    return s1;
  } else if (s2.collect === "none") {
    return s2;
  }

  // s1.collect === "some" && s2.collect === "some"
  const fields = (s1.fields ?? []).filter((f) => (s2.fields ?? []).includes(f));
  const collect = fields.length > 0 ? "some" : "none";
  return { collect, fields };
}
