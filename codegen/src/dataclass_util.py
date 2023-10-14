import dataclasses
from typing import Any, Optional, Tuple

from format import *
from globals import get_lang


def genfield(doc_fmt: DocFmt, py_custom_argspec=None, ts_custom_argspec=None) -> dataclasses.Field:
    metadata = dict(
        doc=doc_fmt,
        py_custom_argspec=py_custom_argspec,
        ts_custom_argspec=ts_custom_argspec,
    )
    return dataclasses.field(metadata=metadata)


def dataclass_docstring(d: Any, arg_prefix=[]) -> List[str]:
    assert dataclasses.is_dataclass(d)

    out = []
    fields = dataclasses.fields(d)
    for f in fields:
        arg_ident = ident(f.name)
        docstr = f.metadata.get("doc", DocFmt("")).format()
        out.append(paramline(arg_ident, docstr))
        if dataclasses.is_dataclass(f.type):
            out.extend(dataclass_docstring(f.type, arg_prefix=arg_prefix + [arg_ident]))

    return out


def full_docstring(
    toplevel_fmt: Optional[DocFmt], args_d: Optional[Any], return_fmt: Optional[DocFmt], num_tabs=0
) -> str:
    assert dataclasses.is_dataclass(args_d)

    outlines = []
    if toplevel_fmt is not None:
        outlines += toplevel_fmt.format().split("\n")
    if args_d is not None:
        outlines += dataclass_docstring(args_d, arg_prefix=[])
    if return_fmt is not None:
        outlines += retline(return_fmt.format()).split("\n")

    return docstring(outlines, num_tabs=num_tabs)


def dataclass_argspec(args_d: Any):
    assert dataclasses.is_dataclass(args_d)

    out = []
    for field in dataclasses.fields(args_d):
        custom_argspec = field.metadata.get(f"{get_lang()}_custom_argspec")
        if custom_argspec is not None:
            out.append(ident(field.name) + custom_argspec)
        else:
            out.append(argspec(field.name, field.type))
    return ", ".join(out)
