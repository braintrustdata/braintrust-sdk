"""Utilities for dealing with identifier formatting in different languages"""

import dataclasses
import typing
from typing import List

PY_LANG = "py"
TS_LANG = "ts"


def escape(s: str) -> str:
    return "`" + s + "`"


def indent(block: str, num_tabs: int) -> str:
    return "\n".join(("    " * num_tabs) + line for line in block.split("\n"))


def ident(lang: str, s: str) -> str:
    def ts(s):
        words = s.split("_")
        return "".join([words[0]] + [w.title() for w in words[1:]])

    def py(s):
        return s

    SWITCH = {PY_LANG: py, TS_LANG: ts}
    return SWITCH[lang](s)


class DocFmt:
    def __init__(self, format_str, *ident_args):
        self.format_str = format_str
        self.ident_args = ident_args

    def format(self, do_escape=True) -> str:
        ident_args = [ident(s) for s in self.ident_args]
        if do_escape:
            ident_args = [escape(s) for s in ident_args]
        return self.format_str.format(*ident_args)


def paramline(lang: str, argname: str, description: str) -> str:
    def py(argname, description):
        return f":param {argname}: {description}"

    def ts(argname, description):
        return f"@param {argname} {description}"

    SWITCH = {PY_LANG: py, TS_LANG: ts}
    return SWITCH[lang](argname, description)


def retline(lang: str, description: str) -> str:
    def py(description):
        return f":returns: {description}"

    def ts(description):
        return f"@returns {description}"

    SWITCH = {PY_LANG: py, TS_LANG: ts}
    return SWITCH[lang](description)


def docstring(lang: str, lines: List[str]) -> str:
    def py(lines):
        return "\n".join(['"""'] + lines + ['"""'])

    def ts(lines):
        prefixed_lines = [" * " + l for l in lines]
        return "\n".join(["/**"] + prefixed_lines + [" */"])

    SWITCH = {PY_LANG: py, TS_LANG: ts}
    return SWITCH[lang](lines)


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


def typespec(lang: str, pytype) -> str:
    def py(pytype):
        if is_optional_type(pytype):
            return f"Optional[{typespec(lang, get_optional_underlying(pytype))}]"
        elif is_dict_type(pytype):
            ktype, vtype = typing.get_args(pytype)
            return f"Dict[{typespec(lang, ktype)}, {typespec(lang, vtype)}]"
        elif dataclasses.is_dataclass(pytype):
            return f"{pytype.__name__}"
        else:
            return SCALAR_TYPES_TO_PY_STR[pytype]

    def ts(pytype):
        if is_optional_type(pytype):
            return f"{typespec(lang, get_optional_underlying(pytype))} | undefined"
        elif is_dict_type(pytype):
            ktype, vtype = typing.get_args(pytype)
            return f"Record<{typespec(lang, ktype)}, {typespec(lang, vtype)}>"
        elif dataclasses.is_dataclass(pytype):
            fields = dataclasses.fields(pytype)
            obj_args = [argspec(lang, f.name, f.type) for f in fields]
            return f"{{ {'; '.join(obj_args)} }}"
        else:
            return SCALAR_TYPES_TO_JS_STR[pytype]

    SWITCH = {PY_LANG: py, TS_LANG: ts}
    return SWITCH[lang](pytype)


def argspec(lang: str, argname: str, pytype) -> str:
    def py(argname, pytype):
        typespec = typespec(lang, pytype)
        ret = f"{ident(lang, argname)}: {typespec}"
        if is_optional_type(pytype):
            ret += " = None"
        return ret

    def ts(argname, pytype):
        typespec = typespec(lang, pytype)
        ret = f"{ident(lang, argname)}"
        if is_optional_type(pytype):
            ret += "?:"
        else:
            ret += ":"
        ret += f" {typespec}"
        return ret

    SWITCH = {PY_LANG: py, TS_LANG: ts}
    return SWITCH[lang](argname, pytype)
