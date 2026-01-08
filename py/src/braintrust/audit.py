"""
Utilities for working with audit headers.
"""

import base64
import gzip
import json
from typing import TypedDict


class AuditResource(TypedDict):
    type: str
    id: str
    name: str


def parse_audit_resources(hdr: str) -> list[AuditResource]:
    j = json.loads(hdr)
    if j["v"] == 1:
        return json.loads(gzip.decompress(base64.b64decode(j["p"])))
    else:
        raise ValueError(f"Unsupported audit resources protocol version: {j['v']}")
