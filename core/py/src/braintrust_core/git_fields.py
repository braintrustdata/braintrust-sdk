from dataclasses import dataclass, field
from typing import List, Literal, Optional

from .util import SerializableDataClass


@dataclass
class RepoInfo(SerializableDataClass):
    """Information about the current HEAD of the repo."""

    commit: Optional[str] = None
    branch: Optional[str] = None
    tag: Optional[str] = None
    dirty: Optional[bool] = None
    author_name: Optional[str] = None
    author_email: Optional[str] = None
    commit_message: Optional[str] = None
    commit_time: Optional[str] = None
    git_diff: Optional[str] = None


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
