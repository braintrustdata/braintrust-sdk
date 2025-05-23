import queue
import threading
from typing import Any, List, Optional, TypeVar

T = TypeVar("T")


class LogQueue:
    """A queue that can drop oldest items when full, with semaphore signaling."""

    def __init__(self, maxsize: int = 0, drop_when_full: bool = False):
        """
        Initialize the LogQueue.

        Args:
            maxsize: Maximum size of the queue. 0 means unlimited.
            drop_when_full: If True, drop oldest items when queue is full.
                           If False, block on put when queue is full.
        """
        self.maxsize = maxsize
        self.drop_when_full = drop_when_full
        self._queue: "queue.Queue[T]" = queue.Queue(maxsize=maxsize)
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
        dropped = []
        if not self.drop_when_full:
            self._queue.put(item)
            self._semaphore.release()
            return dropped

        try:
            self._queue.put_nowait(item)
        except queue.Full:
            # Drop the oldest item and add the new one
            try:
                dropped_item = self._queue.get_nowait()
                dropped.append(dropped_item)
                self._total_dropped += 1
                self._queue.put_nowait(item)
            except queue.Empty:
                # Queue became empty somehow, just add the item
                self._queue.put_nowait(item)

        # Signal that items are available
        self._semaphore.release()
        return dropped

    def drain_all(self) -> List[T]:
        """
        Drain all items from the queue.

        Returns:
            List of all items that were in the queue.
        """
        items = []
        try:
            while True:
                items.append(self._queue.get_nowait())
        except queue.Empty:
            pass

        return items

    def size(self) -> int:
        """
        Get the current size of the queue.

        Returns:
            Number of items currently in the queue.
        """
        return self._queue.qsize()

    def wait_for_items(self, timeout: Optional[float] = None) -> bool:
        """
        Wait for items to be available in the queue.

        Args:
            timeout: Maximum time to wait in seconds. None means wait forever.

        Returns:
            True if items became available, False if timeout occurred.
        """
        return self._semaphore.acquire(timeout=timeout)
