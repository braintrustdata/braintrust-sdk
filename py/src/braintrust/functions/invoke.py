import dataclasses
from typing import Any, Dict, Generic, Optional, TypeVar, Union

from braintrust_core.functions import INVOKE_API_VERSION
from sseclient import SSEClient

from ..logger import Exportable, current_span, login, proxy_conn
from .stream import BraintrustStream

T = TypeVar("T")


@dataclasses.dataclass
class InvokeFunctionArgs(Generic[T]):
    input: Any
    parent: Optional[Union[Exportable, str]] = None
    stream: bool = False
    org_name: Optional[str] = None
    api_key: Optional[str] = None
    app_url: Optional[str] = None
    force_login: bool = False

    # the permutations of arguments for a function id
    function_id: Optional[str] = None
    version: Optional[str] = None
    prompt_session_id: Optional[str] = None
    prompt_session_function_id: Optional[str] = None
    project_name: Optional[str] = None
    slug: Optional[str] = None
    global_function: Optional[str] = None


def invoke(
    input: Any,
    parent: Optional[Union[Exportable, str]] = None,
    stream: bool = False,
    org_name: Optional[str] = None,
    api_key: Optional[str] = None,
    app_url: Optional[str] = None,
    force_login: bool = False,
    # the permutations of arguments for a function id
    function_id: Optional[str] = None,
    version: Optional[str] = None,
    prompt_session_id: Optional[str] = None,
    prompt_session_function_id: Optional[str] = None,
    project_name: Optional[str] = None,
    slug: Optional[str] = None,
    global_function: Optional[str] = None,
) -> Union[BraintrustStream, T]:
    login(
        org_name=org_name,
        api_key=api_key,
        app_url=app_url,
        force_login=force_login,
    )

    parent = parent if isinstance(parent, str) else parent.export() if parent else current_span().export()

    function_id_args = {}
    if function_id is not None:
        function_id_args["function_id"] = function_id
    if version is not None:
        function_id_args["version"] = version
    if prompt_session_id is not None:
        function_id_args["prompt_session_id"] = prompt_session_id
    if prompt_session_function_id is not None:
        function_id_args["prompt_session_function_id"] = prompt_session_function_id
    if project_name is not None:
        function_id_args["project_name"] = project_name
    if slug is not None:
        function_id_args["slug"] = slug
    if global_function is not None:
        function_id_args["global_function"] = global_function

    request = dict(
        input=input,
        parent=parent,
        stream=stream,
        api_version=INVOKE_API_VERSION,
        **function_id_args,
    )

    headers = {"Accept": "text/event-stream" if stream else "application/json"}

    resp = proxy_conn().post("function/invoke", json=request, headers=headers)

    if stream:
        if not resp.content:
            raise ValueError("Received empty stream body")
        return BraintrustStream(SSEClient(resp))
    else:
        return resp.json()
