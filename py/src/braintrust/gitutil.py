import logging
import os
import re
import subprocess
import threading
from functools import lru_cache as _cache
from typing import List, Optional

from braintrust_core.git_fields import GitMetadataSettings, RepoInfo

# https://stackoverflow.com/questions/48399498/git-executable-not-found-in-python
os.environ["GIT_PYTHON_REFRESH"] = "quiet"
try:
    import git
except ImportError:
    git = None

_logger = logging.getLogger("braintrust.gitutil")
_gitlock = threading.RLock()


@_cache(1)
def _current_repo():
    if git is None:
        # If the git module is not available, we can't do anything.
        return None

    try:
        return git.Repo(search_parent_directories=True)
    except git.exc.InvalidGitRepositoryError:
        return None


@_cache(1)
def _get_base_branch(remote=None):
    repo = _current_repo()
    remote = repo.remote(**({} if remote is None else {"name": remote})).name

    # NOTE: This should potentially be configuration that we derive from the project,
    # instead of spending a second or two computing it each time we run an experiment.

    # To speed this up in the short term, we pick from a list of common names
    # and only fall back to the remote origin if required.
    COMMON_BASE_BRANCHES = ["main", "master", "develop"]
    repo_branches = set(b.name for b in repo.branches)
    if sum(b in repo_branches for b in COMMON_BASE_BRANCHES) == 1:
        for b in COMMON_BASE_BRANCHES:
            if b in repo_branches:
                return (remote, b)
        raise RuntimeError("Impossible")

    try:
        s = subprocess.check_output(["git", "remote", "show", "origin"]).decode()
        match = re.search(r"\s*HEAD branch:\s*(.*)$", s, re.MULTILINE)
        if match is None:
            raise RuntimeError("Could not find HEAD branch in remote " + remote)
        branch = match.group(1)
    except Exception as e:
        _logger.warning(f"Could not find base branch for remote {remote}", e)
        branch = "main"
    return (remote, branch)


def _get_base_branch_ancestor(remote=None):
    try:
        remote_name, base_branch = _get_base_branch(remote)
    except Exception as e:
        _logger.warning(
            f"Skipping git metadata. This is likely because the repository has not been published to a remote yet. {e}"
        )
        return None

    head = "HEAD" if _current_repo().is_dirty() else "HEAD^"
    try:
        return subprocess.check_output(["git", "merge-base", head, f"{remote_name}/{base_branch}"]).decode().strip()
    except subprocess.CalledProcessError as e:
        # _logger.warning(f"Could not find a common ancestor with {remote_name}/{base_branch}")
        return None


def get_past_n_ancestors(n=10, remote=None):
    with _gitlock:
        repo = _current_repo()
        if repo is None:
            return

        ancestor_output = _get_base_branch_ancestor()
        if ancestor_output is None:
            return
        ancestor = repo.commit(ancestor_output)
        for _ in range(n):
            yield ancestor.hexsha
            try:
                if ancestor.parents:
                    ancestor = ancestor.parents[0]
                else:
                    break
            except ValueError:
                # Since parents are fetched on-demand, this can happen if the
                # downloaded repo does not have information for this commit's
                # parent.
                break


def attempt(op):
    try:
        return op()
    except (TypeError, ValueError, git.GitCommandError):
        return None


def truncate_to_byte_limit(input_string, byte_limit=65536):
    encoded = input_string.encode("utf-8")
    if len(encoded) <= byte_limit:
        return input_string
    return encoded[:byte_limit].decode("utf-8", errors="ignore")


def get_repo_info(settings: Optional[GitMetadataSettings] = None):
    if settings is None:
        settings = GitMetadataSettings()

    if settings.collect == "none":
        return None

    repo = repo_info()
    if repo is None or settings.collect == "all":
        return repo

    return RepoInfo(**{k: v if k in settings.fields else None for k, v in repo.as_dict().items()})


def repo_info():
    with _gitlock:
        repo = _current_repo()
        if repo is None:
            return None

        commit = None
        commit_message = None
        commit_time = None
        author_name = None
        author_email = None
        tag = None
        branch = None
        git_diff = None

        dirty = repo.is_dirty()

        commit = attempt(lambda: repo.head.commit.hexsha.strip())
        commit_message = attempt(lambda: repo.head.commit.message.strip())
        commit_time = attempt(lambda: repo.head.commit.committed_datetime.isoformat())
        author_name = attempt(lambda: repo.head.commit.author.name.strip())
        author_email = attempt(lambda: repo.head.commit.author.email.strip())
        tag = attempt(lambda: repo.git.describe("--tags", "--exact-match", "--always"))

        branch = attempt(lambda: repo.active_branch.name)

        if dirty:
            git_diff = attempt(lambda: truncate_to_byte_limit(repo.git.diff("HEAD")))

        return RepoInfo(
            commit=commit,
            branch=branch,
            tag=tag,
            dirty=dirty,
            author_name=author_name,
            author_email=author_email,
            commit_message=commit_message,
            commit_time=commit_time,
            git_diff=git_diff,
        )
