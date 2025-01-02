from typing import Any, List, Literal, Optional, TypeVar, Union, overload

from sseclient import SSEClient

from ..logger import Exportable, get_span_parent_object, login, proxy_conn
from ..util import response_raise_for_status
from .constants import INVOKE_API_VERSION
from .stream import BraintrustInvokeError, BraintrustStream

T = TypeVar("T")
ModeType = Literal["auto", "parallel"]


@overload
def invoke(
    # the permutations of arguments for a function id
    function_id: Optional[str] = None,
    version: Optional[str] = None,
    prompt_session_id: Optional[str] = None,
    prompt_session_function_id: Optional[str] = None,
    project_name: Optional[str] = None,
    slug: Optional[str] = None,
    global_function: Optional[str] = None,
    # arguments to the function
    input: Any = None,
    messages: Optional[List[Any]] = None,
    parent: Optional[Union[Exportable, str]] = None,
    stream: Optional[Literal[False]] = None,
    mode: Optional[ModeType] = None,
    org_name: Optional[str] = None,
    api_key: Optional[str] = None,
    app_url: Optional[str] = None,
    force_login: bool = False,
) -> T:
    ...


@overload
def invoke(
    # the permutations of arguments for a function id
    function_id: Optional[str] = None,
    version: Optional[str] = None,
    prompt_session_id: Optional[str] = None,
    prompt_session_function_id: Optional[str] = None,
    project_name: Optional[str] = None,
    slug: Optional[str] = None,
    global_function: Optional[str] = None,
    # arguments to the function
    input: Any = None,
    messages: Optional[List[Any]] = None,
    parent: Optional[Union[Exportable, str]] = None,
    stream: Literal[True] = True,
    mode: Optional[ModeType] = None,
    org_name: Optional[str] = None,
    api_key: Optional[str] = None,
    app_url: Optional[str] = None,
    force_login: bool = False,
) -> BraintrustStream:
    ...


def invoke(
    # the permutations of arguments for a function id
    function_id: Optional[str] = None,
    version: Optional[str] = None,
    prompt_session_id: Optional[str] = None,
    prompt_session_function_id: Optional[str] = None,
    project_name: Optional[str] = None,
    slug: Optional[str] = None,
    global_function: Optional[str] = None,
    # arguments to the function
    input: Any = None,
    messages: Optional[List[Any]] = None,
    parent: Optional[Union[Exportable, str]] = None,
    stream: bool = False,
    mode: Optional[ModeType] = None,
    org_name: Optional[str] = None,
    api_key: Optional[str] = None,
    app_url: Optional[str] = None,
    force_login: bool = False,
) -> Union[BraintrustStream, T]:
    """
    Invoke a Braintrust function, returning a `BraintrustStream` or the value as a plain
    Python object.

    Args:
        input: The input to the function. This will be logged as the `input` field in the span.
        messages: Additional OpenAI-style messages to add to the prompt (only works for llm functions).
        parent: The parent of the function. This can be an existing span, logger, or experiment, or
            the output of `.export()` if you are distributed tracing. If unspecified, will use
            the same semantics as `traced()` to determine the parent and no-op if not in a tracing
            context.
        stream: Whether to stream the function's output. If True, the function will return a
            `BraintrustStream`, otherwise it will return the output of the function as a JSON
            object.
        mode: The response shape of the function if returning tool calls. If "auto", will return
            a string if the function returns a string, and a JSON object otherwise. If "parallel",
            will return an array of JSON objects with one object per tool call.
        org_name: The name of the Braintrust organization to use.
        api_key: The API key to use for authentication.
        app_url: The URL of the Braintrust application.
        force_login: Whether to force a new login even if already logged in.
        function_id: The ID of the function to invoke.
        version: The version of the function to invoke.
        prompt_session_id: The ID of the prompt session to invoke the function from.
        prompt_session_function_id: The ID of the function in the prompt session to invoke.
        project_name: The name of the project containing the function to invoke.
        slug: The slug of the function to invoke.
        global_function: The name of the global function to invoke.

    Returns:
        The output of the function. If `stream` is True, returns a `BraintrustStream`,
        otherwise returns the output as a Python object.
    """
    login(
        org_name=org_name,
        api_key=api_key,
        app_url=app_url,
        force_login=force_login,
    )

    parent = parent if isinstance(parent, str) else parent.export() if parent else get_span_parent_object().export()

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
    if messages is not None:
        request["messages"] = messages
    if mode is not None:
        request["mode"] = mode

    headers = {"Accept": "text/event-stream" if stream else "application/json"}

    resp = proxy_conn().post("function/invoke", json=request, headers=headers, stream=stream)
    if resp.status_code == 500:
        raise BraintrustInvokeError(resp.text)

    response_raise_for_status(resp)

    if stream:
        return BraintrustStream(SSEClient(resp))
    else:
        return resp.json()


def init_function(project_name: str, slug: str, version: Optional[str] = None):
    """
    Creates a function that can be used as either a task or scorer in the Eval framework.
    When used as a task, it will invoke the specified Braintrust function with the input.
    When used as a scorer, it will invoke the function with the scorer arguments.

    Example:
    ```python
    # As a task
    Eval(
        name="my-evaluator",
        data=data,
        task=init_function("my-project", "my-function"),
        scores=[...]
    )

    # As a scorer
    Eval(
        name="my-evaluator",
        data=data,
        task=task,
        scores=[init_function("my-project", "my-scorer")]
    )
    ```

    :param project_name: The name of the project containing the function.
    :param slug: The slug of the function to invoke.
    :param version: Optional version of the function to use. Defaults to latest.
    :return: A function that can be used as a task or scorer.
    """

    def f(*args: Any, **kwargs: Any) -> Any:
        if len(args) > 0:
            # Task.
            return invoke(project_name=project_name, slug=slug, version=version, input=args[0])
        else:
            # Scorer.
            return invoke(project_name=project_name, slug=slug, version=version, input=kwargs)

    f.__name__ = f"init_function-{project_name}-{slug}-{version or 'latest'}"
    return f
