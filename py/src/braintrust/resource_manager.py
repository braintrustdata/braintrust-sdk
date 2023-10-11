from contextlib import contextmanager
from threading import RLock


class ResourceManager:
    """A ResourceManager is a simple class to hold onto a shared resource. Local
    chalice is not thread-safe, so accessing shared memory across threads is not
    necessarily safe. But production AWS lambda will guarantee that memory is
    not shared across threads, so this synchronization is unnecessary.

    The ResourceManager controls access to a shared resource, optionally
    applying synchronization when run locally.
    """

    def __init__(self, resource):
        self.lock = RLock()
        self.resource = resource

    @contextmanager
    def get(self):
        with self.lock:
            yield self.resource
