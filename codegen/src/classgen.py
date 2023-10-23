import dataclasses
from typing import List, Optional, Set

from format import DocFmt, docstring, indent
from functiongen import (
    Constructor,
    Function,
    Overridable,
    _get,
    generate_constructor,
    generate_function,
)


@dataclasses.dataclass
class Class:
    # Documentation.
    name: Overridable[str]
    toplevel_doc: Overridable[DocFmt]

    # All of these methods will be treated as instance methods.
    constructor: Constructor
    methods: List[Function]

    # Enable for certain languages. If None, enable for all languages.
    language_whitelist: Optional[Set] = None

    def is_whitelisted(self, lang: str) -> bool:
        return self.language_whitelist is None or lang in self.language_whitelist


def generate_class(lang: str, c: Class) -> str:
    assert c.is_whitelisted(lang)

    name = _get(lang, c.name)
    toplevel_doc = _get(lang, c.toplevel_doc)
    doc_lines = toplevel_doc.format(lang).split("\n")

    constructor = c.constructor
    functions = [dataclasses.replace(m, is_instance_method=True) for m in c.methods]

    method_lines = []
    method_lines.extend(generate_constructor(lang, name, constructor).split("\n"))
    for f in functions:
        if not f.is_whitelisted(lang):
            continue
        method_lines.extend(generate_function(lang, f).split("\n"))
    method_str = "\n".join(method_lines)

    def ts():
        return f"""{docstring("ts", doc_lines)}
export class {name} {{
    private _impl: impl.{name}Impl

{indent(method_str, 1)}
}}
"""

    def py():
        return f"""class {name}:
{indent(docstring("py", doc_lines), 1)}

{indent(method_str, 1)}
"""

    return dict(ts=ts, py=py)[lang]()
