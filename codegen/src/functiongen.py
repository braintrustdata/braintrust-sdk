import dataclasses
from typing import Any, Dict, Generic, Optional, Set, TypeVar, Union, overload

from dataclass_util import dataclass_argspecs, dataclass_docstring, to_conventional_arg_type
from format import DocFmt, ident, indent, typespec

_T = TypeVar("_T")


@dataclasses.dataclass
class Override(Generic[_T]):
    default: _T
    overrides: Optional[Dict[str, _T]] = None


Overridable = Union[_T, Override[_T]]


def _get(lang: str, val: Overridable[_T]) -> _T:
    if isinstance(val, Override):
        if val.overrides is None or lang not in val.overrides:
            return val.default
        else:
            return val.overrides[lang]
    else:
        return val


@dataclasses.dataclass
class Function:
    # Documentation.
    name: Overridable[str]
    toplevel_doc: Overridable[DocFmt]
    # Should be a dataclass.
    arg_type: Overridable[Optional[Any]] = None
    return_type: Overridable[Optional[Any]] = None
    return_doc: Overridable[Optional[DocFmt]] = None

    # Attributes.
    is_instance_method: Overridable[bool] = False
    is_async: Overridable[bool] = False
    is_generator: Overridable[bool] = False
    is_getter_method: Overridable[bool] = False

    # Enable for certain languages. If None, enable for all languages.
    language_whitelist: Optional[Set] = None

    def is_whitelisted(self, lang: str) -> bool:
        return self.language_whitelist is None or lang in self.language_whitelist


def _ts_generate_function(f: Function) -> str:
    assert f.is_whitelisted("ts")

    name = _get("ts", f.name)
    toplevel_doc = _get("ts", f.toplevel_doc)
    arg_type = _get("ts", f.arg_type)
    return_type = _get("ts", f.return_type)
    return_doc: Optional[DocFmt] = _get("ts", f.return_doc)

    is_instance_method = _get("ts", f.is_instance_method)
    is_async = _get("ts", f.is_async)
    is_generator = _get("ts", f.is_generator)
    is_getter_method = _get("ts", f.is_getter_method)

    assert dataclasses.is_dataclass(arg_type)
    if not is_instance_method:
        assert not is_getter_method
    if not is_async:
        assert not is_generator
    assert not (is_generator and is_getter_method)
    if is_getter_method:
        assert len(dataclasses.fields(arg_type)) == 0

    arg_type, to_orig_arg_type = to_conventional_arg_type("ts", arg_type)
    docstr = dataclass_docstring("ts", toplevel_doc, arg_type, return_doc)

    if return_type is None:
        retspec = "void"
    else:
        retspec = typespec("ts", return_type)

    if is_generator:
        assert return_type is not None
        retspec = f"AsyncGenerator<{retspec}>"
    elif is_async:
        retspec = f"Promise<{retspec}>"

    if is_getter_method:
        qualifiers = "get "
    elif is_async:
        qualifiers = "async "
        if is_generator:
            qualifiers += " *"
    else:
        qualifiers = ""

    fname = ident("ts", name)
    argspec = ", ".join(dataclass_argspecs("ts", arg_type))

    if is_instance_method:
        impl_name = f"this._impl.{fname}"
    else:
        impl_name = f"impl.{fname}_impl"

    return f"""{docstr}
{qualifiers}{fname}({argspec}): {retspec} {{
    return {impl_name}({to_orig_arg_type})
}}
"""


def _py_generate_function(f: Function) -> str:
    assert f.is_whitelisted("py")

    name = _get("py", f.name)
    toplevel_doc = _get("py", f.toplevel_doc)
    arg_type = _get("py", f.arg_type)
    return_type = _get("py", f.return_type)
    return_doc = _get("py", f.return_doc)

    is_instance_method = _get("py", f.is_instance_method)
    is_async = _get("py", f.is_async)
    is_generator = _get("py", f.is_generator)
    is_getter_method = _get("ts", f.is_getter_method)

    assert dataclasses.is_dataclass(arg_type)
    if not is_instance_method:
        assert not is_getter_method
    assert not (is_generator and is_getter_method)
    if is_getter_method:
        assert len(dataclasses.fields(arg_type)) == 0

    arg_type, to_orig_arg_type = to_conventional_arg_type("py", arg_type)
    docstr = dataclass_docstring("py", toplevel_doc, arg_type, return_doc)

    if return_type is None:
        retspec = "None"
        assert not is_generator
    else:
        retspec = typespec("py", return_type)
        if is_generator:
            if is_async:
                retspec = f"AsyncIterator[{retspec}]"
            else:
                retspec = f"Iterator[{retspec}]"

    decorators = []
    if is_getter_method:
        decorators.append("@property")

    if is_async:
        async_spec = "async "
    else:
        async_spec = ""

    fname = ident("py", name)
    argspecs = dataclass_argspecs("py", arg_type)

    if is_instance_method:
        argspecs = ["self"] + argspecs
        impl_name = f"self._impl.{fname}"
    else:
        impl_name = f"impl.{fname}_impl"

    argspec_str = ", ".join(argspecs)
    decorator_str = "".join(d + "\n" for d in decorators)

    return f"""{decorator_str}{async_spec}def {fname}({argspec_str}) -> {retspec}:
{indent(docstr, num_tabs=1)}
    return {impl_name}({to_orig_arg_type})
"""


def generate_function(lang: str, f: Function) -> str:
    return dict(ts=_ts_generate_function, py=_py_generate_function)[lang](f)


@dataclasses.dataclass
class Constructor:
    toplevel_doc: Overridable[DocFmt]
    # Should be a dataclass.
    arg_type: Overridable[Optional[type]] = None


def generate_constructor(lang: str, class_name: str, constructor: Constructor) -> str:
    toplevel_doc = _get(lang, constructor.toplevel_doc)
    arg_type = _get(lang, constructor.arg_type)
    impl_name = f"impl.{class_name}Impl"

    def ts():
        nonlocal arg_type
        arg_type, to_orig_arg_type = to_conventional_arg_type("ts", arg_type)
        argspec_str = ", ".join(dataclass_argspecs("ts", arg_type))
        return f"""constructor({argspec_str}) {{
    this._impl = new {impl_name}({to_orig_arg_type})
}}
"""

    def py():
        nonlocal arg_type
        arg_type, to_orig_arg_type = to_conventional_arg_type("py", arg_type)
        argspec_str = ", ".join(["self"] + dataclass_argspecs("py", arg_type))
        return f"""def __init__(self, {argspec_str}):
    self._impl = {impl_name}({to_orig_arg_type})
"""

    return dict(ts=ts, py=py)[lang]()
