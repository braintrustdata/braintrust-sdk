"""
Utilities for working with audit headers.
"""
import base64
import gzip
import json
from typing import List, TypedDict


class AuditResource(TypedDict):
    type: str
    id: str
    name: str


def parse_audit_resources(marshaled: str) -> List[AuditResource]:
    return json.loads(gzip.decompress(base64.b64decode(marshaled)))
