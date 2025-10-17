#!/usr/bin/env python3
"""Generate TypeScript type definitions for BTQL from JSON Schema."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "js" / "btql_schema.json"
OUTPUT_PATH = REPO_ROOT / "js" / "src" / "btql" / "btql-types.ts"

NAME_OVERRIDES = {
    "function": "FunctionExpr",
}

PRIMITIVE_TYPE_MAP = {
    "string": "string",
    "number": "number",
    "integer": "number",
    "boolean": "boolean",
    "null": "null",
}


def to_pascal_case(name: str) -> str:
    if name in NAME_OVERRIDES:
        return NAME_OVERRIDES[name]
    if "_" in name or "-" in name:
        parts = re.split(r"[_-]+", name)
        return "".join(part.capitalize() for part in parts if part)
    if not name:
        return name
    return name[0].upper() + name[1:]


def ts_literal(value: Any) -> str:
    if isinstance(value, str):
        return json.dumps(value)
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def collect_refs(schema: Dict[str, Any]) -> Iterable[str]:
    if "$ref" in schema:
        yield schema["$ref"]
    for key in ("anyOf", "allOf", "oneOf"):
        if key in schema:
            for item in schema[key]:
                yield from collect_refs(item)
    if schema.get("type") == "array":
        items = schema.get("items")
        if isinstance(items, list):
            for sub in items:
                yield from collect_refs(sub)
        elif isinstance(items, dict):
            yield from collect_refs(items)
        additional = schema.get("additionalItems")
        if isinstance(additional, dict):
            yield from collect_refs(additional)
    if schema.get("type") == "object":
        for prop in schema.get("properties", {}).values():
            yield from collect_refs(prop)
        additional = schema.get("additionalProperties")
        if isinstance(additional, dict):
            yield from collect_refs(additional)


def schema_to_ts(
    schema: Dict[str, Any],
    name_map: Dict[str, str],
    indent_level: int = 0,
) -> str:
    if "$ref" in schema:
        ref = schema["$ref"].split("/")[-1]
        return name_map.get(ref, to_pascal_case(ref))

    for composite in ("anyOf", "oneOf", "allOf"):
        if composite in schema:
            parts = [schema_to_ts(sub, name_map, indent_level) for sub in schema[composite]]
            unique_parts = []
            for part in parts:
                if part not in unique_parts:
                    unique_parts.append(part)
            joiner = " & " if composite == "allOf" else " | "
            return joiner.join(unique_parts) or "never"

    if "enum" in schema:
        enum_values = [ts_literal(v) for v in schema["enum"]]
        return " | ".join(enum_values) or "never"

    if "const" in schema:
        return ts_literal(schema["const"])

    schema_type = schema.get("type")

    if isinstance(schema_type, list):
        mapped = []
        for t in schema_type:
            ts = PRIMITIVE_TYPE_MAP.get(t)
            if ts:
                mapped.append(ts)
        return " | ".join(sorted(set(mapped))) or "unknown"

    if schema_type == "object" or (schema_type is None and "properties" in schema):
        return render_object(schema, name_map, indent_level)

    if schema_type == "array":
        items = schema.get("items")
        if isinstance(items, list):
            parts = [schema_to_ts(item, name_map, indent_level) for item in items]
            additional = schema.get("additionalItems")
            if isinstance(additional, dict):
                parts.append(schema_to_ts(additional, name_map, indent_level))
            return "[" + ", ".join(parts) + "]"
        element = schema_to_ts(items or {"type": "unknown"}, name_map, indent_level)
        return f"Array<{element}>"

    if schema_type in PRIMITIVE_TYPE_MAP:
        return PRIMITIVE_TYPE_MAP[schema_type]

    return "unknown"


def render_object(
    schema: Dict[str, Any],
    name_map: Dict[str, str],
    indent_level: int,
) -> str:
    props = schema.get("properties", {})
    required = set(schema.get("required") or [])
    lines: List[str] = ["{"]
    for key, value in props.items():
        optional = "" if key in required else "?"
        ts_type = schema_to_ts(value, name_map, indent_level + 1)
        lines.append(f"{key}{optional}: {ts_type};")
    additional = schema.get("additionalProperties")
    if additional:
        if additional is True:
            lines.append("[key: string]: unknown;")
        elif isinstance(additional, dict):
            addl_type = schema_to_ts(additional, name_map, indent_level + 1)
            lines.append(f"[key: string]: {addl_type};")
    closing_indent = "  " * indent_level
    inner = "\n".join(("  " * (indent_level + 1)) + line for line in lines[1:])
    if inner:
        inner = "\n" + inner + "\n"
    return f"{{{inner}{closing_indent}}}"


def generate_types(definitions: Dict[str, Any], root_schema: Dict[str, Any]) -> str:
    name_map = {name: to_pascal_case(name) for name in definitions}
    name_map.update(NAME_OVERRIDES)

    lines: List[str] = [
        "// Generated by sdk/scripts/build_btql_types.py. DO NOT EDIT.",
        "",
    ]

    for name, schema in definitions.items():
        ts_name = name_map[name]
        ts_type = schema_to_ts(schema, name_map)
        lines.append(f"export type {ts_name} = {ts_type};")
        lines.append("")

    parsed_query_type = schema_to_ts(root_schema, name_map)
    lines.append(f"export type ParsedQuery = {parsed_query_type};")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    schema = json.loads(SCHEMA_PATH.read_text())
    definitions = schema.get("definitions", {})
    content = generate_types(definitions, schema)
    OUTPUT_PATH.write_text(content + "\n")


if __name__ == "__main__":
    main()
