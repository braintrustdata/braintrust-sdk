"""
BTQL (Braintrust Query Language) type definitions and query builder.

This module provides type-safe query building using TypedDict constructors.
Import types and operators from here to build BTQL queries programmatically.

Example:
    from braintrust.btql import (
        Query,
        ParsedQuery,
        Ident,
        Function,
        AliasExpr,
        ComparisonOp,
    )

    query = ParsedQuery(
        **{
            "from": Function(...),
            "select": [AliasExpr(...)],
            "limit": 10,
        }
    )

    result = Query.from_object(query).execute()
"""

from .btql_types import *  # noqa: F401,F403
from .query import (
    BTQLQueryResult,  # noqa: F401
    Query,  # noqa: F401
)
