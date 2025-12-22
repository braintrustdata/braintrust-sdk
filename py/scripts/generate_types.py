#!/usr/bin/env python3

import json
import os
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OPENAPI_SPEC_PATH = os.path.join(SCRIPT_DIR, "../../generated_types.json")
INTERNAL_TYPES_OUTPUT_PATH = os.path.join(SCRIPT_DIR, "../src/braintrust/_generated_types.py")


def generate_internal_types():
    subprocess.run(
        [
            "datamodel-codegen",
            "--input",
            OPENAPI_SPEC_PATH,
            "--input-file-type",
            "openapi",
            "--output",
            INTERNAL_TYPES_OUTPUT_PATH,
            "--output-model-type",
            "typing.TypedDict",
            "--target-python-version",
            "3.10",
            "--custom-file-header",
            '''"""
Do not import this file directly. See `generated_types.py` for the classes that have a stable API.

Auto-generated file -- do not modify.
"""''',
            "--special-field-name-prefix",
            "",
            "--enum-field-as-literal",
            "all",
            "--capitalize-enum-members",
            "--use-generic-container-types",
            "--use-field-description",
            "--strict-nullable",
            "--parent-scoped-naming",
        ],
        stdout=sys.stderr,
        check=True,
    )
    cleanup_internal_types()


def cleanup_internal_types():
    with open(INTERNAL_TYPES_OUTPUT_PATH, "r") as f:
        contents = f.read()

    # Replace `NotRequired[...]` with `NotRequired[Optional[...]]` for Python
    # TypedDict definitions.
    #
    # Note that this weakens optional-but-not-nullable OpenAPI types into
    # optional-and-nullable TypedDicts. But this seems better than having
    # optional-and-nullable OpenAPI types converted into
    # optional-but-not-nullable TypedDicts.
    # nullable attribute of certain types.
    contents = re.sub(r"(\s[A-Za-z0-9_]+: NotRequired\[)(?!Optional\[\s*)(.+)(\]\n)", r"\1Optional[\2]\3", contents)

    # Replace `schema_` with `schema`; this happens because datamodel-codegen
    # treats `schema` specially, expecting Pydantic.
    contents = re.sub(r"(\s+)schema_:", r"\1schema:", contents)

    # Discourage direct imports.
    contents += "\n__all__ = []"

    with open(INTERNAL_TYPES_OUTPUT_PATH, "w") as f:
        f.write(contents)


def get_public_typenames() -> list[str]:
    with open(OPENAPI_SPEC_PATH, "r") as f:
        data = json.load(f)
    ret = list(data["components"]["schemas"].keys())
    ret.sort()
    return ret


def generate_public_types():
    public_types_output_path = os.path.join(SCRIPT_DIR, "../src/braintrust/generated_types.py")
    public_typenames = get_public_typenames()

    with open(OPENAPI_SPEC_PATH, "r") as f:
        openapi_spec = json.load(f)
    internal_git_sha = openapi_spec.get("info", {}).get("x-internal-git-sha", "unknown")

    with open(public_types_output_path, "w") as f:
        f.write(
            f'''"""Auto-generated file (internal git SHA {internal_git_sha}) -- do not modify"""

from ._generated_types import ('''
        )
        for typename in public_typenames:
            f.write(f"\n    {typename},")
        f.write("\n)")

        f.write(
            """

__all__ = ["""
        )
        for typename in public_typenames:
            f.write(f'\n    "{typename}",')
        f.write("\n]")


if __name__ == "__main__":
    generate_internal_types()
    generate_public_types()
