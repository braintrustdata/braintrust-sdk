import { simpleGit } from "simple-git";

/**
 * Information about the current HEAD of the repo.
 */
export interface RepoStatus {
  commit?: string;
  branch?: string;
  tag?: string;
  dirty: boolean;
  author_name?: string;
  author_email?: string;
  commit_message?: string;
  commit_time?: string;
}

export async function currentRepo() {
  const git = simpleGit();
  if (await git.checkIsRepo()) {
    return git;
  } else {
    return null;
  }
}

let _baseBranch: {
  remote: string;
  branch: string;
} | null = null;

async function getBaseBranch(remote: string | undefined = undefined) {
  if (_baseBranch === null) {
    const git = await currentRepo();
    if (git === null) {
      throw new Error("Not in a git repo");
    }

    const remoteName = remote ?? (await git.getRemotes())[0]?.name;
    if (!remoteName) {
      throw new Error("No remote found");
    }

    let branch = null;

    try {
      const remoteInfo = await git.remote(["show", remoteName]);
      if (!remoteInfo) {
        throw new Error(`Could not find remote ${remoteName}`);
      }
      const match = remoteInfo.match(/\s*HEAD branch:\s*(.*)$/m);
      if (!match) {
        throw new Error(`Could not find HEAD branch in remote ${remoteName}`);
      }
      branch = match[1];
    } catch {
      branch = "main";
    }

    _baseBranch = { remote: remoteName, branch };
  }

  return _baseBranch;
}

async function getBaseBranchAncestor(remote: string | undefined = undefined) {
  const git = await currentRepo();
  if (git === null) {
    throw new Error("Not in a git repo");
  }

  const { remote: remoteName, branch: baseBranch } = await getBaseBranch(
    remote
  );

  const isDirty = (await git.diffSummary()).files.length > 0;
  const head = isDirty ? "HEAD" : "HEAD^";

  try {
    const ancestor = await git.raw([
      "merge-base",
      head,
      `${remoteName}/${baseBranch}`,
    ]);
    return ancestor.trim();
  } catch (e) {
    /*
    console.warn(
      `Warning: Could not find a common ancestor with ${remoteName}/${baseBranch}`
    );
    */
    return undefined;
  }
}

export async function getPastNAncestors(
  n: number = 10,
  remote: string | undefined = undefined
) {
  const git = await currentRepo();
  if (git === null) {
    return [];
  }

  let ancestor = undefined;
  try {
    ancestor = await getBaseBranchAncestor(remote);
  } catch (e) {
    console.warn(
      "Skipping git metadata. This is likely because the repository has not been published to a remote yet.",
      `${e}`
    );
  }
  if (!ancestor) {
    return [];
  }
  const commits = await git.log({ from: ancestor, to: "HEAD" });
  return commits.all.map((c) => c.hash);
}

async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    return undefined;
  }
}

export async function getRepoStatus() {
  const git = await currentRepo();
  if (git === null) {
    return undefined;
  }

  let commit = undefined;
  let commit_message = undefined;
  let commit_time = undefined;
  let author_name = undefined;
  let author_email = undefined;
  let tag = undefined;
  let branch = undefined;

  const dirty = (await git.diffSummary()).files.length > 0;

  commit = await attempt(async () => await git.revparse(["HEAD"]));
  commit_message = await attempt(async () =>
    (await git.raw(["log", "-1", "--pretty=%B"])).trim()
  );
  commit_time = await attempt(async () =>
    (await git.raw(["log", "-1", "--pretty=%cI"])).trim()
  );
  author_name = await attempt(async () =>
    (await git.raw(["log", "-1", "--pretty=%aN"])).trim()
  );
  author_email = await attempt(async () =>
    (await git.raw(["log", "-1", "--pretty=%aE"])).trim()
  );
  tag = await attempt(async () =>
    (await git.raw(["describe", "--tags", "--exact-match", "--always"])).trim()
  );

  branch = await attempt(async () =>
    (await git.raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim()
  );

  return {
    commit,
    branch,
    tag,
    dirty,
    author_name,
    author_email,
    commit_message,
    commit_time,
  };
}
