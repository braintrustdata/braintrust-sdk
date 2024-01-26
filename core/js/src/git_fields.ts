export interface RepoStatus {
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

export type GitFields = Array<keyof RepoStatus>;
export type CollectMetadata = "all" | "none" | "some";
export type GitMetadataSettings = {
  collect: CollectMetadata;
  fields: GitFields;
};
