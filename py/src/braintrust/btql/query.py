import os
from typing import Any, Dict, Generic, List, Optional, TypeVar, Union

try:
    import requests
except ImportError:
    requests = None

from .btql_types import ParsedQuery

T = TypeVar('T')


class BTQLQueryResult(Generic[T]):
    def __init__(self, data: Optional[List[T]] = None):
        self.data: List[T] = data or []


class Query(Generic[T]):
    def __init__(
        self,
        query_obj: Optional[Dict[str, Any]] = None,
        raw_query: Optional[str] = None,
        api_key: Optional[str] = None,
        api_url: Optional[str] = None
    ):
        self._query_obj = query_obj
        self._raw_query = raw_query
        self._api_key = api_key
        self._api_url = api_url

    @classmethod
    def from_object(
        cls,
        query: Union[Dict[str, Any], ParsedQuery],
        api_key: Optional[str] = None,
        api_url: Optional[str] = None
    ) -> 'Query[Dict[str, Any]]':
        # TypedDict is just for type hints, treat as dict
        query_dict = dict(query) if not isinstance(query, dict) else query
        instance = cls(query_obj=query_dict, api_key=api_key, api_url=api_url)
        return instance

    @classmethod
    def from_string(
        cls,
        query: str,
        api_key: Optional[str] = None,
        api_url: Optional[str] = None
    ) -> 'Query[Dict[str, Any]]':
        instance = cls(raw_query=query, api_key=api_key, api_url=api_url)
        return instance

    def to_internal_btql(self) -> Dict[str, Any]:
        if self._raw_query:
            raise ValueError("Cannot convert raw BTQL string queries to internal BTQL structure")
        if self._query_obj:
            return self._query_obj
        raise ValueError("No query specified")

    def execute(self) -> BTQLQueryResult[T]:
        if requests is None:
            raise ImportError(
                "requests is required to use BTQL queries. "
                "Install it with: pip install requests"
            )

        base_url = self._api_url or os.environ.get('BRAINTRUST_API_URL', 'https://api.braintrust.dev')
        auth_key = self._api_key or os.environ.get('BRAINTRUST_API_KEY')

        if not auth_key:
            raise ValueError('BRAINTRUST_API_KEY is required to query BTQL')

        if self._raw_query:
            query_payload = self._raw_query
        elif self._query_obj:
            query_payload = self._query_obj
        else:
            raise ValueError("No query specified")

        response = requests.post(
            f'{base_url}/btql',
            headers={
                'Authorization': f'Bearer {auth_key}',
                'Content-Type': 'application/json',
            },
            json={'query': query_payload}
        )

        if not response.ok:
            raise Exception(f'BTQL query failed: {response.status_code} {response.text}')

        data = response.json()
        return BTQLQueryResult(data=data.get('data', []))
