import dataclasses
from typing import Any, Optional

from dataclass_util import dataclass_argspec, full_docstring
from format import JS_LANG, PY_LANG, DocFmt, ident, indent, typespec


@dataclasses.dataclass
class FunctionAttributes:
    is_instance_method: bool = False
    is_async: bool = False
    is_generator: bool = False
    py_return_dataclass_as_dict: bool = True


@dataclasses.dataclass
class Function:
    name: str
    name_overrides: Optional[dict[str, str]] = None

    toplevel_doc: DocFmt
    toplevel_doc_overrides: Optional[dict[str, DocFmt]] = None

    # Should be a dataclass.
    arg_type: Optional[Any] = None
    arg_type_overrides: Optional[dict[str, Any]] = None

    # Should be a type.
    return_type: Optional[Any] = None
    return_type_overrides: Optional[dict[str, Any]] = None

    return_doc: Optional[DocFmt] = None
    return_doc_overrides: Optional[dict[str, DocFmt]] = None

    attributes: FunctionAttributes = FunctionAttributes()


def py_generate(f: Function) -> str:
    def get_optional_dict(opt_dict: Optional[dict]):
        if opt_dict is None:
            return None
        else:
            return opt_dict.get(PY_LANG)

    name = f.name or f.name_overrides[PY_LANG]
    toplevel_doc = f.toplevel_doc or f.toplevel_doc[PY_LANG]
    arg_type = f.arg_type or get_optional_dict(f.arg_type_overrides)
    return_type = f.return_type or get_optional_dict(f.return_type_overrides)
    return_doc = f.return_doc or get_optional_dict(f.return_doc_overrides)
    attributes = f.attributes

    arglist = []
    if attributes.is_instance_method:
        arglist.append("self")
    if arg_type:
        arglist.extend(dataclass_argspec(arg_type))

    if return_type is None:
        retspec = "None"
    elif dataclasses.is_dataclass(return_type) and attributes.py_return_dataclass_as_dict:
        retspec = "dict"
    else:
        retspec = typespec(return_type)

    docstr = full_docstring(lang, toplevel_doc, arg_type, return_type)

    return f"""
    def {ident(lang, name)}({", ".join(arglist)}) -> {retspec}:
    {indent(docstr, num_tabs=1)}
        return _{ident(lang, name)}_impl(
    """
