import dataclasses
from typing import Any, Dict, List, Optional, Tuple

from format import DocFmt, _is_optional_type, argspec, docstring, ident, indent, paramline, retline, typespec


def genfield(doc_fmt: DocFmt, custom_argspecs: Optional[Dict[str, str]] = None) -> Any:
    metadata = dict(
        doc=doc_fmt,
        custom_argspecs=custom_argspecs,
    )
    return dataclasses.field(metadata=metadata)


def _dataclass_paramlines(lang: str, d: Any, arg_prefix: Optional[List[str]] = None) -> List[str]:
    assert dataclasses.is_dataclass(d)

    if arg_prefix is None:
        arg_prefix = []

    out = []
    fields = dataclasses.fields(d)
    for f in fields:
        arg_ident = ident(lang, f.name)
        argname = ".".join(arg_prefix + [arg_ident])
        docstr = f.metadata.get("doc", DocFmt("")).format(lang)
        out.append(paramline(lang, argname, docstr))
        if dataclasses.is_dataclass(f.type):
            out.extend(_dataclass_paramlines(lang, f.type, arg_prefix=arg_prefix + [arg_ident]))
    return out


def dataclass_docstring(
    lang: str,
    toplevel_fmt: Optional[DocFmt],
    args_d: Optional[Any],
    return_fmt: Optional[DocFmt],
) -> str:
    assert dataclasses.is_dataclass(args_d)

    outlines = []
    if toplevel_fmt is not None:
        outlines.extend(toplevel_fmt.format(lang).split("\n"))
    remaining_outlines = []
    if args_d is not None:
        remaining_outlines.extend(_dataclass_paramlines(lang, args_d))
    if return_fmt is not None:
        remaining_outlines.extend(retline(lang, return_fmt.format(lang)).split("\n"))
    if len(remaining_outlines) > 0:
        outlines.append("")
        outlines.extend(remaining_outlines)

    return docstring(lang, outlines)


def dataclass_argspecs(lang: str, args_d: Any) -> List[str]:
    assert dataclasses.is_dataclass(args_d)

    out = []
    for field in dataclasses.fields(args_d):
        custom_argspecs = field.metadata.get("custom_argspecs")
        if custom_argspecs is not None and lang in custom_argspecs:
            out.append(ident(lang, field.name) + custom_argspecs[lang])
        else:
            out.append(argspec(lang, field.name, field.type))
    return out


def to_conventional_arg_type(lang: str, args_d: Any) -> Tuple[type, str]:
    """In different languages, we will list out arguments for a certain type
    definition differently. In python, we will generally just list out each
    argument as a keyword arg. In typescript, if the arguments fit the pattern
    of a set of required arguments followed by a set of optional arguments, we
    will conventionally list out the required arguments as positional and then
    group the remaining optional arguments into an `options` bundle. Otherwise,
    we'll just wrap the entire type into an `args` field.

    This function accepts a dataclass type. Dependending on the language type,
    we return a transformed argument to be used as the argspec and a string to
    create an instance of the original `args_d` from the new type.
    """

    assert dataclasses.is_dataclass(args_d)
    fields = dataclasses.fields(args_d)

    if len(fields) == 0:
        return args_d, ""

    def ts():
        required_then_optional_field_split = ([], [])
        invalidated = False
        for f in fields:
            if _is_optional_type(f.type):
                required_then_optional_field_split[1].append(f)
            else:
                if len(required_then_optional_field_split[1]) == 0:
                    required_then_optional_field_split[0].append(f)
                else:
                    # We have already encountered an optional field, so this
                    # required field breaks the pattern.
                    invalidated = True
                    break

        typename = f"Wrapped{args_d.__name__}"
        if invalidated:
            # We don't fit the pattern. Just wrap the type.
            wrapped_d = dataclasses.make_dataclass(typename, [("args", args_d)])
            return wrapped_d, "args"
        else:
            required_fields, optional_fields = required_then_optional_field_split
            optional_bundle_type = dataclasses.make_dataclass(
                typename + "OptionalBundle", [(f.name, f.type, f) for f in optional_fields]
            )
            if len(optional_fields) > 0:
                optional_bundle = [("options", optional_bundle_type)]
                optional_retstr = ", ...options"
            else:
                optional_bundle = []
                optional_retstr = ""

            wrapped_d = dataclasses.make_dataclass(
                typename, [(f.name, f.type, f) for f in required_fields] + optional_bundle
            )
            return wrapped_d, f"""{{ {", ".join(ident("ts", f.name) for f in required_fields)}{optional_retstr} }}"""

    def py():
        arg_wrapper = (
            f"""{args_d.__name__}({", ".join(f"{ident('py', f.name)} = {ident('py', f.name)}" for f in fields)})"""
        )
        return args_d, arg_wrapper

    return dict(ts=ts, py=py)[lang]()


def dataclass_typedef(lang: str, type_d: Any) -> str:
    assert dataclasses.is_dataclass(type_d)

    argspecs = dataclass_argspecs(lang, type_d)

    def ts():
        return f"""export interface {type_d.__name__} {{ {"; ".join(argspecs)} }}"""

    def py():
        indented_argspecs_str = "\n".join([indent(a, 1) for a in argspecs])
        return f"""class {type_d.__name__}:\n{indented_argspecs_str}"""

    return dict(ts=ts, py=py)[lang]()
