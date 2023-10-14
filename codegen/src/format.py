"""Utilities for dealing with identifier formatting in different languages"""

import dataclasses
import typing
from typing import List

from globals import get_lang


def escape(s: str) -> str:
    return "`" + s + "`"


def indent(block: str, num_tabs: int) -> str:
    return "\n".join(("    " * num_tabs) + line for line in block.split("\n"))


def ts_ident(s: str) -> str:
    words = s.split("_")

    return "".join([words[0]] + [w.title() for w in words[1:]])


def py_ident(s: str) -> str:
    return s


def ident(s: str) -> str:
    LANG_IDENT = dict(py=py_ident, ts=ts_ident)
    return LANG_IDENT[get_lang()](s)


class DocFmt:
    def __init__(self, format_str, *ident_args):
        self.format_str = format_str
        self.ident_args = ident_args

    def format(self, do_escape=True) -> str:
        ident_args = [ident(s) for s in self.ident_args]
        if do_escape:
            ident_args = [escape(s) for s in ident_args]
        return self.format_str.format(*ident_args)


def py_paramline(argname: str, description: str) -> str:
    return f":param {argname}: {description}"


def ts_paramline(argname: str, description: str) -> str:
    return f"@param {argname} {description}"


def paramline(argname: str, description: str) -> str:
    LANG_PARAMLINE = dict(py=py_paramline, ts=ts_paramline)
    return LANG_PARAMLINE[get_lang()](argname, description)


def py_retline(description: str) -> str:
    return f":returns: {description}"


def ts_retline(description: str) -> str:
    return f"@returns {description}"


def retline(description: str) -> str:
    LANG_RETLINE = dict(py=py_retline, ts=ts_retline)
    return LANG_RETLINE[get_lang()](description)


def py_docstring(lines: List[str], num_tabs: int) -> str:
    return indent("\n".join(['"""'] + lines + ['"""']), num_tabs)


def ts_docstring(lines: List[str], num_tabs: int) -> str:
    prefixed_lines = [" * " + l for l in lines]
    return indent("\n".join(["/**"] + prefixed_lines + [" */"]), num_tabs)


def docstring(lines: List[str], num_tabs: int = 0) -> str:
    LANG_DOCSTRING = dict(py=py_docstring, ts=ts_docstring)
    return LANG_DOCSTRING[get_lang()](lines, num_tabs)


SCALAR_TYPES_TO_PY_STR = {
    int: "int",
    float: "float",
    str: "str",
    bool: "bool",
    typing.Any: "Any",
}

SCALAR_TYPES_TO_JS_STR = {
    int: "number",
    float: "number",
    str: "string",
    bool: "boolean",
    typing.Any: "unknown",
}


def is_optional_type(pytype) -> bool:
    origin = typing.get_origin(pytype)
    if origin != typing.Union:
        return False
    args = typing.get_args(pytype)
    if len(args) != 2:
        return False
    return type(None) in args


def get_optional_underlying(pytype):
    assert is_optional_type(pytype)
    return [x for x in typing.get_args(pytype) if x != type(None)][0]


def is_dict_type(pytype) -> bool:
    return typing.get_origin(pytype) == dict


def py_typespec(pytype) -> str:
    if is_optional_type(pytype):
        return f"Optional[{py_typespec(get_optional_underlying(pytype))}]"
    elif is_dict_type(pytype):
        ktype, vtype = typing.get_args(pytype)
        return f"Dict[{py_typespec(ktype)}, {py_typespec(vtype)}]"
    elif dataclasses.is_dataclass(pytype):
        return f"{pytype.__name__}"
    else:
        return SCALAR_TYPES_TO_PY_STR[pytype]


def py_argspec(argname: str, pytype) -> str:
    typespec = py_typespec(pytype)
    ret = f"{py_ident(argname)}: {typespec}"
    if is_optional_type(pytype):
        ret += " = None"
    return ret


def ts_typespec(pytype) -> str:
    if is_optional_type(pytype):
        return f"{ts_typespec(get_optional_underlying(pytype))} | undefined"
    elif is_dict_type(pytype):
        ktype, vtype = typing.get_args(pytype)
        return f"Record<{ts_typespec(ktype)}, {ts_typespec(vtype)}>"
    elif dataclasses.is_dataclass(pytype):
        fields = dataclasses.fields(pytype)
        obj_args = [ts_argspec(f.name, f.type) for f in fields]
        return f"{{ {'; '.join(obj_args)} }}"
    else:
        return SCALAR_TYPES_TO_JS_STR[pytype]


def ts_argspec(argname: str, pytype) -> str:
    typespec = ts_typespec(pytype)
    ret = f"{ts_ident(argname)}"
    if is_optional_type(pytype):
        ret += "?:"
    else:
        ret += ":"
    ret += f" {typespec}"
    return ret


def typespec(pytype) -> str:
    LANG_TYPESPEC = dict(py=py_typespec, ts=ts_typespec)
    return LANG_TYPESPEC[get_lang()](pytype)


def argspec(argname: str, pytype) -> str:
    LANG_ARGSPEC = dict(py=py_argspec, ts=ts_argspec)
    return LANG_ARGSPEC[get_lang()](argname, pytype)
