from dataclasses import dataclass, field
from typing import Literal

from .serializable_data_class import SerializableDataClass


@dataclass
class RepoInfo(SerializableDataClass):
    """Information about the current HEAD of the repo."""

    commit: str | None = None
    branch: str | None = None
    tag: str | None = None
    dirty: bool | None = None
    author_name: str | None = None
    author_email: str | None = None
    commit_message: str | None = None
    commit_time: str | None = None
    git_diff: str | None = None


@dataclass
class GitMetadataSettings(SerializableDataClass):
    collect: Literal["all", "some", "none"] = "all"
    fields: list[str] | None = field(default_factory=list)

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
