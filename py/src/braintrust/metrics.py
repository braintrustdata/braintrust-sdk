from typing import Dict, TypedDict, Union

from typing_extensions import NotRequired


class TokenMetrics(TypedDict, total=False):
    """Token-related metrics for LLM operations."""

    # Core token counts
    prompt_tokens: NotRequired[float]
    """Number of tokens in the input/prompt"""

    completion_tokens: NotRequired[float]
    """Number of tokens in the output/completion"""

    tokens: NotRequired[float]
    """Total token count (prompt + completion)"""

    # Cached token metrics
    prompt_cached_tokens: NotRequired[float]
    """Number of tokens read from prompt cache"""

    prompt_cache_creation_tokens: NotRequired[float]
    """Number of tokens used to write/create prompt cache"""

    # Reasoning token metrics (e.g., o1 models)
    prompt_reasoning_tokens: NotRequired[float]
    """Number of tokens used for reasoning in prompts"""

    completion_cached_tokens: NotRequired[float]
    """Number of cached tokens in completion"""

    completion_reasoning_tokens: NotRequired[float]
    """Number of tokens used for reasoning in completion"""

    # Multimodal metrics
    completion_audio_tokens: NotRequired[float]
    """Number of audio tokens in completion (multimodal)"""

    time_to_first_token: NotRequired[float]
    """Time from request start to first token received (in seconds)"""


class TimingMetrics(TypedDict, total=False):
    """Timing and performance metrics."""

    start: NotRequired[float]
    """Unix timestamp (in seconds) when the operation started"""

    end: NotRequired[float]
    """Unix timestamp (in seconds) when the operation ended"""

    duration: NotRequired[float]
    """Total duration in seconds (calculated as end - start)"""


# pylint: disable-next-line=duplicate-bases
class StandardMetrics(TokenMetrics, TimingMetrics, total=False):
    """Standard metrics tracked by Braintrust, combining token and timing metrics."""

    cached: NotRequired[float]
    """1 if response was cached, 0 or undefined otherwise"""


Metrics = Union[StandardMetrics, Dict[str, int]]
