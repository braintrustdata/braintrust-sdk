import dataclasses
from abc import ABC, abstractmethod
from typing import Dict, Optional

from .util import SerializableDataClass, eprint


@dataclasses.dataclass
class Score(SerializableDataClass):
    name: str
    score: Optional[float]
    metadata: Dict[str, any] = dataclasses.field(default_factory=dict)
    # DEPRECATION_NOTICE: this field is deprecated, as errors are propagated up to the caller.
    error: Exception = None

    def as_dict(self):
        return {
            "score": self.score,
            "metadata": self.metadata,
        }

    def __post_init__(self):
        if self.score is not None and (self.score < 0 or self.score > 1):
            raise ValueError(f"score ({self.score}) must be between 0 and 1")
        if self.error is not None:
            eprint(
                "The error field is deprecated, as errors are now propagated to the caller. The field will be removed in a future version of the library"
            )


class Scorer(ABC):
    async def eval_async(self, output, expected=None, **kwargs):
        return await self._run_eval_async(output, expected, **kwargs)

    def eval(self, output, expected=None, **kwargs):
        return self._run_eval_sync(output, expected, **kwargs)

    def __call__(self, output, expected=None, **kwargs):
        return self.eval(output, expected, **kwargs)

    async def _run_eval_async(self, output, expected=None, **kwargs) -> Score:
        # By default we just run the sync version in a thread
        return self._run_eval_sync(output, expected, **kwargs)

    def _name(self) -> str:
        return self.__class__.__name__

    @abstractmethod
    def _run_eval_sync(self, output, expected=None, **kwargs) -> Score:
        ...


__all__ = ["Score", "Scorer"]
