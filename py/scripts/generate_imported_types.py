#!/usr/bin/env python3

import json
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OPENAPI_SPEC_PATH = os.path.join(SCRIPT_DIR, "../../imported_types.json")


def generate_internal_types():
    internal_types_output_path = os.path.join(SCRIPT_DIR, "../src/braintrust/_imported_types.py")
    subprocess.run(
        [
            "datamodel-codegen",
            "--input",
            OPENAPI_SPEC_PATH,
            "--input-file-type",
            "openapi",
            "--output",
            internal_types_output_path,
            "--output-model-type",
            "typing.TypedDict",
            "--target-python-version",
            "3.9",
            "--custom-file-header",
            '''"""
Do not import this file directly. See `imported_types.py` for the classes that have a stable API.

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


def get_public_typenames() -> list[str]:
    with open(OPENAPI_SPEC_PATH, "r") as f:
        data = json.load(f)
    ret = list(data["components"]["schemas"].keys())
    ret.sort()
    return ret


def generate_public_types():
    public_types_output_path = os.path.join(SCRIPT_DIR, "../src/braintrust/imported_types.py")
    public_typenames = get_public_typenames()
    with open(public_types_output_path, "w") as f:
        f.write(
            '''"""Re-exports generated typespecs that are considered public API."""

from ._imported_types import ('''
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
