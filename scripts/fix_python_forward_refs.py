#!/usr/bin/env python3
"""
Post-processes generated TypedDict file to fix forward reference issues.

This script wraps TypeAlias assignments in string quotes to enable forward references.
"""
import re
import sys


def fix_forward_refs(content: str) -> str:
    """Fix forward references in TypeAlias assignments and TypedDict definitions."""

    # Pattern to match TypeAlias assignments
    # Example: Expr = (
    #     LiteralModel
    #     | IntervalLiteral
    #     | ...
    # )

    lines = content.split('\n')
    result = []
    in_typealias = False
    in_typeddict = False
    typealias_name = None
    typealias_value = []

    for i, line in enumerate(lines):
        # Add TypeAlias to imports if not present
        if line.startswith('from typing import ') and 'TypeAlias' not in line:
            imports = line.replace('from typing import ', '').split(', ')
            if 'TypeAlias' not in imports:
                imports.insert(0, 'TypeAlias')
                result.append(f"from typing import {', '.join(imports)}")
                continue

        # Check if this is a TypeAlias assignment (simple heuristic)
        # Look for lines like: Expr = (...
        # or: ArrayLiteral: TypeAlias = ...
        if re.match(r'^[A-Z][a-zA-Z0-9]*\s*[:=]', line):
            # Check if it looks like a type alias (starts with uppercase, has = or :)
            if ': TypeAlias = ' in line and '"' not in line.split('=', 1)[1]:
                # Already has TypeAlias annotation, needs string quote
                name, value = line.split(': TypeAlias = ', 1)
                result.append(f'{name}: TypeAlias = "{value.strip()}"')
                continue
            elif ' = (' in line and not line.strip().startswith('class '):
                # Start of a multi-line type union
                in_typealias = True
                typealias_name = line.split('=')[0].strip()
                typealias_value = []
                continue
            elif ' = list[' in line or ' = dict[' in line:
                # Simple type alias like: ArrayLiteral = list[LiteralValue]
                name, value = line.split(' = ', 1)
                result.append(f'{name}: TypeAlias = "{value.strip()}"')
                continue

        # Check if we're entering a TypedDict definition
        if ' = TypedDict(' in line:
            in_typeddict = True
            # Rename Model to ParsedQuery (datamodel-codegen default name)
            if line.startswith('Model = TypedDict('):
                line = line.replace('Model = TypedDict(', 'ParsedQuery = TypedDict(', 1)
                line = line.replace("'Model',", "'ParsedQuery',", 1)
            result.append(line)
            continue

        # Handle TypedDict field definitions with forward references
        if in_typeddict and "'" in line and ':' in line and 'NotRequired[' in line:
            # This is a TypedDict field like: 'dimensions': NotRequired[list[AliasExpr] | None],
            # We need to quote the type annotation to make it a forward reference
            match = re.match(r"(\s*)'([^']+)':\s*NotRequired\[(.*)\],?\s*$", line)
            if match:
                indent, field_name, type_annotation = match.groups()
                # Quote the type annotation
                result.append(f"{indent}'{field_name}': NotRequired['{type_annotation}'],")
                continue

        # Check if we're exiting a TypedDict definition
        if in_typeddict and line.strip() == ')':
            in_typeddict = False
            result.append(line)
            continue

        if in_typealias:
            if line.strip() == ')':
                # End of multi-line type union
                # Reconstruct as a string-based TypeAlias
                union_str = ' | '.join(v.strip() for v in typealias_value if v.strip())
                result.append(f'{typealias_name}: TypeAlias = "{union_str}"')
                result.append('')
                in_typealias = False
                typealias_name = None
                typealias_value = []
                continue
            else:
                # Collect union members
                stripped = line.strip()
                if stripped and stripped != '|':
                    # Remove leading/trailing |
                    cleaned = stripped.strip('|').strip()
                    if cleaned:
                        typealias_value.append(cleaned)
                continue

        result.append(line)

    return '\n'.join(result)


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <file_path>")
        sys.exit(1)

    file_path = sys.argv[1]

    with open(file_path, 'r') as f:
        content = f.read()

    fixed_content = fix_forward_refs(content)

    with open(file_path, 'w') as f:
        f.write(fixed_content)

    print(f"✓ Fixed forward references in {file_path}")


if __name__ == '__main__':
    main()
