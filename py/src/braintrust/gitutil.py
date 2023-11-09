import logging
import os
import re
import subprocess
import threading
from dataclasses import dataclass
from functools import cache as _cache
from typing import Optional

from .util import SerializableDataClass

# https://stackoverflow.com/questions/48399498/git-executable-not-found-in-python
os.environ["GIT_PYTHON_REFRESH"] = "quiet"
import git

_logger = logging.getLogger("braintrust.gitutil")
_gitlock = threading.RLock()


@dataclass
class RepoStatus(SerializableDataClass):
    """Information about the current HEAD of the repo."""

    commit: Optional[str]
    branch: Optional[str]
    tag: Optional[str]
    dirty: bool
    author_name: Optional[str]
    author_email: Optional[str]
    commit_message: Optional[str]
    commit_time: Optional[str]


@_cache
def _current_repo():
    try:
        return git.Repo(search_parent_directories=True)
    except git.exc.InvalidGitRepositoryError:
        return None


@_cache
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
            if ancestor.parents:
                ancestor = ancestor.parents[0]
            else:
                break


def attempt(op):
    try:
        return op()
    except TypeError:
        return None
    except git.GitCommandError:
        return None


def get_repo_status():
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

        dirty = repo.is_dirty()

        if not dirty:
            commit = attempt(lambda: repo.head.commit.hexsha).strip()
            commit_message = attempt(lambda: repo.head.commit.message).strip()
            commit_time = attempt(lambda: repo.head.commit.committed_datetime.isoformat())
            author_name = attempt(lambda: repo.head.commit.author.name).strip()
            author_email = attempt(lambda: repo.head.commit.author.email).strip()
            tag = attempt(lambda: repo.git.describe("--tags", "--exact-match", "--always"))

        branch = attempt(lambda: repo.active_branch.name)

        return RepoStatus(
            commit=commit,
            branch=branch,
            tag=tag,
            dirty=dirty,
            author_name=author_name,
            author_email=author_email,
            commit_message=commit_message,
            commit_time=commit_time,
        )
