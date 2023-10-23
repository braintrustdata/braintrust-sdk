import argparse
import os
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Union

from classgen import Class, generate_class
from dataclass_util import dataclass_typedef, genfield
from format import DocFmt, Opaque
from functiongen import Constructor, Function, Override, generate_function

DEFAULT_DIR = os.path.join(os.path.dirname(__file__), "scratch-output")


@dataclass
class EmptyArgs:
    ...


@dataclass
class RegisteredProject:
    id: str
    name: str


@dataclass
class DatasetConstructorArgs:
    project: Opaque[RegisteredProject]
    id: str
    name: str
    pinned_version: Optional[str]


@dataclass
class DatasetInsertArgs:
    input: Any = genfield(
        DocFmt("The argument that uniquely define an input case (an arbitrary, JSON serializable object).")
    )
    output: Any = genfield(
        DocFmt("The output of your application, including post-processing (an arbitrary, JSON serializable object).")
    )
    metadata: Optional[Dict[str, Any]] = genfield(
        DocFmt(
            "(Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings."
        )
    )
    id: Optional[str] = genfield(
        DocFmt(
            "(Optional) a unique identifier for the event. If you don't provide one, Braintrust will generate one for you."
        )
    )


dataset_class = Class(
    name="Dataset",
    toplevel_doc=DocFmt(
        """A dataset is a collection of records, such as model inputs and outputs, which represent data you can use to evaluate and fine-tune models. You can log production data to datasets, curate them with interesting examples, edit/delete records, and run evaluations against them.

You should not create `Dataset` objects directly. Instead, use the {} method""",
        "braintrust.init_dataset",
    ),
    constructor=Constructor(toplevel_doc=DocFmt(""), arg_type=DatasetConstructorArgs),
    methods=[
        Function(
            name="insert",
            toplevel_doc=DocFmt(
                "Insert a single record to the dataset. The record will be batched and uploaded behind the scenes. If you pass in an `id`, and a record with that `id` already exists, it will be overwritten (upsert)."
            ),
            arg_type=DatasetInsertArgs,
            return_type=str,
            return_doc=DocFmt("The `id` of the logged record."),
        ),
    ],
)

types = [RegisteredProject, DatasetConstructorArgs, DatasetInsertArgs]
functions = []
classes = [dataset_class]

TS_LOGGER_PREAMBLE = f"""import {{ {",".join(t.__name__ for t in types)} }} from "./types";
import * as impl from "./logger_impl";
"""

PY_LOGGER_PREAMBLE = f"""from .types import *
from . import logger_impl as impl
"""

LOGGER_PREAMBLE = dict(ts=TS_LOGGER_PREAMBLE, py=PY_LOGGER_PREAMBLE)


def main():
    parser = argparse.ArgumentParser(
        prog="SDK code generator",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--py_directory", default=os.path.join(DEFAULT_DIR, "py"), help="Directory to dump the generated python code"
    )
    parser.add_argument(
        "--ts_directory",
        default=os.path.join(DEFAULT_DIR, "ts"),
        help="Directory to dump the generated typescript code",
    )
    args = parser.parse_args()

    for lang, langname, langdir in [("ts", "typescript", args.ts_directory), ("py", "python", args.py_directory)]:
        print(f"Writing {langname} files to {langdir}")
        os.makedirs(langdir, exist_ok=True)
        with open(os.path.join(langdir, f"types.{lang}"), "w") as f:
            for typedef in types:
                f.write(dataclass_typedef(lang, typedef) + "\n")
        with open(os.path.join(langdir, f"logger.{lang}"), "w") as f:
            f.write(LOGGER_PREAMBLE[lang] + "\n")
            for functiondef in functions:
                f.write(generate_function(lang, functiondef) + "\n")
            for classdef in classes:
                f.write(generate_class(lang, classdef) + "\n")
