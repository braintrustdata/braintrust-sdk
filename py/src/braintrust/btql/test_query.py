import pytest

from .query import Query


class TestFromString:
    def test_creates_query_from_simple_string(self):
        query = Query.from_string("from: project_logs('test')")
        assert query is not None
        assert query._raw_query == "from: project_logs('test')"

    def test_creates_query_from_complex_string(self):
        raw_query = """from: project_logs('test')
select: id, input, output
filter: is_root = true
limit: 10"""
        query = Query.from_string(raw_query)
        assert query._raw_query == raw_query

    def test_cannot_convert_string_query_to_internal_btql(self):
        query = Query.from_string("from: project_logs('test')")
        with pytest.raises(ValueError, match="Cannot convert raw BTQL string queries"):
            query.to_internal_btql()


class TestFromObject:
    def test_creates_query_from_simple_dict(self):
        query_obj = {
            "select": [{"expr": {"btql": "id"}, "alias": "id"}],
            "limit": 100
        }
        query = Query.from_object(query_obj)
        assert query is not None
        assert query._query_obj == query_obj

    def test_creates_query_with_from_clause(self):
        query_obj = {
            "from": {
                "op": "function",
                "name": {"op": "ident", "name": ["project_logs"]},
                "args": [{"op": "literal", "value": "project-123"}]
            },
            "select": [{"expr": {"btql": "id"}, "alias": "id"}]
        }
        query = Query.from_object(query_obj)
        assert query._query_obj == query_obj

    def test_creates_query_with_filter(self):
        query_obj = {
            "filter": {"btql": "is_root = true"},
            "limit": 10
        }
        query = Query.from_object(query_obj)
        assert query._query_obj == query_obj

    def test_creates_query_with_dimensions_and_measures(self):
        query_obj = {
            "dimensions": [
                {"expr": {"btql": "metadata.model"}, "alias": "model"}
            ],
            "measures": [
                {"expr": {"btql": "count(1)"}, "alias": "total"}
            ]
        }
        query = Query.from_object(query_obj)
        assert query._query_obj == query_obj

    def test_creates_query_with_all_optional_fields(self):
        query_obj = {
            "select": [{"expr": {"btql": "id"}, "alias": "id"}],
            "filter": {"btql": "is_root = true"},
            "sort": [{"expr": {"btql": "created"}, "dir": "desc"}],
            "limit": 50,
            "cursor": "test-cursor",
            "sample": {
                "method": {"type": "rate", "value": 0.25},
                "seed": 42
            },
            "preview_length": 1024
        }
        query = Query.from_object(query_obj)
        assert query._query_obj == query_obj

    def test_to_internal_btql_returns_dict(self):
        query_obj = {
            "select": [{"expr": {"btql": "id"}, "alias": "id"}],
            "limit": 100
        }
        query = Query.from_object(query_obj)
        result = query.to_internal_btql()
        assert result == query_obj

    def test_allows_empty_dict(self):
        query = Query.from_object({})
        assert query._query_obj == {}


class TestQueryExecution:
    def test_execute_raises_on_no_query(self):
        query = Query()
        with pytest.raises(ValueError, match="No query specified"):
            query.execute()
