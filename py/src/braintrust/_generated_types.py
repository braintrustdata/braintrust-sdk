"""
Do not import this file directly. See `generated_types.py` for the classes that have a stable API.

Auto-generated file -- do not modify.
"""

from __future__ import annotations

from typing import Any, Literal, Mapping, Optional, Sequence, TypedDict, Union

from typing_extensions import NotRequired

AclObjectType = Literal[
    'organization',
    'project',
    'experiment',
    'dataset',
    'prompt',
    'prompt_session',
    'group',
    'role',
    'org_member',
    'project_log',
    'org_project',
]


class AISecret(TypedDict):
    id: str
    """
    Unique identifier for the AI secret
    """
    created: NotRequired[Optional[str]]
    """
    Date of AI secret creation
    """
    updated_at: NotRequired[Optional[str]]
    """
    Date of last AI secret update
    """
    org_id: str
    """
    Unique identifier for the organization
    """
    name: str
    """
    Name of the AI secret
    """
    type: NotRequired[Optional[str]]
    metadata: NotRequired[Optional[Mapping[str, Any]]]
    preview_secret: NotRequired[Optional[str]]


class AnyModelParamsToolChoiceFunction(TypedDict):
    name: str


class AnyModelParamsToolChoice(TypedDict):
    type: Literal['function']
    function: AnyModelParamsToolChoiceFunction


class AnyModelParamsFunctionCall(TypedDict):
    name: str


class ApiKey(TypedDict):
    id: str
    """
    Unique identifier for the api key
    """
    created: NotRequired[Optional[str]]
    """
    Date of api key creation
    """
    name: str
    """
    Name of the api key
    """
    preview_name: str
    user_id: NotRequired[Optional[str]]
    """
    Unique identifier for the user
    """
    user_email: NotRequired[Optional[str]]
    """
    The user's email
    """
    user_given_name: NotRequired[Optional[str]]
    """
    Given name of the user
    """
    user_family_name: NotRequired[Optional[str]]
    """
    Family name of the user
    """
    org_id: NotRequired[Optional[str]]
    """
    Unique identifier for the organization
    """


class AsyncScoringControlAsyncScoringControl(TypedDict):
    kind: Literal['score_update']
    token: str


class AsyncScoringControlAsyncScoringControl2(TypedDict):
    kind: Literal['state_force_reselect']


class AsyncScoringControlAsyncScoringControl3(TypedDict):
    kind: Literal['state_enabled_force_rescore']


class AsyncScoringStateAsyncScoringState(TypedDict):
    status: Literal['enabled']
    token: str
    function_ids: Sequence
    skip_logging: NotRequired[Optional[bool]]


class AsyncScoringStateAsyncScoringState1(TypedDict):
    status: Literal['disabled']


AsyncScoringState = Optional[Union[AsyncScoringStateAsyncScoringState, AsyncScoringStateAsyncScoringState1]]


class BraintrustAttachmentReference(TypedDict):
    type: Literal['braintrust_attachment']
    """
    An identifier to help disambiguate parsing.
    """
    filename: str
    """
    Human-readable filename for user interfaces. Not related to attachment storage.
    """
    content_type: str
    """
    MIME type of this file.
    """
    key: str
    """
    Key in the object store bucket for this attachment.
    """


class BraintrustModelParams(TypedDict):
    use_cache: NotRequired[Optional[bool]]


class CallEventCallEvent(TypedDict):
    id: NotRequired[Optional[str]]
    data: str
    event: Literal['text_delta']


class CallEventCallEvent1(TypedDict):
    id: NotRequired[Optional[str]]
    data: str
    event: Literal['reasoning_delta']


class CallEventCallEvent2(TypedDict):
    id: NotRequired[Optional[str]]
    data: str
    event: Literal['json_delta']


class CallEventCallEvent3(TypedDict):
    id: NotRequired[Optional[str]]
    data: str
    event: Literal['progress']


class CallEventCallEvent4(TypedDict):
    id: NotRequired[Optional[str]]
    data: str
    event: Literal['error']


class CallEventCallEvent5(TypedDict):
    id: NotRequired[Optional[str]]
    data: str
    event: Literal['console']


class CallEventCallEvent6(TypedDict):
    id: NotRequired[Optional[str]]
    event: Literal['start']
    data: Literal['']


class CallEventCallEvent7(TypedDict):
    id: NotRequired[Optional[str]]
    event: Literal['done']
    data: Literal['']


CallEvent = Union[
    CallEventCallEvent,
    CallEventCallEvent1,
    CallEventCallEvent2,
    CallEventCallEvent3,
    CallEventCallEvent4,
    CallEventCallEvent5,
    CallEventCallEvent6,
    CallEventCallEvent7,
]


class ChatCompletionContentPartImageWithTitleImageUrl(TypedDict):
    url: str
    detail: NotRequired[Optional[Union[Literal['auto'], Literal['low'], Literal['high']]]]


class ChatCompletionContentPartImageWithTitle(TypedDict):
    image_url: ChatCompletionContentPartImageWithTitleImageUrl
    type: Literal['image_url']


class ChatCompletionContentPartTextCacheControl(TypedDict):
    type: Literal['ephemeral']


class ChatCompletionContentPartText(TypedDict):
    text: str
    type: Literal['text']
    cache_control: NotRequired[Optional[ChatCompletionContentPartTextCacheControl]]


class ChatCompletionContentPartTextWithTitleCacheControl(TypedDict):
    type: Literal['ephemeral']


class ChatCompletionContentPartTextWithTitle(TypedDict):
    text: str
    type: Literal['text']
    cache_control: NotRequired[Optional[ChatCompletionContentPartTextWithTitleCacheControl]]


class ChatCompletionMessageParamChatCompletionMessageParam(TypedDict):
    content: Union[str, Sequence[ChatCompletionContentPartText]]
    role: Literal['system']
    name: NotRequired[Optional[str]]


class ChatCompletionMessageParamChatCompletionMessageParam2FunctionCall(TypedDict):
    arguments: str
    name: str


class ChatCompletionMessageParamChatCompletionMessageParam3(TypedDict):
    content: Union[str, Sequence[ChatCompletionContentPartText]]
    role: Literal['tool']
    tool_call_id: str


class ChatCompletionMessageParamChatCompletionMessageParam4(TypedDict):
    content: Optional[str]
    name: str
    role: Literal['function']


class ChatCompletionMessageParamChatCompletionMessageParam5(TypedDict):
    content: Union[str, Sequence[ChatCompletionContentPartText]]
    role: Literal['developer']
    name: NotRequired[Optional[str]]


class ChatCompletionMessageParamChatCompletionMessageParam6(TypedDict):
    role: Literal['model']
    content: NotRequired[Optional[str]]


class ChatCompletionMessageReasoning(TypedDict):
    id: NotRequired[Optional[str]]
    content: NotRequired[Optional[str]]


class ChatCompletionMessageToolCallFunction(TypedDict):
    arguments: str
    name: str


class ChatCompletionMessageToolCall(TypedDict):
    id: str
    function: ChatCompletionMessageToolCallFunction
    type: Literal['function']


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam(TypedDict):
    content: Union[str, Sequence[ChatCompletionContentPartText]]
    role: Literal['system']
    name: NotRequired[Optional[str]]


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam2FunctionCall(TypedDict):
    arguments: str
    name: str


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam2(TypedDict):
    role: Literal['assistant']
    content: NotRequired[Optional[Union[str, Sequence[ChatCompletionContentPartText]]]]
    function_call: NotRequired[Optional[ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam2FunctionCall]]
    name: NotRequired[Optional[str]]
    tool_calls: NotRequired[Optional[Sequence[ChatCompletionMessageToolCall]]]
    reasoning: NotRequired[Optional[Sequence[ChatCompletionMessageReasoning]]]


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam3(TypedDict):
    content: Union[str, Sequence[ChatCompletionContentPartText]]
    role: Literal['tool']
    tool_call_id: str


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam4(TypedDict):
    content: Optional[str]
    name: str
    role: Literal['function']


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam5(TypedDict):
    content: Union[str, Sequence[ChatCompletionContentPartText]]
    role: Literal['developer']
    name: NotRequired[Optional[str]]


class ChatCompletionToolFunction(TypedDict):
    name: str
    description: NotRequired[Optional[str]]
    parameters: NotRequired[Optional[Mapping[str, Any]]]


class ChatCompletionTool(TypedDict):
    function: ChatCompletionToolFunction
    type: Literal['function']


class CodeBundleRuntimeContext(TypedDict):
    runtime: Literal['node', 'python']
    version: str


class CodeBundleLocationPosition(TypedDict):
    type: Literal['task']


class CodeBundleLocationPosition1(TypedDict):
    type: Literal['scorer']
    index: int


class CodeBundleLocation(TypedDict):
    type: Literal['experiment']
    eval_name: str
    position: Union[CodeBundleLocationPosition, CodeBundleLocationPosition1]


class CodeBundleLocation1(TypedDict):
    type: Literal['function']
    index: int


class CodeBundle(TypedDict):
    runtime_context: CodeBundleRuntimeContext
    location: Union[CodeBundleLocation, CodeBundleLocation1]
    bundle_id: str
    preview: NotRequired[Optional[str]]
    """
    A preview of the code
    """


class Dataset(TypedDict):
    id: str
    """
    Unique identifier for the dataset
    """
    project_id: str
    """
    Unique identifier for the project that the dataset belongs under
    """
    name: str
    """
    Name of the dataset. Within a project, dataset names are unique
    """
    description: NotRequired[Optional[str]]
    """
    Textual description of the dataset
    """
    created: NotRequired[Optional[str]]
    """
    Date of dataset creation
    """
    deleted_at: NotRequired[Optional[str]]
    """
    Date of dataset deletion, or null if the dataset is still active
    """
    user_id: NotRequired[Optional[str]]
    """
    Identifies the user who created the dataset
    """
    metadata: NotRequired[Optional[Mapping[str, Any]]]
    """
    User-controlled metadata about the dataset
    """


class DatasetEventMetadata(TypedDict):
    model: NotRequired[Optional[str]]
    """
    The model used for this example
    """


class EnvVar(TypedDict):
    id: str
    """
    Unique identifier for the environment variable
    """
    object_type: Literal['organization', 'project', 'function']
    """
    The type of the object the environment variable is scoped for
    """
    object_id: str
    """
    The id of the object the environment variable is scoped for
    """
    name: str
    """
    The name of the environment variable
    """
    created: NotRequired[Optional[str]]
    """
    Date of environment variable creation
    """
    used: NotRequired[Optional[str]]
    """
    Date the environment variable was last used
    """


class ExperimentEventMetadata(TypedDict):
    model: NotRequired[Optional[str]]
    """
    The model used for this example
    """


class ExperimentEventMetrics(TypedDict):
    start: NotRequired[Optional[float]]
    """
    A unix timestamp recording when the section of code which produced the experiment event started
    """
    end: NotRequired[Optional[float]]
    """
    A unix timestamp recording when the section of code which produced the experiment event finished
    """
    prompt_tokens: NotRequired[Optional[int]]
    """
    The number of tokens in the prompt used to generate the experiment event (only set if this is an LLM span)
    """
    completion_tokens: NotRequired[Optional[int]]
    """
    The number of tokens in the completion generated by the model (only set if this is an LLM span)
    """
    tokens: NotRequired[Optional[int]]
    """
    The total number of tokens in the input and output of the experiment event.
    """
    caller_functionname: NotRequired[Optional[Any]]
    """
    This metric is deprecated
    """
    caller_filename: NotRequired[Optional[Any]]
    """
    This metric is deprecated
    """
    caller_lineno: NotRequired[Optional[Any]]
    """
    This metric is deprecated
    """


class ExperimentEventContext(TypedDict):
    caller_functionname: NotRequired[Optional[str]]
    """
    The function in code which created the experiment event
    """
    caller_filename: NotRequired[Optional[str]]
    """
    Name of the file in code where the experiment event was created
    """
    caller_lineno: NotRequired[Optional[int]]
    """
    Line of code where the experiment event was created
    """


class ExtendedSavedFunctionIdExtendedSavedFunctionId(TypedDict):
    type: Literal['function']
    id: str


class ExtendedSavedFunctionIdExtendedSavedFunctionId1(TypedDict):
    type: Literal['global']
    name: str


class ExtendedSavedFunctionIdExtendedSavedFunctionId2(TypedDict):
    type: Literal['slug']
    project_id: str
    slug: str


ExtendedSavedFunctionId = Union[
    ExtendedSavedFunctionIdExtendedSavedFunctionId,
    ExtendedSavedFunctionIdExtendedSavedFunctionId1,
    ExtendedSavedFunctionIdExtendedSavedFunctionId2,
]


class ExternalAttachmentReference(TypedDict):
    type: Literal['external_attachment']
    """
    An identifier to help disambiguate parsing.
    """
    filename: str
    """
    Human-readable filename for user interfaces. Not related to attachment storage.
    """
    content_type: str
    """
    MIME type of this file.
    """
    url: str
    """
    Fully qualified URL to the object in the external object store.
    """


class FunctionOrigin(TypedDict):
    object_type: Optional[AclObjectType]
    object_id: str
    """
    Id of the object the function is originating from
    """
    internal: NotRequired[Optional[bool]]
    """
    The function exists for internal purposes and should not be displayed in the list of functions.
    """


class FunctionFunctionSchema(TypedDict):
    parameters: NotRequired[Optional[Any]]
    returns: NotRequired[Optional[Any]]


class FunctionDataFunctionData(TypedDict):
    type: Literal['prompt']


class Data(CodeBundle):
    type: Literal['bundle']


class FunctionDataFunctionData1DataRuntimeContext(TypedDict):
    runtime: Literal['node', 'python']
    version: str


class FunctionDataFunctionData1Data(TypedDict):
    type: Literal['inline']
    runtime_context: FunctionDataFunctionData1DataRuntimeContext
    code: str


class FunctionDataFunctionData1(TypedDict):
    type: Literal['code']
    data: Union[Data, FunctionDataFunctionData1Data]


class FunctionDataFunctionData2(TypedDict):
    type: Literal['remote_eval']
    endpoint: str
    eval_name: str
    parameters: Mapping[str, Any]


class FunctionDataFunctionData3(TypedDict):
    type: Literal['global']
    name: str


FunctionFormat = Literal['llm', 'code', 'global', 'graph']


class FunctionIdFunctionId(TypedDict):
    function_id: str
    """
    The ID of the function
    """
    version: NotRequired[Optional[str]]
    """
    The version of the function
    """


class FunctionIdFunctionId1(TypedDict):
    project_name: str
    """
    The name of the project containing the function
    """
    slug: str
    """
    The slug of the function
    """
    version: NotRequired[Optional[str]]
    """
    The version of the function
    """


class FunctionIdFunctionId2(TypedDict):
    global_function: str
    """
    The name of the global function. Currently, the global namespace includes the functions in autoevals
    """


class FunctionIdFunctionId3(TypedDict):
    prompt_session_id: str
    """
    The ID of the prompt session
    """
    prompt_session_function_id: str
    """
    The ID of the function in the prompt session
    """
    version: NotRequired[Optional[str]]
    """
    The version of the function
    """


class FunctionIdFunctionId4InlineContext(TypedDict):
    runtime: Literal['node', 'python']
    version: str


class FunctionIdFunctionId4(TypedDict):
    inline_context: FunctionIdFunctionId4InlineContext
    code: str
    """
    The inline code to execute
    """
    name: NotRequired[Optional[str]]
    """
    The name of the inline code function
    """


FunctionIdRef = Optional[Mapping[str, Any]]


FunctionObjectType = Literal['prompt', 'tool', 'scorer', 'task', 'agent']


FunctionOutputType = Literal['completion', 'score', 'any']


FunctionTypeEnum = Literal['llm', 'scorer', 'task', 'tool']


FunctionTypeEnumNullish = Literal['llm', 'scorer', 'task', 'tool']


class GitMetadataSettings(TypedDict):
    collect: Literal['all', 'none', 'some']
    fields: NotRequired[
        Sequence[
            Literal[
                'commit',
                'branch',
                'tag',
                'dirty',
                'author_name',
                'author_email',
                'commit_message',
                'commit_time',
                'git_diff',
            ]
        ]
    ]


class GraphEdgeSource(TypedDict):
    node: str
    """
    The id of the node in the graph
    """
    variable: str


class GraphEdgeTarget(TypedDict):
    node: str
    """
    The id of the node in the graph
    """
    variable: str


class GraphEdge(TypedDict):
    source: GraphEdgeSource
    target: GraphEdgeTarget
    purpose: Literal['control', 'data', 'messages']
    """
    The purpose of the edge
    """


class GraphNodeGraphNodePosition(TypedDict):
    x: float
    """
    The x position of the node
    """
    y: float
    """
    The y position of the node
    """


class GraphNodeGraphNode(TypedDict):
    description: NotRequired[Optional[str]]
    """
    The description of the node
    """
    position: NotRequired[Optional[GraphNodeGraphNodePosition]]
    """
    The position of the node
    """
    type: Literal['function']
    function: FunctionIdRef


class GraphNodeGraphNode1Position(TypedDict):
    x: float
    """
    The x position of the node
    """
    y: float
    """
    The y position of the node
    """


class GraphNodeGraphNode1(TypedDict):
    description: NotRequired[Optional[str]]
    """
    The description of the node
    """
    position: NotRequired[Optional[GraphNodeGraphNode1Position]]
    """
    The position of the node
    """
    type: Literal['input']
    """
    The input to the graph
    """


class GraphNodeGraphNode2Position(TypedDict):
    x: float
    """
    The x position of the node
    """
    y: float
    """
    The y position of the node
    """


class GraphNodeGraphNode2(TypedDict):
    description: NotRequired[Optional[str]]
    """
    The description of the node
    """
    position: NotRequired[Optional[GraphNodeGraphNode2Position]]
    """
    The position of the node
    """
    type: Literal['output']
    """
    The output of the graph
    """


class GraphNodeGraphNode3Position(TypedDict):
    x: float
    """
    The x position of the node
    """
    y: float
    """
    The y position of the node
    """


class GraphNodeGraphNode3(TypedDict):
    description: NotRequired[Optional[str]]
    """
    The description of the node
    """
    position: NotRequired[Optional[GraphNodeGraphNode3Position]]
    """
    The position of the node
    """
    type: Literal['literal']
    value: NotRequired[Optional[Any]]
    """
    A literal value to be returned
    """


class GraphNodeGraphNode4Position(TypedDict):
    x: float
    """
    The x position of the node
    """
    y: float
    """
    The y position of the node
    """


class GraphNodeGraphNode4(TypedDict):
    description: NotRequired[Optional[str]]
    """
    The description of the node
    """
    position: NotRequired[Optional[GraphNodeGraphNode4Position]]
    """
    The position of the node
    """
    type: Literal['btql']
    expr: str
    """
    A BTQL expression to be evaluated
    """


class GraphNodeGraphNode5Position(TypedDict):
    x: float
    """
    The x position of the node
    """
    y: float
    """
    The y position of the node
    """


class GraphNodeGraphNode5(TypedDict):
    description: NotRequired[Optional[str]]
    """
    The description of the node
    """
    position: NotRequired[Optional[GraphNodeGraphNode5Position]]
    """
    The position of the node
    """
    type: Literal['gate']
    condition: NotRequired[Optional[str]]
    """
    A BTQL expression to be evaluated
    """


class GraphNodeGraphNode6Position(TypedDict):
    x: float
    """
    The x position of the node
    """
    y: float
    """
    The y position of the node
    """


class GraphNodeGraphNode6(TypedDict):
    description: NotRequired[Optional[str]]
    """
    The description of the node
    """
    position: NotRequired[Optional[GraphNodeGraphNode6Position]]
    """
    The position of the node
    """
    type: Literal['aggregator']


class GraphNodeGraphNode7Position(TypedDict):
    x: float
    """
    The x position of the node
    """
    y: float
    """
    The y position of the node
    """


class Group(TypedDict):
    id: str
    """
    Unique identifier for the group
    """
    org_id: str
    """
    Unique id for the organization that the group belongs under

    It is forbidden to change the org after creating a group
    """
    user_id: NotRequired[Optional[str]]
    """
    Identifies the user who created the group
    """
    created: NotRequired[Optional[str]]
    """
    Date of group creation
    """
    name: str
    """
    Name of the group
    """
    description: NotRequired[Optional[str]]
    """
    Textual description of the group
    """
    deleted_at: NotRequired[Optional[str]]
    """
    Date of group deletion, or null if the group is still active
    """
    member_users: NotRequired[Optional[Sequence[str]]]
    """
    Ids of users which belong to this group
    """
    member_groups: NotRequired[Optional[Sequence[str]]]
    """
    Ids of the groups this group inherits from

    An inheriting group has all the users contained in its member groups, as well as all of their inherited users
    """


IfExists = Literal['error', 'ignore', 'replace']


class InvokeParentInvokeParentRowIds(TypedDict):
    id: str
    """
    The id of the row
    """
    span_id: str
    """
    The span_id of the row
    """
    root_span_id: str
    """
    The root_span_id of the row
    """


class InvokeParentInvokeParent(TypedDict):
    object_type: Literal['project_logs', 'experiment', 'playground_logs']
    object_id: str
    """
    The id of the container object you are logging to
    """
    row_ids: NotRequired[Optional[InvokeParentInvokeParentRowIds]]
    """
    Identifiers for the row to to log a subspan under
    """
    propagated_event: NotRequired[Optional[Mapping[str, Any]]]
    """
    Include these properties in every span created under this parent
    """


InvokeParent = Union[InvokeParentInvokeParent, str]


MessageRole = Literal['system', 'user', 'assistant', 'function', 'tool', 'model', 'developer']


class ModelParamsModelParamsToolChoiceFunction(TypedDict):
    name: str


class ModelParamsModelParamsToolChoice(TypedDict):
    type: Literal['function']
    function: ModelParamsModelParamsToolChoiceFunction


class ModelParamsModelParamsFunctionCall(TypedDict):
    name: str


class ModelParamsModelParams1(TypedDict):
    use_cache: NotRequired[Optional[bool]]
    max_tokens: float
    temperature: float
    top_p: NotRequired[Optional[float]]
    top_k: NotRequired[Optional[float]]
    stop_sequences: NotRequired[Optional[Sequence[str]]]
    max_tokens_to_sample: NotRequired[Optional[float]]
    """
    This is a legacy parameter that should not be used.
    """


class ModelParamsModelParams2(TypedDict):
    use_cache: NotRequired[Optional[bool]]
    temperature: NotRequired[Optional[float]]
    maxOutputTokens: NotRequired[Optional[float]]
    topP: NotRequired[Optional[float]]
    topK: NotRequired[Optional[float]]


class ModelParamsModelParams3(TypedDict):
    use_cache: NotRequired[Optional[bool]]
    temperature: NotRequired[Optional[float]]
    topK: NotRequired[Optional[float]]


class ModelParamsModelParams4(TypedDict):
    use_cache: NotRequired[Optional[bool]]


class ObjectReference(TypedDict):
    object_type: Literal['project_logs', 'experiment', 'dataset', 'prompt', 'function', 'prompt_session']
    """
    Type of the object the event is originating from.
    """
    object_id: str
    """
    ID of the object the event is originating from.
    """
    id: str
    """
    ID of the original event.
    """
    _xact_id: NotRequired[Optional[str]]
    """
    Transaction ID of the original event.
    """
    created: NotRequired[Optional[str]]
    """
    Created timestamp of the original event. Used to help sort in the UI
    """


class ObjectReferenceNullish(TypedDict):
    object_type: Literal['project_logs', 'experiment', 'dataset', 'prompt', 'function', 'prompt_session']
    """
    Type of the object the event is originating from.
    """
    object_id: str
    """
    ID of the object the event is originating from.
    """
    id: str
    """
    ID of the original event.
    """
    _xact_id: NotRequired[Optional[str]]
    """
    Transaction ID of the original event.
    """
    created: NotRequired[Optional[str]]
    """
    Created timestamp of the original event. Used to help sort in the UI
    """


class Organization(TypedDict):
    id: str
    """
    Unique identifier for the organization
    """
    name: str
    """
    Name of the organization
    """
    api_url: NotRequired[Optional[str]]
    is_universal_api: NotRequired[Optional[bool]]
    proxy_url: NotRequired[Optional[str]]
    realtime_url: NotRequired[Optional[str]]
    created: NotRequired[Optional[str]]
    """
    Date of organization creation
    """


Permission = Literal['create', 'read', 'update', 'delete', 'create_acls', 'read_acls', 'update_acls', 'delete_acls']


class ProjectAutomationConfigAction(TypedDict):
    type: Literal['webhook']
    """
    The type of action to take
    """
    url: str
    """
    The webhook URL to send the request to
    """


class ProjectAutomationConfig(TypedDict):
    event_type: Literal['logs']
    """
    The type of automation.
    """
    btql_filter: str
    """
    BTQL filter to identify rows for the automation rule
    """
    interval_seconds: float
    """
    Perform the triggered action at most once in this interval of seconds
    """
    action: ProjectAutomationConfigAction
    """
    The action to take when the automation rule is triggered
    """


class ProjectAutomationConfig1ExportDefinition(TypedDict):
    type: Literal['log_traces']


class ProjectAutomationConfig1ExportDefinition1(TypedDict):
    type: Literal['log_spans']


class ProjectAutomationConfig1ExportDefinition2(TypedDict):
    type: Literal['btql_query']
    btql_query: str
    """
    The BTQL query to export
    """


class ProjectAutomationConfig1Credentials(TypedDict):
    type: Literal['aws_iam']
    role_arn: str
    """
    The ARN of the IAM role to use
    """
    external_id: str
    """
    The automation-specific external id component (auto-generated by default)
    """


class ProjectAutomationConfig1(TypedDict):
    event_type: Literal['btql_export']
    """
    The type of automation.
    """
    export_definition: Union[
        ProjectAutomationConfig1ExportDefinition,
        ProjectAutomationConfig1ExportDefinition1,
        ProjectAutomationConfig1ExportDefinition2,
    ]
    """
    The definition of what to export
    """
    export_path: str
    """
    The path to export the results to. It should include the storage protocol and prefix, e.g. s3://bucket-name/path/to/export
    """
    format: Literal['jsonl', 'parquet']
    """
    The format to export the results in
    """
    interval_seconds: float
    """
    Perform the triggered action at most once in this interval of seconds
    """
    credentials: ProjectAutomationConfig1Credentials
    batch_size: NotRequired[Optional[float]]
    """
    The number of rows to export in each batch
    """


class ProjectLogsEventMetadata(TypedDict):
    model: NotRequired[Optional[str]]
    """
    The model used for this example
    """


class ProjectLogsEventMetrics(TypedDict):
    start: NotRequired[Optional[float]]
    """
    A unix timestamp recording when the section of code which produced the project logs event started
    """
    end: NotRequired[Optional[float]]
    """
    A unix timestamp recording when the section of code which produced the project logs event finished
    """
    prompt_tokens: NotRequired[Optional[int]]
    """
    The number of tokens in the prompt used to generate the project logs event (only set if this is an LLM span)
    """
    completion_tokens: NotRequired[Optional[int]]
    """
    The number of tokens in the completion generated by the model (only set if this is an LLM span)
    """
    tokens: NotRequired[Optional[int]]
    """
    The total number of tokens in the input and output of the project logs event.
    """
    caller_functionname: NotRequired[Optional[Any]]
    """
    This metric is deprecated
    """
    caller_filename: NotRequired[Optional[Any]]
    """
    This metric is deprecated
    """
    caller_lineno: NotRequired[Optional[Any]]
    """
    This metric is deprecated
    """


class ProjectLogsEventContext(TypedDict):
    caller_functionname: NotRequired[Optional[str]]
    """
    The function in code which created the project logs event
    """
    caller_filename: NotRequired[Optional[str]]
    """
    Name of the file in code where the project logs event was created
    """
    caller_lineno: NotRequired[Optional[int]]
    """
    Line of code where the project logs event was created
    """


class ProjectScoreCategory(TypedDict):
    name: str
    """
    Name of the category
    """
    value: float
    """
    Numerical value of the category. Must be between 0 and 1, inclusive
    """


ProjectScoreType = Literal['slider', 'categorical', 'weighted', 'minimum', 'maximum', 'online', 'free-form']


class ProjectSettingsSpanFieldOrderItem(TypedDict):
    object_type: str
    column_id: str
    position: str
    layout: NotRequired[Optional[Union[Literal['full'], Literal['two_column']]]]


class ProjectSettingsRemoteEvalSource(TypedDict):
    url: str
    name: str
    description: NotRequired[Optional[str]]


class ProjectSettings(TypedDict):
    comparison_key: NotRequired[Optional[str]]
    """
    The key used to join two experiments (defaults to `input`)
    """
    baseline_experiment_id: NotRequired[Optional[str]]
    """
    The id of the experiment to use as the default baseline for comparisons
    """
    spanFieldOrder: NotRequired[Optional[Sequence[ProjectSettingsSpanFieldOrderItem]]]
    """
    The order of the fields to display in the trace view
    """
    remote_eval_sources: NotRequired[Optional[Sequence[ProjectSettingsRemoteEvalSource]]]
    """
    The remote eval sources to use for the project
    """


class ProjectTag(TypedDict):
    id: str
    """
    Unique identifier for the project tag
    """
    project_id: str
    """
    Unique identifier for the project that the project tag belongs under
    """
    user_id: str
    created: NotRequired[Optional[str]]
    """
    Date of project tag creation
    """
    name: str
    """
    Name of the project tag
    """
    description: NotRequired[Optional[str]]
    """
    Textual description of the project tag
    """
    color: NotRequired[Optional[str]]
    """
    Color of the tag for the UI
    """
    position: NotRequired[Optional[str]]
    """
    An optional LexoRank-based string that sets the sort position for the tag in the UI
    """


class PromptBlockDataPromptBlockData(TypedDict):
    type: Literal['completion']
    content: str


class PromptBlockDataNullishPromptBlockDataNullish(TypedDict):
    type: Literal['completion']
    content: str


class PromptDataOrigin(TypedDict):
    prompt_id: NotRequired[Optional[str]]
    project_id: NotRequired[Optional[str]]
    prompt_version: NotRequired[Optional[str]]


class PromptDataNullishOrigin(TypedDict):
    prompt_id: NotRequired[Optional[str]]
    project_id: NotRequired[Optional[str]]
    prompt_version: NotRequired[Optional[str]]


class PromptParserNullish(TypedDict):
    type: Literal['llm_classifier']
    use_cot: bool
    choice_scores: Mapping[str, float]


class PromptSessionEvent(TypedDict):
    id: str
    """
    A unique identifier for the prompt session event. If you don't provide one, Braintrust will generate one for you
    """
    _xact_id: str
    """
    The transaction id of an event is unique to the network operation that processed the event insertion. Transaction ids are monotonically increasing over time and can be used to retrieve a versioned snapshot of the prompt session (see the `version` parameter)
    """
    created: str
    """
    The timestamp the prompt session event was created
    """
    _pagination_key: NotRequired[Optional[str]]
    """
    A stable, time-ordered key that can be used to paginate over prompt session events. This field is auto-generated by Braintrust and only exists in Brainstore.
    """
    project_id: str
    """
    Unique identifier for the project that the prompt belongs under
    """
    prompt_session_id: str
    """
    Unique identifier for the prompt
    """
    prompt_session_data: NotRequired[Optional[Any]]
    """
    Data about the prompt session
    """
    prompt_data: NotRequired[Optional[Any]]
    """
    Data about the prompt
    """
    function_data: NotRequired[Optional[Any]]
    """
    Data about the function
    """
    function_type: NotRequired[Optional[FunctionTypeEnumNullish]]
    object_data: NotRequired[Optional[Any]]
    """
    Data about the mapped data
    """
    completion: NotRequired[Optional[Any]]
    """
    Data about the completion
    """
    tags: NotRequired[Optional[Sequence[str]]]
    """
    A list of tags to log
    """


class RepoInfo(TypedDict):
    commit: NotRequired[Optional[str]]
    """
    SHA of most recent commit
    """
    branch: NotRequired[Optional[str]]
    """
    Name of the branch the most recent commit belongs to
    """
    tag: NotRequired[Optional[str]]
    """
    Name of the tag on the most recent commit
    """
    dirty: NotRequired[Optional[bool]]
    """
    Whether or not the repo had uncommitted changes when snapshotted
    """
    author_name: NotRequired[Optional[str]]
    """
    Name of the author of the most recent commit
    """
    author_email: NotRequired[Optional[str]]
    """
    Email of the author of the most recent commit
    """
    commit_message: NotRequired[Optional[str]]
    """
    Most recent commit message
    """
    commit_time: NotRequired[Optional[str]]
    """
    Time of the most recent commit
    """
    git_diff: NotRequired[Optional[str]]
    """
    If the repo was dirty when run, this includes the diff between the current state of the repo and the most recent commit.
    """


class ResponseFormatResponseFormat(TypedDict):
    type: Literal['json_object']


class ResponseFormatResponseFormat2(TypedDict):
    type: Literal['text']


class ResponseFormatJsonSchema(TypedDict):
    name: str
    description: NotRequired[Optional[str]]
    schema: NotRequired[Optional[Union[Mapping[str, Any], str]]]
    strict: NotRequired[Optional[bool]]


class ResponseFormatNullishResponseFormatNullish(TypedDict):
    type: Literal['json_object']


class ResponseFormatNullishResponseFormatNullish1(TypedDict):
    type: Literal['json_schema']
    json_schema: ResponseFormatJsonSchema


class ResponseFormatNullishResponseFormatNullish2(TypedDict):
    type: Literal['text']


ResponseFormatNullish = Optional[
    Union[
        ResponseFormatNullishResponseFormatNullish,
        ResponseFormatNullishResponseFormatNullish1,
        ResponseFormatNullishResponseFormatNullish2,
    ]
]


RetentionObjectType = Literal['project_logs', 'experiment', 'dataset']


class RoleMemberPermission(TypedDict):
    permission: Permission
    restrict_object_type: NotRequired[Optional[AclObjectType]]


class Role(TypedDict):
    id: str
    """
    Unique identifier for the role
    """
    org_id: NotRequired[Optional[str]]
    """
    Unique id for the organization that the role belongs under

    A null org_id indicates a system role, which may be assigned to anybody and inherited by any other role, but cannot be edited.

    It is forbidden to change the org after creating a role
    """
    user_id: NotRequired[Optional[str]]
    """
    Identifies the user who created the role
    """
    created: NotRequired[Optional[str]]
    """
    Date of role creation
    """
    name: str
    """
    Name of the role
    """
    description: NotRequired[Optional[str]]
    """
    Textual description of the role
    """
    deleted_at: NotRequired[Optional[str]]
    """
    Date of role deletion, or null if the role is still active
    """
    member_permissions: NotRequired[Optional[Sequence[RoleMemberPermission]]]
    """
    (permission, restrict_object_type) tuples which belong to this role
    """
    member_roles: NotRequired[Optional[Sequence[str]]]
    """
    Ids of the roles this role inherits from

    An inheriting role has all the permissions contained in its member roles, as well as all of their inherited permissions
    """


class RunEvalData(TypedDict):
    dataset_id: str
    _internal_btql: NotRequired[Optional[Mapping[str, Any]]]


class RunEvalData1(TypedDict):
    project_name: str
    dataset_name: str
    _internal_btql: NotRequired[Optional[Mapping[str, Any]]]


class RunEvalData2(TypedDict):
    data: Sequence


class SavedFunctionIdSavedFunctionId(TypedDict):
    type: Literal['function']
    id: str


class SavedFunctionIdSavedFunctionId1(TypedDict):
    type: Literal['global']
    name: str


SavedFunctionId = Union[SavedFunctionIdSavedFunctionId, SavedFunctionIdSavedFunctionId1]


class ServiceToken(TypedDict):
    id: str
    """
    Unique identifier for the service token
    """
    created: NotRequired[Optional[str]]
    """
    Date of service token creation
    """
    name: str
    """
    Name of the service token
    """
    preview_name: str
    service_account_id: NotRequired[Optional[str]]
    """
    Unique identifier for the service token
    """
    service_account_email: NotRequired[Optional[str]]
    """
    The service account email (not routable)
    """
    service_account_name: NotRequired[Optional[str]]
    """
    The service account name
    """
    org_id: NotRequired[Optional[str]]
    """
    Unique identifier for the organization
    """


class SpanIFrame(TypedDict):
    id: str
    """
    Unique identifier for the span iframe
    """
    project_id: str
    """
    Unique identifier for the project that the span iframe belongs under
    """
    user_id: NotRequired[Optional[str]]
    """
    Identifies the user who created the span iframe
    """
    created: NotRequired[Optional[str]]
    """
    Date of span iframe creation
    """
    deleted_at: NotRequired[Optional[str]]
    """
    Date of span iframe deletion, or null if the span iframe is still active
    """
    name: str
    """
    Name of the span iframe
    """
    description: NotRequired[Optional[str]]
    """
    Textual description of the span iframe
    """
    url: str
    """
    URL to embed the project viewer in an iframe
    """
    post_message: NotRequired[Optional[bool]]
    """
    Whether to post messages to the iframe containing the span's data. This is useful when you want to render more data than fits in the URL.
    """


SpanType = Literal['llm', 'score', 'function', 'eval', 'task', 'tool']


class SSEConsoleEventData(TypedDict):
    stream: Literal['stderr', 'stdout']
    message: str


class SSEProgressEventData(TypedDict):
    id: str
    """
    The id of the span this event is for
    """
    object_type: FunctionObjectType
    origin: NotRequired[Optional[ObjectReferenceNullish]]
    format: FunctionFormat
    output_type: FunctionOutputType
    name: str
    event: Literal['reasoning_delta', 'text_delta', 'json_delta', 'error', 'console', 'start', 'done', 'progress']
    data: str


StreamingMode = Literal['auto', 'parallel']


class ToolFunctionDefinitionFunction(TypedDict):
    name: str
    description: NotRequired[Optional[str]]
    parameters: NotRequired[Optional[Mapping[str, Any]]]
    strict: NotRequired[Optional[bool]]


class ToolFunctionDefinition(TypedDict):
    type: Literal['function']
    function: ToolFunctionDefinitionFunction


UploadStatus = Literal['uploading', 'done', 'error']


class User(TypedDict):
    id: str
    """
    Unique identifier for the user
    """
    given_name: NotRequired[Optional[str]]
    """
    Given name of the user
    """
    family_name: NotRequired[Optional[str]]
    """
    Family name of the user
    """
    email: NotRequired[Optional[str]]
    """
    The user's email
    """
    avatar_url: NotRequired[Optional[str]]
    """
    URL of the user's Avatar image
    """
    created: NotRequired[Optional[str]]
    """
    Date of user creation
    """


class ViewDataSearch(TypedDict):
    filter: NotRequired[Optional[Sequence[Any]]]
    tag: NotRequired[Optional[Sequence[Any]]]
    match: NotRequired[Optional[Sequence[Any]]]
    sort: NotRequired[Optional[Sequence[Any]]]


class ViewOptionsViewOptionsOptions(TypedDict):
    spanType: NotRequired[Optional[Literal['range', 'frame']]]
    rangeValue: NotRequired[Optional[str]]
    frameStart: NotRequired[Optional[str]]
    frameEnd: NotRequired[Optional[str]]
    tzUTC: NotRequired[Optional[bool]]
    chartVisibility: NotRequired[Optional[Mapping[str, Any]]]
    projectId: NotRequired[Optional[str]]
    type: NotRequired[Optional[Literal['project', 'experiment']]]
    groupBy: NotRequired[Optional[str]]


class ViewOptionsViewOptions(TypedDict):
    viewType: Literal['monitor']
    options: ViewOptionsViewOptionsOptions


class ViewOptionsViewOptions1ExcludedMeasure(TypedDict):
    type: Literal['none', 'score', 'metric', 'metadata']
    value: str


class ViewOptionsViewOptions1YMetric(TypedDict):
    type: Literal['none', 'score', 'metric', 'metadata']
    value: str


class ViewOptionsViewOptions1XAxis(TypedDict):
    type: Literal['none', 'score', 'metric', 'metadata']
    value: str


class ViewOptionsViewOptions1SymbolGrouping(TypedDict):
    type: Literal['none', 'score', 'metric', 'metadata']
    value: str


class ViewOptionsViewOptions1ChartAnnotation(TypedDict):
    id: str
    text: str


ViewOptionsViewOptions1TimeRangeFilter = TypedDict(
    'ViewOptionsViewOptions1TimeRangeFilter',
    {
        'from': str,
        'to': str,
    },
)


class ViewOptionsViewOptions1(TypedDict):
    columnVisibility: NotRequired[Optional[Mapping[str, Any]]]
    columnOrder: NotRequired[Optional[Sequence[str]]]
    columnSizing: NotRequired[Optional[Mapping[str, Any]]]
    grouping: NotRequired[Optional[str]]
    rowHeight: NotRequired[Optional[str]]
    tallGroupRows: NotRequired[Optional[bool]]
    layout: NotRequired[Optional[str]]
    chartHeight: NotRequired[Optional[float]]
    excludedMeasures: NotRequired[Optional[Sequence[ViewOptionsViewOptions1ExcludedMeasure]]]
    yMetric: NotRequired[Optional[ViewOptionsViewOptions1YMetric]]
    xAxis: NotRequired[Optional[ViewOptionsViewOptions1XAxis]]
    symbolGrouping: NotRequired[Optional[ViewOptionsViewOptions1SymbolGrouping]]
    xAxisAggregation: NotRequired[Optional[str]]
    """
    One of 'avg', 'sum', 'min', 'max', 'median', 'all'
    """
    chartAnnotations: NotRequired[Optional[Sequence[ViewOptionsViewOptions1ChartAnnotation]]]
    timeRangeFilter: NotRequired[Optional[Union[str, ViewOptionsViewOptions1TimeRangeFilter]]]


ViewOptions = Optional[Union[ViewOptionsViewOptions, ViewOptionsViewOptions1]]


class Acl(TypedDict):
    id: str
    """
    Unique identifier for the acl
    """
    object_type: Optional[AclObjectType]
    object_id: str
    """
    The id of the object the ACL applies to
    """
    user_id: NotRequired[Optional[str]]
    """
    Id of the user the ACL applies to. Exactly one of `user_id` and `group_id` will be provided
    """
    group_id: NotRequired[Optional[str]]
    """
    Id of the group the ACL applies to. Exactly one of `user_id` and `group_id` will be provided
    """
    permission: NotRequired[Optional[Permission]]
    restrict_object_type: NotRequired[Optional[AclObjectType]]
    role_id: NotRequired[Optional[str]]
    """
    Id of the role the ACL grants. Exactly one of `permission` and `role_id` will be provided
    """
    _object_org_id: str
    """
    The organization the ACL's referred object belongs to
    """
    created: NotRequired[Optional[str]]
    """
    Date of acl creation
    """


class AnyModelParams(TypedDict):
    temperature: NotRequired[Optional[float]]
    top_p: NotRequired[Optional[float]]
    max_tokens: float
    max_completion_tokens: NotRequired[Optional[float]]
    """
    The successor to max_tokens
    """
    frequency_penalty: NotRequired[Optional[float]]
    presence_penalty: NotRequired[Optional[float]]
    response_format: NotRequired[Optional[ResponseFormatNullish]]
    tool_choice: NotRequired[Optional[Union[Literal['auto'], Literal['none'], Literal['required'], AnyModelParamsToolChoice]]]
    function_call: NotRequired[Optional[Union[Literal['auto'], Literal['none'], AnyModelParamsFunctionCall]]]
    n: NotRequired[Optional[float]]
    stop: NotRequired[Optional[Sequence[str]]]
    reasoning_effort: NotRequired[Optional[Literal['minimal', 'low', 'medium', 'high']]]
    verbosity: NotRequired[Optional[Literal['low', 'medium', 'high']]]
    top_k: NotRequired[Optional[float]]
    stop_sequences: NotRequired[Optional[Sequence[str]]]
    max_tokens_to_sample: NotRequired[Optional[float]]
    """
    This is a legacy parameter that should not be used.
    """
    maxOutputTokens: NotRequired[Optional[float]]
    topP: NotRequired[Optional[float]]
    topK: NotRequired[Optional[float]]
    use_cache: NotRequired[Optional[bool]]


class AsyncScoringControlAsyncScoringControl1(TypedDict):
    kind: Literal['state_override']
    state: AsyncScoringState


AsyncScoringControl = Union[
    AsyncScoringControlAsyncScoringControl,
    AsyncScoringControlAsyncScoringControl1,
    AsyncScoringControlAsyncScoringControl2,
    AsyncScoringControlAsyncScoringControl3,
]


AttachmentReference = Union[BraintrustAttachmentReference, ExternalAttachmentReference]


class AttachmentStatus(TypedDict):
    upload_status: UploadStatus
    error_message: NotRequired[Optional[str]]
    """
    Describes the error encountered while uploading.
    """


ChatCompletionContentPart = Union[ChatCompletionContentPartTextWithTitle, ChatCompletionContentPartImageWithTitle]


class ChatCompletionMessageParamChatCompletionMessageParam1(TypedDict):
    content: Union[str, Sequence[ChatCompletionContentPart]]
    role: Literal['user']
    name: NotRequired[Optional[str]]


class ChatCompletionMessageParamChatCompletionMessageParam2(TypedDict):
    role: Literal['assistant']
    content: NotRequired[Optional[Union[str, Sequence[ChatCompletionContentPartText]]]]
    function_call: NotRequired[Optional[ChatCompletionMessageParamChatCompletionMessageParam2FunctionCall]]
    name: NotRequired[Optional[str]]
    tool_calls: NotRequired[Optional[Sequence[ChatCompletionMessageToolCall]]]
    reasoning: NotRequired[Optional[Sequence[ChatCompletionMessageReasoning]]]


ChatCompletionMessageParam = Union[
    ChatCompletionMessageParamChatCompletionMessageParam,
    ChatCompletionMessageParamChatCompletionMessageParam1,
    ChatCompletionMessageParamChatCompletionMessageParam2,
    ChatCompletionMessageParamChatCompletionMessageParam3,
    ChatCompletionMessageParamChatCompletionMessageParam4,
    ChatCompletionMessageParamChatCompletionMessageParam5,
    ChatCompletionMessageParamChatCompletionMessageParam6,
]


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam1(TypedDict):
    content: Union[str, Sequence[ChatCompletionContentPart]]
    role: Literal['user']
    name: NotRequired[Optional[str]]


ChatCompletionOpenAIMessageParam = Union[
    ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam,
    ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam1,
    ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam2,
    ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam3,
    ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam4,
    ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam5,
]


class DatasetEvent(TypedDict):
    id: str
    """
    A unique identifier for the dataset event. If you don't provide one, Braintrust will generate one for you
    """
    _xact_id: str
    """
    The transaction id of an event is unique to the network operation that processed the event insertion. Transaction ids are monotonically increasing over time and can be used to retrieve a versioned snapshot of the dataset (see the `version` parameter)
    """
    created: str
    """
    The timestamp the dataset event was created
    """
    _pagination_key: NotRequired[Optional[str]]
    """
    A stable, time-ordered key that can be used to paginate over dataset events. This field is auto-generated by Braintrust and only exists in Brainstore.
    """
    project_id: str
    """
    Unique identifier for the project that the dataset belongs under
    """
    dataset_id: str
    """
    Unique identifier for the dataset
    """
    input: NotRequired[Optional[Any]]
    """
    The argument that uniquely define an input case (an arbitrary, JSON serializable object)
    """
    expected: NotRequired[Optional[Any]]
    """
    The output of your application, including post-processing (an arbitrary, JSON serializable object)
    """
    metadata: NotRequired[Optional[DatasetEventMetadata]]
    """
    A dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings
    """
    tags: NotRequired[Optional[Sequence[str]]]
    """
    A list of tags to log
    """
    span_id: str
    """
    A unique identifier used to link different dataset events together as part of a full trace. See the [tracing guide](https://www.braintrust.dev/docs/guides/tracing) for full details on tracing
    """
    root_span_id: str
    """
    A unique identifier for the trace this dataset event belongs to
    """
    is_root: NotRequired[Optional[bool]]
    """
    Whether this span is a root span
    """
    origin: NotRequired[Optional[ObjectReferenceNullish]]


class Experiment(TypedDict):
    id: str
    """
    Unique identifier for the experiment
    """
    project_id: str
    """
    Unique identifier for the project that the experiment belongs under
    """
    name: str
    """
    Name of the experiment. Within a project, experiment names are unique
    """
    description: NotRequired[Optional[str]]
    """
    Textual description of the experiment
    """
    created: NotRequired[Optional[str]]
    """
    Date of experiment creation
    """
    repo_info: NotRequired[Optional[RepoInfo]]
    commit: NotRequired[Optional[str]]
    """
    Commit, taken directly from `repo_info.commit`
    """
    base_exp_id: NotRequired[Optional[str]]
    """
    Id of default base experiment to compare against when viewing this experiment
    """
    deleted_at: NotRequired[Optional[str]]
    """
    Date of experiment deletion, or null if the experiment is still active
    """
    dataset_id: NotRequired[Optional[str]]
    """
    Identifier of the linked dataset, or null if the experiment is not linked to a dataset
    """
    dataset_version: NotRequired[Optional[str]]
    """
    Version number of the linked dataset the experiment was run against. This can be used to reproduce the experiment after the dataset has been modified.
    """
    public: bool
    """
    Whether or not the experiment is public. Public experiments can be viewed by anybody inside or outside the organization
    """
    user_id: NotRequired[Optional[str]]
    """
    Identifies the user who created the experiment
    """
    metadata: NotRequired[Optional[Mapping[str, Any]]]
    """
    User-controlled metadata about the experiment
    """
    tags: NotRequired[Optional[Sequence[str]]]
    """
    A list of tags for the experiment
    """


class ModelParamsModelParams(TypedDict):
    use_cache: NotRequired[Optional[bool]]
    temperature: NotRequired[Optional[float]]
    top_p: NotRequired[Optional[float]]
    max_tokens: NotRequired[Optional[float]]
    max_completion_tokens: NotRequired[Optional[float]]
    """
    The successor to max_tokens
    """
    frequency_penalty: NotRequired[Optional[float]]
    presence_penalty: NotRequired[Optional[float]]
    response_format: NotRequired[Optional[ResponseFormatNullish]]
    tool_choice: NotRequired[
        Union[Literal['auto'], Literal['none'], Literal['required'], ModelParamsModelParamsToolChoice]
    ]
    function_call: NotRequired[Optional[Union[Literal['auto'], Literal['none'], ModelParamsModelParamsFunctionCall]]]
    n: NotRequired[Optional[float]]
    stop: NotRequired[Optional[Sequence[str]]]
    reasoning_effort: NotRequired[Optional[Literal['minimal', 'low', 'medium', 'high']]]
    verbosity: NotRequired[Optional[Literal['low', 'medium', 'high']]]


ModelParams = Union[
    ModelParamsModelParams,
    ModelParamsModelParams1,
    ModelParamsModelParams2,
    ModelParamsModelParams3,
    ModelParamsModelParams4,
]


class OnlineScoreConfig(TypedDict):
    sampling_rate: float
    """
    The sampling rate for online scoring
    """
    scorers: Sequence[SavedFunctionId]
    """
    The list of scorers to use for online scoring
    """
    btql_filter: NotRequired[Optional[str]]
    """
    Filter logs using BTQL
    """
    apply_to_root_span: NotRequired[Optional[bool]]
    """
    Whether to trigger online scoring on the root span of each trace
    """
    apply_to_span_names: NotRequired[Optional[Sequence[str]]]
    """
    Trigger online scoring on any spans with a name in this list
    """
    skip_logging: NotRequired[Optional[bool]]
    """
    Whether to skip adding scorer spans when computing scores
    """


class Project(TypedDict):
    id: str
    """
    Unique identifier for the project
    """
    org_id: str
    """
    Unique id for the organization that the project belongs under
    """
    name: str
    """
    Name of the project
    """
    created: NotRequired[Optional[str]]
    """
    Date of project creation
    """
    deleted_at: NotRequired[Optional[str]]
    """
    Date of project deletion, or null if the project is still active
    """
    user_id: NotRequired[Optional[str]]
    """
    Identifies the user who created the project
    """
    settings: NotRequired[Optional[ProjectSettings]]


class ProjectAutomationConfig2(TypedDict):
    event_type: Literal['retention']
    """
    The type of automation.
    """
    object_type: RetentionObjectType
    retention_days: float
    """
    The number of days to retain the object
    """


class ProjectAutomation(TypedDict):
    id: str
    """
    Unique identifier for the project automation
    """
    project_id: str
    """
    Unique identifier for the project that the project automation belongs under
    """
    user_id: NotRequired[Optional[str]]
    """
    Identifies the user who created the project automation
    """
    created: NotRequired[Optional[str]]
    """
    Date of project automation creation
    """
    name: str
    """
    Name of the project automation
    """
    description: NotRequired[Optional[str]]
    """
    Textual description of the project automation
    """
    config: Union[ProjectAutomationConfig, ProjectAutomationConfig1, ProjectAutomationConfig2]
    """
    The configuration for the automation rule
    """


ProjectScoreCategories = Optional[Union[Sequence[ProjectScoreCategory], Mapping[str, float], Sequence[str]]]


class ProjectScoreConfig(TypedDict):
    multi_select: NotRequired[Optional[bool]]
    destination: NotRequired[Optional[str]]
    online: NotRequired[Optional[OnlineScoreConfig]]


class PromptBlockDataPromptBlockData1(TypedDict):
    type: Literal['chat']
    messages: Sequence[ChatCompletionMessageParam]
    tools: NotRequired[Optional[str]]


PromptBlockData = Union[PromptBlockDataPromptBlockData, PromptBlockDataPromptBlockData1]


class PromptBlockDataNullishPromptBlockDataNullish1(TypedDict):
    type: Literal['chat']
    messages: Sequence[ChatCompletionMessageParam]
    tools: NotRequired[Optional[str]]


PromptBlockDataNullish = Optional[
    Union[PromptBlockDataNullishPromptBlockDataNullish, PromptBlockDataNullishPromptBlockDataNullish1]
]


class PromptOptions(TypedDict):
    model: NotRequired[Optional[str]]
    params: NotRequired[Optional[ModelParams]]
    position: NotRequired[Optional[str]]


class PromptOptionsNullish(TypedDict):
    model: NotRequired[Optional[str]]
    params: NotRequired[Optional[ModelParams]]
    position: NotRequired[Optional[str]]


class ResponseFormatResponseFormat1(TypedDict):
    type: Literal['json_schema']
    json_schema: ResponseFormatJsonSchema


ResponseFormat = Union[ResponseFormatResponseFormat, ResponseFormatResponseFormat1, ResponseFormatResponseFormat2]


class SpanAttributes(TypedDict):
    name: NotRequired[Optional[str]]
    """
    Name of the span, for display purposes only
    """
    type: NotRequired[Optional[SpanType]]


class ViewData(TypedDict):
    search: NotRequired[Optional[ViewDataSearch]]


class ExperimentEvent(TypedDict):
    id: str
    """
    A unique identifier for the experiment event. If you don't provide one, Braintrust will generate one for you
    """
    _xact_id: str
    """
    The transaction id of an event is unique to the network operation that processed the event insertion. Transaction ids are monotonically increasing over time and can be used to retrieve a versioned snapshot of the experiment (see the `version` parameter)
    """
    created: str
    """
    The timestamp the experiment event was created
    """
    _pagination_key: NotRequired[Optional[str]]
    """
    A stable, time-ordered key that can be used to paginate over experiment events. This field is auto-generated by Braintrust and only exists in Brainstore.
    """
    project_id: str
    """
    Unique identifier for the project that the experiment belongs under
    """
    experiment_id: str
    """
    Unique identifier for the experiment
    """
    input: NotRequired[Optional[Any]]
    """
    The arguments that uniquely define a test case (an arbitrary, JSON serializable object). Later on, Braintrust will use the `input` to know whether two test cases are the same between experiments, so they should not contain experiment-specific state. A simple rule of thumb is that if you run the same experiment twice, the `input` should be identical
    """
    output: NotRequired[Optional[Any]]
    """
    The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question
    """
    expected: NotRequired[Optional[Any]]
    """
    The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate your experiments while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models
    """
    error: NotRequired[Optional[Any]]
    """
    The error that occurred, if any.
    """
    scores: NotRequired[Optional[Mapping[str, Any]]]
    """
    A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare experiments
    """
    metadata: NotRequired[Optional[ExperimentEventMetadata]]
    """
    A dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings
    """
    tags: NotRequired[Optional[Sequence[str]]]
    """
    A list of tags to log
    """
    metrics: NotRequired[Optional[ExperimentEventMetrics]]
    """
    Metrics are numerical measurements tracking the execution of the code that produced the experiment event. Use "start" and "end" to track the time span over which the experiment event was produced
    """
    context: NotRequired[Optional[ExperimentEventContext]]
    """
    Context is additional information about the code that produced the experiment event. It is essentially the textual counterpart to `metrics`. Use the `caller_*` attributes to track the location in code which produced the experiment event
    """
    span_id: str
    """
    A unique identifier used to link different experiment events together as part of a full trace. See the [tracing guide](https://www.braintrust.dev/docs/guides/tracing) for full details on tracing
    """
    span_parents: NotRequired[Optional[Sequence[str]]]
    """
    An array of the parent `span_ids` of this experiment event. This should be empty for the root span of a trace, and should most often contain just one parent element for subspans
    """
    root_span_id: str
    """
    A unique identifier for the trace this experiment event belongs to
    """
    span_attributes: NotRequired[Optional[SpanAttributes]]
    is_root: NotRequired[Optional[bool]]
    """
    Whether this span is a root span
    """
    origin: NotRequired[Optional[ObjectReferenceNullish]]


class GraphNodeGraphNode7(TypedDict):
    description: NotRequired[Optional[str]]
    """
    The description of the node
    """
    position: NotRequired[Optional[GraphNodeGraphNode7Position]]
    """
    The position of the node
    """
    type: Literal['prompt_template']
    prompt: PromptBlockData


GraphNode = Union[
    GraphNodeGraphNode,
    GraphNodeGraphNode1,
    GraphNodeGraphNode2,
    GraphNodeGraphNode3,
    GraphNodeGraphNode4,
    GraphNodeGraphNode5,
    GraphNodeGraphNode6,
    GraphNodeGraphNode7,
]


class ProjectLogsEvent(TypedDict):
    id: str
    """
    A unique identifier for the project logs event. If you don't provide one, Braintrust will generate one for you
    """
    _xact_id: str
    """
    The transaction id of an event is unique to the network operation that processed the event insertion. Transaction ids are monotonically increasing over time and can be used to retrieve a versioned snapshot of the project logs (see the `version` parameter)
    """
    _pagination_key: NotRequired[Optional[str]]
    """
    A stable, time-ordered key that can be used to paginate over project logs events. This field is auto-generated by Braintrust and only exists in Brainstore.
    """
    created: str
    """
    The timestamp the project logs event was created
    """
    org_id: str
    """
    Unique id for the organization that the project belongs under
    """
    project_id: str
    """
    Unique identifier for the project
    """
    log_id: Literal['g']
    """
    A literal 'g' which identifies the log as a project log
    """
    input: NotRequired[Optional[Any]]
    """
    The arguments that uniquely define a user input (an arbitrary, JSON serializable object).
    """
    output: NotRequired[Optional[Any]]
    """
    The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
    """
    expected: NotRequired[Optional[Any]]
    """
    The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
    """
    error: NotRequired[Optional[Any]]
    """
    The error that occurred, if any.
    """
    scores: NotRequired[Optional[Mapping[str, Any]]]
    """
    A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare logs.
    """
    metadata: NotRequired[Optional[ProjectLogsEventMetadata]]
    """
    A dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings
    """
    tags: NotRequired[Optional[Sequence[str]]]
    """
    A list of tags to log
    """
    metrics: NotRequired[Optional[ProjectLogsEventMetrics]]
    """
    Metrics are numerical measurements tracking the execution of the code that produced the project logs event. Use "start" and "end" to track the time span over which the project logs event was produced
    """
    context: NotRequired[Optional[ProjectLogsEventContext]]
    """
    Context is additional information about the code that produced the project logs event. It is essentially the textual counterpart to `metrics`. Use the `caller_*` attributes to track the location in code which produced the project logs event
    """
    span_id: str
    """
    A unique identifier used to link different project logs events together as part of a full trace. See the [tracing guide](https://www.braintrust.dev/docs/guides/tracing) for full details on tracing
    """
    span_parents: NotRequired[Optional[Sequence[str]]]
    """
    An array of the parent `span_ids` of this project logs event. This should be empty for the root span of a trace, and should most often contain just one parent element for subspans
    """
    root_span_id: str
    """
    A unique identifier for the trace this project logs event belongs to
    """
    is_root: NotRequired[Optional[bool]]
    """
    Whether this span is a root span
    """
    span_attributes: NotRequired[Optional[SpanAttributes]]
    origin: NotRequired[Optional[ObjectReferenceNullish]]


class ProjectScore(TypedDict):
    id: str
    """
    Unique identifier for the project score
    """
    project_id: str
    """
    Unique identifier for the project that the project score belongs under
    """
    user_id: str
    created: NotRequired[Optional[str]]
    """
    Date of project score creation
    """
    name: str
    """
    Name of the project score
    """
    description: NotRequired[Optional[str]]
    """
    Textual description of the project score
    """
    score_type: ProjectScoreType
    categories: NotRequired[Optional[ProjectScoreCategories]]
    config: NotRequired[Optional[ProjectScoreConfig]]
    position: NotRequired[Optional[str]]
    """
    An optional LexoRank-based string that sets the sort position for the score in the UI
    """


class PromptData(TypedDict):
    prompt: NotRequired[Optional[PromptBlockDataNullish]]
    options: NotRequired[Optional[PromptOptionsNullish]]
    parser: NotRequired[Optional[PromptParserNullish]]
    tool_functions: NotRequired[Optional[Sequence[SavedFunctionId]]]
    origin: NotRequired[Optional[PromptDataOrigin]]


class PromptDataNullish(TypedDict):
    prompt: NotRequired[Optional[PromptBlockDataNullish]]
    options: NotRequired[Optional[PromptOptionsNullish]]
    parser: NotRequired[Optional[PromptParserNullish]]
    tool_functions: NotRequired[Optional[Sequence[SavedFunctionId]]]
    origin: NotRequired[Optional[PromptDataNullishOrigin]]


class View(TypedDict):
    id: str
    """
    Unique identifier for the view
    """
    object_type: Optional[AclObjectType]
    object_id: str
    """
    The id of the object the view applies to
    """
    view_type: Literal[
        'projects',
        'experiments',
        'experiment',
        'playgrounds',
        'playground',
        'datasets',
        'dataset',
        'prompts',
        'tools',
        'scorers',
        'logs',
        'agents',
        'monitor',
    ]
    """
    Type of object that the view corresponds to.
    """
    name: str
    """
    Name of the view
    """
    created: NotRequired[Optional[str]]
    """
    Date of view creation
    """
    view_data: NotRequired[Optional[ViewData]]
    options: NotRequired[Optional[ViewOptions]]
    user_id: NotRequired[Optional[str]]
    """
    Identifies the user who created the view
    """
    deleted_at: NotRequired[Optional[str]]
    """
    Date of role deletion, or null if the role is still active
    """


class FunctionIdFunctionId5(TypedDict):
    inline_prompt: NotRequired[Optional[PromptData]]
    inline_function: Mapping[str, Any]
    function_type: NotRequired[Optional[FunctionTypeEnum]]
    name: NotRequired[Optional[str]]
    """
    The name of the inline function
    """


class FunctionIdFunctionId6(TypedDict):
    inline_prompt: PromptData
    function_type: NotRequired[Optional[FunctionTypeEnum]]
    name: NotRequired[Optional[str]]
    """
    The name of the inline prompt
    """


FunctionId = Union[
    FunctionIdFunctionId,
    FunctionIdFunctionId1,
    FunctionIdFunctionId2,
    FunctionIdFunctionId3,
    FunctionIdFunctionId4,
    FunctionIdFunctionId5,
    FunctionIdFunctionId6,
]


class GraphData(TypedDict):
    type: Literal['graph']
    nodes: Mapping[str, GraphNode]
    edges: Mapping[str, GraphEdge]


class InvokeFunction(TypedDict):
    input: NotRequired[Optional[Any]]
    """
    Argument to the function, which can be any JSON serializable value
    """
    expected: NotRequired[Optional[Any]]
    """
    The expected output of the function
    """
    metadata: NotRequired[Optional[Mapping[str, Any]]]
    """
    Any relevant metadata. This will be logged and available as the `metadata` argument.
    """
    tags: NotRequired[Optional[Sequence[str]]]
    """
    Any relevant tags to log on the span.
    """
    messages: NotRequired[Optional[Sequence[ChatCompletionMessageParam]]]
    """
    If the function is an LLM, additional messages to pass along to it
    """
    parent: NotRequired[Optional[InvokeParent]]
    stream: NotRequired[Optional[bool]]
    """
    Whether to stream the response. If true, results will be returned in the Braintrust SSE format.
    """
    mode: NotRequired[Optional[StreamingMode]]
    strict: NotRequired[Optional[bool]]
    """
    If true, throw an error if one of the variables in the prompt is not present in the input
    """


class Prompt(TypedDict):
    id: str
    """
    Unique identifier for the prompt
    """
    _xact_id: str
    """
    The transaction id of an event is unique to the network operation that processed the event insertion. Transaction ids are monotonically increasing over time and can be used to retrieve a versioned snapshot of the prompt (see the `version` parameter)
    """
    project_id: str
    """
    Unique identifier for the project that the prompt belongs under
    """
    log_id: Literal['p']
    """
    A literal 'p' which identifies the object as a project prompt
    """
    org_id: str
    """
    Unique identifier for the organization
    """
    name: str
    """
    Name of the prompt
    """
    slug: str
    """
    Unique identifier for the prompt
    """
    description: NotRequired[Optional[str]]
    """
    Textual description of the prompt
    """
    created: NotRequired[Optional[str]]
    """
    Date of prompt creation
    """
    prompt_data: NotRequired[Optional[PromptDataNullish]]
    tags: NotRequired[Optional[Sequence[str]]]
    """
    A list of tags for the prompt
    """
    metadata: NotRequired[Optional[Mapping[str, Any]]]
    """
    User-controlled metadata about the prompt
    """
    function_type: NotRequired[Optional[FunctionTypeEnumNullish]]


class RunEval(TypedDict):
    project_id: str
    """
    Unique identifier for the project to run the eval in
    """
    data: Union[RunEvalData, RunEvalData1, RunEvalData2]
    """
    The dataset to use
    """
    task: FunctionId
    scores: Sequence[FunctionId]
    """
    The functions to score the eval on
    """
    experiment_name: NotRequired[Optional[str]]
    """
    An optional name for the experiment created by this eval. If it conflicts with an existing experiment, it will be suffixed with a unique identifier.
    """
    metadata: NotRequired[Optional[Mapping[str, Any]]]
    """
    Optional experiment-level metadata to store about the evaluation. You can later use this to slice & dice across experiments.
    """
    parent: NotRequired[Optional[InvokeParent]]
    stream: NotRequired[Optional[bool]]
    """
    Whether to stream the results of the eval. If true, the request will return two events: one to indicate the experiment has started, and another upon completion. If false, the request will return the evaluation's summary upon completion.
    """
    trial_count: NotRequired[Optional[float]]
    """
    The number of times to run the evaluator per input. This is useful for evaluating applications that have non-deterministic behavior and gives you both a stronger aggregate measure and a sense of the variance in the results.
    """
    is_public: NotRequired[Optional[bool]]
    """
    Whether the experiment should be public. Defaults to false.
    """
    timeout: NotRequired[Optional[float]]
    """
    The maximum duration, in milliseconds, to run the evaluation. Defaults to undefined, in which case there is no timeout.
    """
    max_concurrency: NotRequired[Optional[float]]
    """
    The maximum number of tasks/scorers that will be run concurrently. Defaults to 10. If null is provided, no max concurrency will be used.
    """
    base_experiment_name: NotRequired[Optional[str]]
    """
    An optional experiment name to use as a base. If specified, the new experiment will be summarized and compared to this experiment.
    """
    base_experiment_id: NotRequired[Optional[str]]
    """
    An optional experiment id to use as a base. If specified, the new experiment will be summarized and compared to this experiment.
    """
    git_metadata_settings: NotRequired[Optional[GitMetadataSettings]]
    repo_info: NotRequired[Optional[RepoInfo]]
    strict: NotRequired[Optional[bool]]
    """
    If true, throw an error if one of the variables in the prompt is not present in the input
    """
    stop_token: NotRequired[Optional[str]]
    """
    The token to stop the run
    """
    extra_messages: NotRequired[Optional[str]]
    """
    A template path of extra messages to append to the conversion. These messages will be appended to the end of the conversation, after the last message.
    """
    tags: NotRequired[Optional[Sequence[str]]]
    """
    Optional tags that will be added to the experiment.
    """


FunctionData = Union[
    FunctionDataFunctionData,
    FunctionDataFunctionData1,
    GraphData,
    FunctionDataFunctionData2,
    FunctionDataFunctionData3,
]


class Function(TypedDict):
    id: str
    """
    Unique identifier for the prompt
    """
    _xact_id: str
    """
    The transaction id of an event is unique to the network operation that processed the event insertion. Transaction ids are monotonically increasing over time and can be used to retrieve a versioned snapshot of the prompt (see the `version` parameter)
    """
    project_id: str
    """
    Unique identifier for the project that the prompt belongs under
    """
    log_id: Literal['p']
    """
    A literal 'p' which identifies the object as a project prompt
    """
    org_id: str
    """
    Unique identifier for the organization
    """
    name: str
    """
    Name of the prompt
    """
    slug: str
    """
    Unique identifier for the prompt
    """
    description: NotRequired[Optional[str]]
    """
    Textual description of the prompt
    """
    created: NotRequired[Optional[str]]
    """
    Date of prompt creation
    """
    prompt_data: NotRequired[Optional[PromptDataNullish]]
    tags: NotRequired[Optional[Sequence[str]]]
    """
    A list of tags for the prompt
    """
    metadata: NotRequired[Optional[Mapping[str, Any]]]
    """
    User-controlled metadata about the prompt
    """
    function_type: NotRequired[Optional[FunctionTypeEnumNullish]]
    function_data: FunctionData
    origin: NotRequired[Optional[FunctionOrigin]]
    function_schema: NotRequired[Optional[FunctionFunctionSchema]]
    """
    JSON schema for the function's parameters and return type
    """

__all__ = []
