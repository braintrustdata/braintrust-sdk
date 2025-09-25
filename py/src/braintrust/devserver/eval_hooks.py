"""
Evaluation hooks and progress reporting for the dev server.

Similar to the JavaScript implementation, this provides callbacks
for reporting progress during evaluation execution.
"""

import asyncio
import json
from typing import Any, Callable, Dict, Optional


class EvalHooks:
    """Hooks provided to eval tasks for progress reporting."""

    def __init__(
        self,
        report_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
        parameters: Optional[Dict[str, Any]] = None,
    ):
        self._report_progress = report_progress
        self.parameters = parameters or {}

    def report_progress(self, event: Dict[str, Any]) -> None:
        """Report progress during task execution."""
        if self._report_progress:
            self._report_progress(event)


def serialize_sse_event(event: str, data: Any) -> str:
    """
    Serialize data into SSE format.

    This follows the same format as the SSEClient expects to parse.
    """
    if isinstance(data, dict) or isinstance(data, list):
        data_str = json.dumps(data)
    else:
        data_str = str(data)

    return f"event: {event}\ndata: {data_str}\n\n"


class SSEQueue:
    """Simple wrapper around asyncio.Queue for SSE events."""

    def __init__(self):
        self.queue: asyncio.Queue[Optional[str]] = asyncio.Queue()

    async def put_event(self, event: str, data: Any) -> None:
        """Add an SSE event to the queue."""
        sse_data = serialize_sse_event(event, data)
        await self.queue.put(sse_data)

    async def close(self) -> None:
        """Signal end of stream."""
        await self.queue.put(None)

    async def get(self) -> Optional[str]:
        """Get the next event from the queue."""
        return await self.queue.get()
