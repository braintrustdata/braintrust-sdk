from typing import Optional, TypedDict


class TokenMetrics(TypedDict, total=False):
    """Token-related metrics for LLM operations."""

    # Core token counts
    prompt_tokens: Optional[float]
    """Number of tokens in the input/prompt"""

    completion_tokens: Optional[float]
    """Number of tokens in the output/completion"""

    tokens: Optional[float]
    """Total token count (prompt + completion)"""

    # Cached token metrics
    prompt_cached_tokens: Optional[float]
    """Number of tokens read from prompt cache"""

    prompt_cache_creation_tokens: Optional[float]
    """Number of tokens used to write/create prompt cache"""

    # Reasoning token metrics (e.g., o1 models)
    prompt_reasoning_tokens: Optional[float]
    """Number of tokens used for reasoning in prompts"""

    completion_cached_tokens: Optional[float]
    """Number of cached tokens in completion"""

    completion_reasoning_tokens: Optional[float]
    """Number of tokens used for reasoning in completion"""

    # Multimodal metrics
    completion_audio_tokens: Optional[float]
    """Number of audio tokens in completion (multimodal)"""

    time_to_first_token: Optional[float]
    """Time from request start to first token received (in seconds)"""


class TimingMetrics(TypedDict, total=False):
    """Timing and performance metrics."""

    start: Optional[float]
    """Unix timestamp (in seconds) when the operation started"""

    end: Optional[float]
    """Unix timestamp (in seconds) when the operation ended"""

    duration: Optional[float]
    """Total duration in seconds (calculated as end - start)"""


class StandardMetrics(TokenMetrics, TimingMetrics, total=False):
    """Standard metrics tracked by Braintrust, combining token and timing metrics."""

    cached: Optional[float]
    """1 if response was cached, 0 or undefined otherwise"""


# For backward compatibility and flexibility, we also define a more open Metrics type
# that allows any string key with numeric values
class Metrics(StandardMetrics, total=False):
    """
    Metrics tracked by Braintrust for LLM operations and spans.
    All fields are optional to maintain flexibility.
    Supports standard metrics plus any custom numeric metrics.

    Example:
        metrics: Metrics = {
            # Token metrics
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "tokens": 150,

            # Timing metrics
            "time_to_first_token": 0.5,

            # Custom metrics
            "custom_score": 0.95,
            "user_satisfaction": 4.5
        }
    """

    # This is a TypedDict, so we can't directly add arbitrary keys
    # In practice, users can still add custom metrics at runtime
    # This serves as documentation of the standard fields
