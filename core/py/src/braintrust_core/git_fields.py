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

    @classmethod
    def merge(cls, s1: "GitMetadataSettings", s2: "GitMetadataSettings") -> "GitMetadataSettings":
        # If either is all, then return the other
        # If either is none, then return that one
        if s1.collect == "all":
            return s2
        elif s2.collect == "all":
            return s1
        elif s1.collect == "none":
            return s1
        elif s2.collect == "none":
            return s2

        assert s1.collect == "some" and s2.collect == "some"
        # intersect the fields
        ret = GitMetadataSettings(collect="some", fields=list(set(s1.fields or []).intersection(s2.fields or [])))
        if not ret.fields:
            ret.collect = "none"
        return ret
