from dataclasses import dataclass, field
from typing import List, Literal, Optional

from .util import SerializableDataClass


@dataclass
class RepoStatus(SerializableDataClass):
    """Information about the current HEAD of the repo."""

    commit: Optional[str]
    branch: Optional[str]
    tag: Optional[str]
    dirty: Optional[bool]
    author_name: Optional[str]
    author_email: Optional[str]
    commit_message: Optional[str]
    commit_time: Optional[str]
    git_diff: Optional[str]


@dataclass
class GitMetadataSettings(SerializableDataClass):
    collect: Literal["all", "some", "none"] = "all"
    fields: Optional[List[str]] = field(default_factory=list)
