"""Implements the braintrust push subcommand."""

import importlib.abc
import importlib.machinery
import importlib.metadata
import importlib.util
import inspect
import json
import os
import re
import subprocess
import sys
import tempfile
import textwrap
import zipfile
from typing import Any, Dict, List, Optional

import requests

from .. import api_conn, app_conn, login, org_id, proxy_conn
from ..framework2 import CodeFunction, global_
from ..types import IfExists
from ..util import add_azure_blob_headers


class _ProjectIdCache:
    def __init__(self):
        self._cache = {}

    def get(self, project):
        if project not in self._cache:
            resp = app_conn().post_json("api/project/register", {"project_name": project.name})
            self._cache[project] = resp["project"]["id"]
        return self._cache[project]


def _pkg_install_arg(pkg) -> Optional[str]:
    try:
        dist = importlib.metadata.distribution(pkg)
        direct_url = dist._path / "direct_url.json"  # type: ignore
        if direct_url.exists():
            with open(direct_url) as f:
                j = json.loads(f.read())
                if "url" in j:
                    return j["url"]
        return f"{pkg}=={dist.version}"
    except importlib.metadata.PackageNotFoundError as e:
        print(f"Failed to find package {pkg}: {e}", file=sys.stderr)
    return None


def _pydantic_to_json_schema(m):
    if hasattr(m, "model_json_schema"):
        # pydantic 2
        return m.model_json_schema()
    # pydantic 1
    return m.schema()


def _check_uv():
    try:
        import uv as _
    except ImportError:
        raise ValueError(
            textwrap.dedent(
                f"""\
                The `uv` package is required to push to Braintrust. You can install it by including the
                extra "cli" dependencies. Run:

                  pip install 'braintrust[cli]'

                to install braintrust with the CLI dependencies (make sure to quote 'braintrust[cli]')."""
            ),
        )


class _ProjectRootImporter(importlib.abc.MetaPathFinder):
    """An importer that only resolves top-level modules from the project root and their submodules,
    and collects the source files of all imported modules.
    """

    def __init__(self) -> None:
        self._project_root, self._path_rest = sys.path[0], sys.path[1:]
        self._sources = []

    def _under_project_root(self, path: List[str]) -> bool:
        """Returns true if all paths in `path` are under the project root."""
        return all(p.startswith(self._project_root) for p in path)

    def _under_rest(self, path: List[str]) -> bool:
        """Returns true if any path in `path` is under one of the remaining paths in `sys.path`."""
        return any(p.startswith(pr) for p in path for pr in self._path_rest)

    def find_spec(self, fullname, path, target=None):
        if path is None:
            # Resolve top-level modules only from the project root.
            path = [self._project_root]
        elif not self._under_project_root(path) or self._under_rest(path):
            # Defer paths that are not under the project root or covered by another sys.path entry
            # to the subsequent importers.
            return None
        spec = importlib.machinery.PathFinder.find_spec(fullname, path, target)
        if spec is not None and spec.origin is not None:
            self._sources.append(spec.origin)
        return spec

    def sources(self) -> List[str]:
        return self._sources


def _import_module(name: str, path: str) -> List[str]:
    """Imports the module and returns the list of source files
    of all modules imported in the process.

    Args:
        name: The fully qualified name of the module to import.
        path: The absolute path to the module to import.

    Returns:
        A list of absolute paths to source files of all modules imported in the process.
    """
    importer = _ProjectRootImporter()
    sys.meta_path.insert(0, importer)

    importlib.import_module(name)
    return importer.sources()


def _py_version() -> str:
    return f"{sys.version_info.major}.{sys.version_info.minor}"


def _run_install(install_args: List[str], packages_dir: str):
    subprocess.run(
        [
            "uv",
            "pip",
            "install",
            *install_args,
            "--target",
            packages_dir,
            "--python-platform",
            os.environ.get("BRAINTRUST_INTERNAL_PY_BUNDLE_PLATFORM_OVERRIDE", "linux"),
            "--python-version",
            os.environ.get("BRAINTRUST_INTERNAL_PY_BUNDLE_VERSION_OVERRIDE", _py_version()),
        ],
        check=True,
    )


def _upload_bundle(entry_module_name: str, sources: List[str], requirements: Optional[str]) -> str:
    _check_uv()

    resp = proxy_conn().post_json(
        "function/code",
        {
            "org_id": org_id(),
            "runtime_context": {
                "runtime": "python",
                "version": _py_version(),
            },
        },
    )
    bundle_upload_url = resp["url"]
    bundle_id = resp["bundleId"]

    with tempfile.TemporaryDirectory() as td:
        packages_dir = os.path.join(td, "pkg")

        # Though not strictly necessary, these packages should be those supported in the Python code editor
        # with the exception of pydantic, which is necessary to allow the user to express function input schemas.
        _run_install(
            [
                arg
                for arg in [
                    _pkg_install_arg(pkg)
                    for pkg in [
                        "pydantic",
                        "braintrust",
                        "autoevals",
                        "requests",
                        "openai",
                    ]
                ]
                if arg is not None
            ],
            packages_dir,
        )
        if requirements:
            # Overwrite any packages that are already installed.
            _run_install(["--requirement", requirements], packages_dir)

        with zipfile.ZipFile(
            os.path.join(td, "pkg.zip"), "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as zf:
            for dirpath, dirnames, filenames in os.walk(packages_dir):
                arcdirpath = os.path.relpath(dirpath, packages_dir)
                arcdirpath = os.path.normpath(arcdirpath)
                for name in sorted(dirnames):
                    path = os.path.join(dirpath, name)
                    arcname = os.path.join(arcdirpath, name)
                    zf.write(path, arcname)
                for name in filenames:
                    path = os.path.join(dirpath, name)
                    path = os.path.normpath(path)
                    if os.path.isfile(path):
                        arcname = os.path.join(arcdirpath, name)
                        zf.write(path, arcname)
            for source in sources:
                zf.write(source, os.path.relpath(source))
            zf.writestr("register.py", f"import {entry_module_name} as _\n")
        headers = {}
        add_azure_blob_headers(headers, bundle_upload_url)
        with open(os.path.join(td, "pkg.zip"), "rb") as zf:
            requests.put(
                bundle_upload_url,
                data=zf.read(),
                headers=headers,
            ).raise_for_status()

    return bundle_id


def _collect_function_function_defs(
    project_ids: _ProjectIdCache, functions: List[Dict[str, Any]], bundle_id: str, if_exists: IfExists
) -> None:
    for i, f in enumerate(global_.functions):
        source = inspect.getsource(f.handler)
        if f.handler.__name__ == "<lambda>":
            m = re.search(r"handler\s*=\s*(.+)\s*[,)]", source)
            if m is None:
                raise ValueError(f"Failed to find handler for {f.name}")
            source = m.group(1)
        j = {
            "project_id": project_ids.get(f.project),
            "name": f.name,
            "slug": f.slug,
            "description": f.description,
            "function_data": {
                "type": "code",
                "data": {
                    "type": "bundle",
                    "runtime_context": {
                        "runtime": "python",
                        "version": _py_version(),
                    },
                    "location": {
                        "type": "function",
                        "index": i,
                    },
                    "bundle_id": bundle_id,
                    "preview": source.strip(),
                },
            },
            "function_type": f.type_,
            "function_schema": {
                "parameters": f.parameters,
                "returns": f.returns,
            },
            "if_exists": f.if_exists if f.if_exists else if_exists,
        }
        if f.parameters is not None or f.returns is not None:
            j["function_schema"] = {}
            if f.parameters is not None:
                j["function_schema"]["parameters"] = _pydantic_to_json_schema(f.parameters)
            if f.returns is not None:
                j["function_schema"]["returns"] = _pydantic_to_json_schema(f.returns)
        functions.append(j)


def _collect_prompt_function_defs(
    project_ids: _ProjectIdCache, functions: List[Dict[str, Any]], if_exists: IfExists
) -> None:
    for p in global_.prompts:
        prompt_data = p.prompt
        if len(p.tool_functions) > 0:
            resolvable_tool_functions = []
            for f in p.tool_functions:
                if isinstance(f, CodeFunction):
                    resolvable_tool_functions.append(
                        {
                            "type": "slug",
                            "project_id": project_ids.get(f.project),
                            "slug": f.slug,
                        }
                    )
                else:
                    resolvable_tool_functions.append(f)
            prompt_data["tool_functions"] = resolvable_tool_functions
        j = {
            "project_id": project_ids.get(p.project),
            "name": p.name,
            "slug": p.slug,
            "function_data": {
                "type": "prompt",
            },
            "prompt_data": prompt_data,
            "if_exists": p.if_exists if p.if_exists is not None else if_exists,
        }
        if p.description is not None:
            j["description"] = p.description
        if p.function_type is not None:
            j["function_type"] = p.function_type
        functions.append(j)


def run(args):
    """Runs the braintrust push subcommand."""
    login(
        api_key=args.api_key,
        org_name=args.org_name,
        app_url=args.app_url,
    )

    if sys.path[0] != os.getcwd():
        raise ValueError(
            f"The current working directory ({os.getcwd()}) is not the project root. "
            "Please run the push command from the project root."
        )
    path = os.path.abspath(args.file)
    module_name = re.sub(".py$", "", os.path.relpath(path).replace("-", "_").replace("/", "."))

    try:
        sources = _import_module(module_name, path)
    except ImportError as e:
        if str(e) == "attempted relative import with no known parent package":
            raise ImportError(
                "Attempted to import a module using relative imports (e.g. from . import foo), but Python "
                "cannot resolve these imports without a parent package. To fix this, either: "
                "(1) combine all your code into a single file, or "
                "(2) set up a proper Python package with an __init__.py file."
            ) from e
        raise
    except Exception as e:
        raise

    project_ids = _ProjectIdCache()
    functions: List[Dict[str, Any]] = []
    if len(global_.functions) > 0:
        bundle_id = _upload_bundle(module_name, sources, args.requirements)
        _collect_function_function_defs(project_ids, functions, bundle_id, args.if_exists)
    if len(global_.prompts) > 0:
        _collect_prompt_function_defs(project_ids, functions, args.if_exists)

    if len(functions) > 0:
        api_conn().post_json("insert-functions", {"functions": functions})
    else:
        print("No functions found in the module. Nothing was pushed.", file=sys.stderr)


def build_parser(subparsers, parent_parser):
    """Adds the parser for the push subcommand."""
    parser = subparsers.add_parser(
        "push",
        help="Push code to Braintrust",
        parents=[parent_parser],
    )
    parser.add_argument(
        "--api-key",
        help="Specify a Braintrust api key. If the parameter is not specified, the BRAINTRUST_API_KEY environment variable will be used.",
    )
    parser.add_argument(
        "--org-name",
        help="The name of a specific organization to connect to. This is useful if you belong to multiple.",
    )
    parser.add_argument(
        "--app-url",
        help="Specify a custom Braintrust app url. Defaults to https://www.braintrust.dev. This is only necessary if you are using an experimental version of Braintrust.",
    )
    parser.add_argument(
        "--if-exists",
        default="error",
        choices=["error", "replace", "ignore"],
        help="What to do if a function with the same slug already exists. 'error' will cause an error and abort. 'replace' will overwrite the existing function. 'ignore' will ignore the push for this function and continue.",
    )

    parser.add_argument(
        "file",
        help="File to push.",
    )
    parser.add_argument("--requirements", help="The requirements file to bundle dependencies from.")
    parser.set_defaults(func=run)
