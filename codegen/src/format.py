"""Utilities for dealing with identifier formatting in different languages"""

import dataclasses
import typing
from typing import Any, Callable, Generic, List, Tuple, TypeVar

_T = TypeVar("_T")


def escape(s: str) -> str:
    return "`" + s + "`"


def indent(block: str, num_tabs: int) -> str:
    return "\n".join(("    " * num_tabs) + line for line in block.split("\n"))


def ident(lang: str, s: str) -> str:
    def ts():
        words = s.split("_")
        return "".join([words[0]] + [w.title() for w in words[1:]])

    def py():
        return s

    return dict(ts=ts, py=py)[lang]()


class DocFmt:
    def __init__(self, format_str: str, *ident_args: str):
        self.format_str = format_str
        self.ident_args = ident_args

    def format(self, lang: str, escape_idents: bool = True) -> str:
        ident_args = [ident(lang, s) for s in self.ident_args]
        if escape_idents:
            ident_args = [escape(s) for s in ident_args]
        return self.format_str.format(*ident_args)


def paramline(lang: str, argname: str, description: str) -> str:
    def ts():
        return f"@param {argname} {description}"

    def py():
        return f":param {argname}: {description}"

    return dict(ts=ts, py=py)[lang]()


def retline(lang: str, description: str) -> str:
    def ts():
        return f"@returns {description}"

    def py():
        return f":returns: {description}"

    return dict(ts=ts, py=py)[lang]()


def docstring(lang: str, lines: List[str]) -> str:
    def ts():
        prefixed_lines = [" * " + l for l in lines]
        return "\n".join(["/**"] + prefixed_lines + [" */"])

    def py():
        return "\n".join(['"""'] + lines + ['"""'])

    return dict(ts=ts, py=py)[lang]()


@dataclasses.dataclass
class Opaque(Generic[_T]):
    ...


SCALAR_TYPES_TO_PY_STR = {
    int: "int",
    float: "float",
    str: "str",
    bool: "bool",
    Any: "Any",
}

SCALAR_TYPES_TO_TS_STR = {
    int: "number",
    float: "number",
    str: "string",
    bool: "boolean",
    Any: "unknown",
}


def _is_opaque_type(pytype) -> bool:
    return typing.get_origin(pytype) == Opaque


def _is_optional_type(pytype) -> bool:
    origin = typing.get_origin(pytype)
    if origin != typing.Union:
        return False
    args = typing.get_args(pytype)
    if len(args) != 2:
        return False
    return type(None) in args


def _get_optional_underlying(pytype):
    assert _is_optional_type(pytype)
    return [x for x in typing.get_args(pytype) if x != type(None)][0]


def _is_dict_type(pytype) -> bool:
    return typing.get_origin(pytype) == dict


def typespec(lang: str, pytype: Any) -> str:
    def ts():
        if _is_opaque_type(pytype):
            return typing.get_args(pytype)[0].__name__
        elif _is_optional_type(pytype):
            return f"{typespec(lang, _get_optional_underlying(pytype))} | undefined"
        elif _is_dict_type(pytype):
            ktype, vtype = typing.get_args(pytype)
            return f"Record<{typespec(lang, ktype)}, {typespec(lang, vtype)}>"
        elif dataclasses.is_dataclass(pytype):
            fields = dataclasses.fields(pytype)
            obj_args = [argspec(lang, f.name, f.type) for f in fields]
            return f"{{ {'; '.join(obj_args)} }}"
        else:
            return SCALAR_TYPES_TO_TS_STR[pytype]

    def py():
        if _is_opaque_type(pytype):
            return typing.get_args(pytype)[0].__name__
        elif _is_optional_type(pytype):
            return f"Optional[{typespec(lang, _get_optional_underlying(pytype))}]"
        elif _is_dict_type(pytype):
            ktype, vtype = typing.get_args(pytype)
            return f"Dict[{typespec(lang, ktype)}, {typespec(lang, vtype)}]"
        elif dataclasses.is_dataclass(pytype):
            return f"Dict[str, Any]"
        else:
            return SCALAR_TYPES_TO_PY_STR[pytype]

    return dict(ts=ts, py=py)[lang]()


def argspec(lang: str, argname: str, pytype: Any) -> str:
    def ts():
        typespec_str = typespec(lang, pytype)
        ret = ident(lang, argname)
        if _is_optional_type(pytype):
            ret += "?: "
        else:
            ret += ": "
        ret += typespec_str
        return ret

    def py():
        typespec_str = typespec(lang, pytype)
        ret = f"{ident(lang, argname)}: {typespec_str}"
        if _is_optional_type(pytype):
            ret += " = None"
        return ret

    return dict(ts=ts, py=py)[lang]()
