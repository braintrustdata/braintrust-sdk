import dataclasses
from typing import Any, Optional, Tuple

from format import *


def genfield(doc_fmt: DocFmt, custom_argspecs=None) -> dataclasses.Field:
    metadata = dict(
        doc=doc_fmt,
        custom_argspecs=custom_argspecs,
    )
    return dataclasses.field(metadata=metadata)


def dataclass_docstring(lang: str, d: Any, arg_prefix=None) -> List[str]:
    assert dataclasses.is_dataclass(d)

    if arg_prefix is None:
        arg_prefix = []

    out = []
    fields = dataclasses.fields(d)
    for f in fields:
        arg_ident = ident(lang, f.name)
        docstr = f.metadata.get("doc", DocFmt("")).format()
        out.append(paramline(lang, arg_ident, docstr))
        if dataclasses.is_dataclass(f.type):
            out.extend(dataclass_docstring(lang, f.type, arg_prefix=arg_prefix + [arg_ident]))
    return out


def full_docstring(
    lang: str,
    toplevel_fmt: Optional[DocFmt],
    args_d: Optional[Any],
    return_fmt: Optional[DocFmt],
) -> str:
    assert dataclasses.is_dataclass(args_d)

    outlines = []
    if toplevel_fmt is not None:
        outlines += toplevel_fmt.format().split("\n")
    if args_d is not None:
        outlines += dataclass_docstring(lang, args_d)
    if return_fmt is not None:
        outlines += retline(lang, return_fmt.format()).split("\n")

    return docstring(lang, outlines)


def dataclass_argspecs(lang: str, args_d: Any):
    assert dataclasses.is_dataclass(args_d)

    out = []
    for field in dataclasses.fields(args_d):
        custom_argspecs = field.metadata.get("custom_argspecs")
        if custom_argspecs is not None and lang in custom_argspecs:
            out.append(ident(lang, field.name) + custom_argspecs[lang])
        else:
            out.append(argspec(lang, field.name, field.type))
    return out
