import sys
from functools import cached_property

import boto3


class LazyClient:
    def __init__(self, client_name):
        self.client_name = client_name
        self.client = None

    def __getattr__(self, name):
        if self.client is None:
            self.client = boto3.client(self.client_name)
        return getattr(self.client, name)


def __getattr__(name: str):
    return LazyClient(name.replace("_", "-"))
