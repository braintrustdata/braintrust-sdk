import threading
from collections import deque
from typing import Any, List, Optional, TypeVar

T = TypeVar("T")


class LogQueue:
    """A queue that drops oldest items when full."""

    def __init__(self, maxsize: int = 0):
        """
        Initialize the LogQueue.

        Args:
            maxsize: Maximum size of the queue. 0 or less than 1 means unlimited.
        """
        self.maxsize = maxsize
        self._maxlen = None if maxsize < 1 else maxsize
        self._mutex = threading.Lock()
        self._queue: deque[T] = deque(maxlen=self._maxlen)
        self._semaphore = threading.Semaphore(value=0)
        self._total_dropped = 0

    def put(self, item: T) -> List[T]:
        """
        Put an item in the queue.

        Args:
            item: The item to add to the queue.

        Returns:
            List of items that were dropped (empty if no items were dropped).
        """
        with self._mutex:
            dropped = []

            # If queue is at max capacity, popleft before appending
            if self._maxlen is not None and len(self._queue) == self._maxlen:
                dropped_item = self._queue.popleft()
                dropped.append(dropped_item)
                self._total_dropped += 1

            self._queue.append(item)

        # Signal that items are available
        self._semaphore.release()
        return dropped

    def drain_all(self) -> List[T]:
        """
        Drain all items from the queue.

        Returns:
            List of all items that were in the queue.
        """
        old_queue = None
        with self._mutex:
            if len(self._queue) == 0:
                return []

            old_queue = self._queue
            self._queue = deque(maxlen=self._maxlen)

        return list(old_queue) if old_queue else []

    def size(self) -> int:
        """
        Get the current size of the queue.

        Returns:
            Number of items currently in the queue.
        """
        return len(self._queue)

    def wait_for_items(self, timeout: Optional[float] = None) -> bool:
        """
        Wait for items to be available in the queue.

        Args:
            timeout: Maximum time to wait in seconds. None means wait forever.

        Returns:
            True if items became available, False if timeout occurred.
        """
        return self._semaphore.acquire(timeout=timeout)
