export interface RepoInfo {
  commit?: string;
  branch?: string;
  tag?: string;
  dirty?: boolean;
  author_name?: string;
  author_email?: string;
  commit_message?: string;
  commit_time?: string;
  git_diff?: string;
}

export type GitFields = Array<keyof RepoInfo>;
export type CollectMetadata = "all" | "none" | "some";
export type GitMetadataSettings = {
  collect: CollectMetadata;
  fields?: GitFields;
};

export function mergeGitMetadataSettings(
  s1: GitMetadataSettings,
  s2: GitMetadataSettings
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
