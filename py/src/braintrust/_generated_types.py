"""
Do not import this file directly. See `generated_types.py` for the classes that have a stable API.

Auto-generated file -- do not modify.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Literal, TypeAlias, TypedDict

from typing_extensions import NotRequired

AclObjectType: TypeAlias = Literal[
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
"""
The object type that the ACL applies to
"""


class AISecret(TypedDict):
    id: str
    """
    Unique identifier for the AI secret
    """
    created: NotRequired[str | None]
    """
    Date of AI secret creation
    """
    updated_at: NotRequired[str | None]
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
    type: NotRequired[str | None]
    metadata: NotRequired[Mapping[str, Any] | None]
    preview_secret: NotRequired[str | None]


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
    created: NotRequired[str | None]
    """
    Date of api key creation
    """
    name: str
    """
    Name of the api key
    """
    preview_name: str
    user_id: NotRequired[str | None]
    """
    Unique identifier for the user
    """
    user_email: NotRequired[str | None]
    """
    The user's email
    """
    user_given_name: NotRequired[str | None]
    """
    Given name of the user
    """
    user_family_name: NotRequired[str | None]
    """
    Family name of the user
    """
    org_id: NotRequired[str | None]
    """
    Unique identifier for the organization
    """


class AsyncScoringControlAsyncScoringControl(TypedDict):
    kind: Literal['score_update']
    token: NotRequired[str | None]


class AsyncScoringControlAsyncScoringControl2(TypedDict):
    kind: Literal['state_force_reselect']


class AsyncScoringControlAsyncScoringControl3(TypedDict):
    kind: Literal['state_enabled_force_rescore']


class AsyncScoringControlAsyncScoringControl4TriggeredFunctionScope(TypedDict):
    type: Literal['span']


class AsyncScoringControlAsyncScoringControl4TriggeredFunctionScope1(TypedDict):
    type: Literal['trace']


class AsyncScoringControlAsyncScoringControl4TriggeredFunction(TypedDict):
    function_id: NotRequired[Any | None]
    scope: (
        AsyncScoringControlAsyncScoringControl4TriggeredFunctionScope
        | AsyncScoringControlAsyncScoringControl4TriggeredFunctionScope1
    )


class AsyncScoringControlAsyncScoringControl4(TypedDict):
    kind: Literal['trigger_functions']
    triggered_functions: Sequence[AsyncScoringControlAsyncScoringControl4TriggeredFunction]


class AsyncScoringControlAsyncScoringControl5(TypedDict):
    kind: Literal['complete_triggered_functions']
    function_ids: Sequence[Any]
    triggered_xact_id: str


class AsyncScoringControlAsyncScoringControl6(TypedDict):
    kind: Literal['mark_attempt_failed']
    function_ids: Sequence[Any]


class AsyncScoringStateAsyncScoringState(TypedDict):
    status: Literal['enabled']
    token: str
    function_ids: Sequence[Any]
    skip_logging: NotRequired[bool | None]
    triggered_functions: NotRequired[Mapping[str, Any] | None]


class AsyncScoringStateAsyncScoringState1(TypedDict):
    status: Literal['disabled']


AsyncScoringState: TypeAlias = AsyncScoringStateAsyncScoringState | AsyncScoringStateAsyncScoringState1 | None


class PreprocessorPreprocessor(TypedDict):
    type: Literal['function']
    id: str
    version: NotRequired[str | None]
    """
    The version of the function
    """


class PreprocessorPreprocessor2(TypedDict):
    pass


class PreprocessorPreprocessor3(PreprocessorPreprocessor, PreprocessorPreprocessor2):
    pass


class BatchedFacetDataFacet(TypedDict):
    name: str
    """
    The name of the facet
    """
    prompt: str
    """
    The prompt to use for LLM extraction. The preprocessed text will be provided as context.
    """
    model: NotRequired[str | None]
    """
    The model to use for facet extraction
    """
    no_match_pattern: NotRequired[str | None]
    """
    Regex pattern to identify outputs that do not match the facet. If the output matches, the facet will be saved as 'no_match'
    """


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
    use_cache: NotRequired[bool | None]
    reasoning_enabled: NotRequired[bool | None]
    reasoning_budget: NotRequired[float | None]


class CallEventCallEvent(TypedDict):
    id: NotRequired[str | None]
    data: str
    event: Literal['text_delta']


class CallEventCallEvent1(TypedDict):
    id: NotRequired[str | None]
    data: str
    event: Literal['reasoning_delta']


class CallEventCallEvent2(TypedDict):
    id: NotRequired[str | None]
    data: str
    event: Literal['json_delta']


class CallEventCallEvent3(TypedDict):
    id: NotRequired[str | None]
    data: str
    event: Literal['progress']


class CallEventCallEvent4(TypedDict):
    id: NotRequired[str | None]
    data: str
    event: Literal['error']


class CallEventCallEvent5(TypedDict):
    id: NotRequired[str | None]
    data: str
    event: Literal['console']


class CallEventCallEvent6(TypedDict):
    id: NotRequired[str | None]
    event: Literal['start']
    data: Literal['']


class CallEventCallEvent7(TypedDict):
    id: NotRequired[str | None]
    event: Literal['done']
    data: Literal['']


CallEvent: TypeAlias = (
    CallEventCallEvent
    | CallEventCallEvent1
    | CallEventCallEvent2
    | CallEventCallEvent3
    | CallEventCallEvent4
    | CallEventCallEvent5
    | CallEventCallEvent6
    | CallEventCallEvent7
)


class ChatCompletionContentPartFileFile(TypedDict):
    file_data: NotRequired[str | None]
    filename: NotRequired[str | None]
    file_id: NotRequired[str | None]


class ChatCompletionContentPartFileWithTitle(TypedDict):
    file: ChatCompletionContentPartFileFile
    type: Literal['file']


class ChatCompletionContentPartImageWithTitleImageUrl(TypedDict):
    url: str
    detail: NotRequired[Literal['auto'] | Literal['low'] | Literal['high'] | None]


class ChatCompletionContentPartImageWithTitle(TypedDict):
    image_url: ChatCompletionContentPartImageWithTitleImageUrl
    type: Literal['image_url']


class ChatCompletionContentPartTextCacheControl(TypedDict):
    type: Literal['ephemeral']


class ChatCompletionContentPartText(TypedDict):
    text: str
    type: Literal['text']
    cache_control: NotRequired[ChatCompletionContentPartTextCacheControl | None]


class ChatCompletionContentPartTextWithTitleCacheControl(TypedDict):
    type: Literal['ephemeral']


class ChatCompletionContentPartTextWithTitle(TypedDict):
    text: str
    type: Literal['text']
    cache_control: NotRequired[ChatCompletionContentPartTextWithTitleCacheControl | None]


class ChatCompletionMessageParamChatCompletionMessageParam(TypedDict):
    content: str | Sequence[ChatCompletionContentPartText]
    role: Literal['system']
    name: NotRequired[str | None]


class ChatCompletionMessageParamChatCompletionMessageParam2FunctionCall(TypedDict):
    arguments: str
    name: str


class ChatCompletionMessageParamChatCompletionMessageParam3(TypedDict):
    content: str | Sequence[ChatCompletionContentPartText]
    role: Literal['tool']
    tool_call_id: str


class ChatCompletionMessageParamChatCompletionMessageParam4(TypedDict):
    content: str | None
    name: str
    role: Literal['function']


class ChatCompletionMessageParamChatCompletionMessageParam5(TypedDict):
    content: str | Sequence[ChatCompletionContentPartText]
    role: Literal['developer']
    name: NotRequired[str | None]


class ChatCompletionMessageParamChatCompletionMessageParam6(TypedDict):
    role: Literal['model']
    content: NotRequired[str | None]


class ChatCompletionMessageReasoning(TypedDict):
    id: NotRequired[str | None]
    content: NotRequired[str | None]


class ChatCompletionMessageToolCallFunction(TypedDict):
    arguments: str
    name: str


class ChatCompletionMessageToolCall(TypedDict):
    id: str
    function: ChatCompletionMessageToolCallFunction
    type: Literal['function']


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam(TypedDict):
    content: str | Sequence[ChatCompletionContentPartText]
    role: Literal['system']
    name: NotRequired[str | None]


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam2FunctionCall(TypedDict):
    arguments: str
    name: str


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam2(TypedDict):
    role: Literal['assistant']
    content: NotRequired[str | Sequence[ChatCompletionContentPartText] | None]
    function_call: NotRequired[ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam2FunctionCall | None]
    name: NotRequired[str | None]
    tool_calls: NotRequired[Sequence[ChatCompletionMessageToolCall] | None]
    reasoning: NotRequired[Sequence[ChatCompletionMessageReasoning] | None]


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam3(TypedDict):
    content: str | Sequence[ChatCompletionContentPartText]
    role: Literal['tool']
    tool_call_id: str


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam4(TypedDict):
    content: str | None
    name: str
    role: Literal['function']


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam5(TypedDict):
    content: str | Sequence[ChatCompletionContentPartText]
    role: Literal['developer']
    name: NotRequired[str | None]


class ChatCompletionToolFunction(TypedDict):
    name: str
    description: NotRequired[str | None]
    parameters: NotRequired[Mapping[str, Any] | None]


class ChatCompletionTool(TypedDict):
    function: ChatCompletionToolFunction
    type: Literal['function']


class CodeBundleRuntimeContext(TypedDict):
    runtime: Literal['node', 'python', 'browser', 'quickjs']
    version: str


class CodeBundleLocationPosition(TypedDict):
    type: Literal['task']


class CodeBundleLocationPosition1(TypedDict):
    type: Literal['scorer']
    index: int


class CodeBundleLocation(TypedDict):
    type: Literal['experiment']
    eval_name: str
    position: CodeBundleLocationPosition | CodeBundleLocationPosition1


class CodeBundleLocation1(TypedDict):
    type: Literal['function']
    index: int


class CodeBundle(TypedDict):
    runtime_context: CodeBundleRuntimeContext
    location: CodeBundleLocation | CodeBundleLocation1
    bundle_id: str
    preview: NotRequired[str | None]
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
    description: NotRequired[str | None]
    """
    Textual description of the dataset
    """
    created: NotRequired[str | None]
    """
    Date of dataset creation
    """
    deleted_at: NotRequired[str | None]
    """
    Date of dataset deletion, or null if the dataset is still active
    """
    user_id: NotRequired[str | None]
    """
    Identifies the user who created the dataset
    """
    metadata: NotRequired[Mapping[str, Any] | None]
    """
    User-controlled metadata about the dataset
    """
    url_slug: str
    """
    URL slug for the dataset. used to construct dataset URLs
    """


class DatasetEventMetadata(TypedDict):
    model: NotRequired[str | None]
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
    created: NotRequired[str | None]
    """
    Date of environment variable creation
    """
    used: NotRequired[str | None]
    """
    Date the environment variable was last used
    """
    metadata: NotRequired[Mapping[str, Any] | None]
    """
    Optional metadata associated with the environment variable when managed via the function secrets API
    """
    secret_type: NotRequired[str | None]
    """
    Optional classification for the secret (for example, the AI provider name)
    """
    secret_category: NotRequired[Literal['env_var', 'ai_provider'] | None]
    """
    The category of the secret: env_var for regular environment variables, ai_provider for AI provider API keys
    """


class EvalStatusPageConfig(TypedDict):
    score_columns: NotRequired[Sequence[str] | None]
    """
    The score columns to display on the page
    """
    metric_columns: NotRequired[Sequence[str] | None]
    """
    The metric columns to display on the page
    """
    grouping_field: NotRequired[str | None]
    """
    The metadata field to use for grouping experiments (model)
    """
    filter: NotRequired[str | None]
    """
    BTQL filter to apply to experiment data
    """
    sort_by: NotRequired[str | None]
    """
    Field to sort results by (format: 'score:<name>' or 'metric:<name>')
    """
    sort_order: NotRequired[Literal['asc', 'desc'] | None]
    """
    Sort order (ascending or descending)
    """
    api_key: NotRequired[str | None]
    """
    The API key used for fetching experiment data
    """


EvalStatusPageTheme: TypeAlias = Literal['light', 'dark']
"""
The theme for the page
"""


class ExperimentEventMetadata(TypedDict):
    model: NotRequired[str | None]
    """
    The model used for this example
    """


class ExperimentEventMetrics(TypedDict):
    start: NotRequired[float | None]
    """
    A unix timestamp recording when the section of code which produced the experiment event started
    """
    end: NotRequired[float | None]
    """
    A unix timestamp recording when the section of code which produced the experiment event finished
    """
    prompt_tokens: NotRequired[int | None]
    """
    The number of tokens in the prompt used to generate the experiment event (only set if this is an LLM span)
    """
    completion_tokens: NotRequired[int | None]
    """
    The number of tokens in the completion generated by the model (only set if this is an LLM span)
    """
    tokens: NotRequired[int | None]
    """
    The total number of tokens in the input and output of the experiment event.
    """
    caller_functionname: NotRequired[Any | None]
    """
    This metric is deprecated
    """
    caller_filename: NotRequired[Any | None]
    """
    This metric is deprecated
    """
    caller_lineno: NotRequired[Any | None]
    """
    This metric is deprecated
    """


class ExperimentEventContext(TypedDict):
    caller_functionname: NotRequired[str | None]
    """
    The function in code which created the experiment event
    """
    caller_filename: NotRequired[str | None]
    """
    Name of the file in code where the experiment event was created
    """
    caller_lineno: NotRequired[int | None]
    """
    Line of code where the experiment event was created
    """


class ExtendedSavedFunctionIdExtendedSavedFunctionId(TypedDict):
    type: Literal['function']
    id: str
    version: NotRequired[str | None]
    """
    The version of the function
    """


class ExtendedSavedFunctionIdExtendedSavedFunctionId2(TypedDict):
    type: Literal['slug']
    project_id: str
    slug: str


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


class Preprocessor1Preprocessor1(TypedDict):
    type: Literal['function']
    id: str
    version: NotRequired[str | None]
    """
    The version of the function
    """


class Preprocessor1Preprocessor12(TypedDict):
    pass


class Preprocessor1Preprocessor13(Preprocessor1Preprocessor1, Preprocessor1Preprocessor12):
    pass


class FunctionOrigin(TypedDict):
    object_type: AclObjectType
    object_id: str
    """
    Id of the object the function is originating from
    """
    internal: NotRequired[bool | None]
    """
    The function exists for internal purposes and should not be displayed in the list of functions.
    """


class FunctionFunctionSchema(TypedDict):
    parameters: NotRequired[Any | None]
    returns: NotRequired[Any | None]


class FunctionDataFunctionData(TypedDict):
    type: Literal['prompt']


class Data(CodeBundle):
    type: Literal['bundle']


class FunctionDataFunctionData1DataRuntimeContext(TypedDict):
    runtime: Literal['node', 'python', 'browser', 'quickjs']
    version: str


class FunctionDataFunctionData1Data(TypedDict):
    type: Literal['inline']
    runtime_context: FunctionDataFunctionData1DataRuntimeContext
    code: str
    code_hash: NotRequired[str | None]
    """
    SHA256 hash of the code, computed at save time
    """


class FunctionDataFunctionData1(TypedDict):
    type: Literal['code']
    data: Data | FunctionDataFunctionData1Data


class FunctionDataFunctionData2(TypedDict):
    type: Literal['remote_eval']
    endpoint: str
    eval_name: str
    parameters: Mapping[str, Any]


FunctionFormat: TypeAlias = Literal['llm', 'code', 'global', 'graph']


class FunctionIdFunctionId(TypedDict):
    function_id: str
    """
    The ID of the function
    """
    version: NotRequired[str | None]
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
    version: NotRequired[str | None]
    """
    The version of the function
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
    version: NotRequired[str | None]
    """
    The version of the function
    """


class FunctionIdFunctionId4InlineContext(TypedDict):
    runtime: Literal['node', 'python', 'browser', 'quickjs']
    version: str


class FunctionIdFunctionId4(TypedDict):
    inline_context: FunctionIdFunctionId4InlineContext
    code: str
    """
    The inline code to execute
    """
    name: NotRequired[str | None]
    """
    The name of the inline code function
    """


FunctionIdRef: TypeAlias = Mapping[str, Any]


FunctionObjectType: TypeAlias = Literal[
    'prompt', 'tool', 'scorer', 'task', 'workflow', 'custom_view', 'preprocessor', 'facet', 'classifier'
]


FunctionOutputType: TypeAlias = Literal['completion', 'score', 'facet', 'classification', 'any']


FunctionTypeEnum: TypeAlias = Literal[
    'llm', 'scorer', 'task', 'tool', 'custom_view', 'preprocessor', 'facet', 'classifier', 'tag'
]
"""
The type of global function. Defaults to 'scorer'.
"""


FunctionTypeEnumNullish: TypeAlias = Literal[
    'llm', 'scorer', 'task', 'tool', 'custom_view', 'preprocessor', 'facet', 'classifier', 'tag'
]


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
    description: NotRequired[str | None]
    """
    The description of the node
    """
    position: NotRequired[GraphNodeGraphNodePosition | None]
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
    description: NotRequired[str | None]
    """
    The description of the node
    """
    position: NotRequired[GraphNodeGraphNode1Position | None]
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
    description: NotRequired[str | None]
    """
    The description of the node
    """
    position: NotRequired[GraphNodeGraphNode2Position | None]
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
    description: NotRequired[str | None]
    """
    The description of the node
    """
    position: NotRequired[GraphNodeGraphNode3Position | None]
    """
    The position of the node
    """
    type: Literal['literal']
    value: NotRequired[Any | None]
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
    description: NotRequired[str | None]
    """
    The description of the node
    """
    position: NotRequired[GraphNodeGraphNode4Position | None]
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
    description: NotRequired[str | None]
    """
    The description of the node
    """
    position: NotRequired[GraphNodeGraphNode5Position | None]
    """
    The position of the node
    """
    type: Literal['gate']
    condition: NotRequired[str | None]
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
    description: NotRequired[str | None]
    """
    The description of the node
    """
    position: NotRequired[GraphNodeGraphNode6Position | None]
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
    user_id: NotRequired[str | None]
    """
    Identifies the user who created the group
    """
    created: NotRequired[str | None]
    """
    Date of group creation
    """
    name: str
    """
    Name of the group
    """
    description: NotRequired[str | None]
    """
    Textual description of the group
    """
    deleted_at: NotRequired[str | None]
    """
    Date of group deletion, or null if the group is still active
    """
    member_users: NotRequired[Sequence[str] | None]
    """
    Ids of users which belong to this group
    """
    member_groups: NotRequired[Sequence[str] | None]
    """
    Ids of the groups this group inherits from

    An inheriting group has all the users contained in its member groups, as well as all of their inherited users
    """


class GroupScope(TypedDict):
    type: Literal['group']
    group_by: str
    """
    Field path to group by, e.g. metadata.session_id
    """
    idle_seconds: NotRequired[float | None]
    """
    Optional: trigger after this many seconds of inactivity
    """


IfExists: TypeAlias = Literal['error', 'ignore', 'replace']


ImageRenderingMode: TypeAlias = Literal['auto', 'click_to_load', 'blocked']
"""
Controls how images are rendered in the UI: 'auto' loads images automatically, 'click_to_load' shows a placeholder until clicked, 'blocked' prevents image loading entirely
"""


class InvokeFunctionInvokeFunction(TypedDict):
    function_id: str
    """
    The ID of the function
    """
    version: NotRequired[str | None]
    """
    The version of the function
    """


class InvokeFunctionInvokeFunction1(TypedDict):
    project_name: str
    """
    The name of the project containing the function
    """
    slug: str
    """
    The slug of the function
    """
    version: NotRequired[str | None]
    """
    The version of the function
    """


class InvokeFunctionInvokeFunction2(TypedDict):
    global_function: str
    """
    The name of the global function. Currently, the global namespace includes the functions in autoevals
    """
    function_type: NotRequired[FunctionTypeEnum | None]


class InvokeFunctionInvokeFunction3(TypedDict):
    prompt_session_id: str
    """
    The ID of the prompt session
    """
    prompt_session_function_id: str
    """
    The ID of the function in the prompt session
    """
    version: NotRequired[str | None]
    """
    The version of the function
    """


class InvokeFunctionInvokeFunction4InlineContext(TypedDict):
    runtime: Literal['node', 'python', 'browser', 'quickjs']
    version: str


class InvokeFunctionInvokeFunction4(TypedDict):
    inline_context: InvokeFunctionInvokeFunction4InlineContext
    code: str
    """
    The inline code to execute
    """
    name: NotRequired[str | None]
    """
    The name of the inline code function
    """


class InvokeFunctionMcpAuth(TypedDict):
    oauth_token: NotRequired[str | None]
    """
    The OAuth token to use
    """


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
    row_ids: NotRequired[InvokeParentInvokeParentRowIds | None]
    """
    Identifiers for the row to to log a subspan under
    """
    propagated_event: NotRequired[Mapping[str, Any] | None]
    """
    Include these properties in every span created under this parent
    """


InvokeParent: TypeAlias = InvokeParentInvokeParent | str
"""
Options for tracing the function call
"""


class MCPServer(TypedDict):
    id: str
    """
    Unique identifier for the MCP server
    """
    project_id: str
    """
    Unique identifier for the project that the MCP server belongs under
    """
    user_id: NotRequired[str | None]
    """
    Identifies the user who created the MCP server
    """
    created: NotRequired[str | None]
    """
    Date of MCP server creation
    """
    deleted_at: NotRequired[str | None]
    """
    Date of MCP server deletion, or null if the MCP server is still active
    """
    name: str
    """
    Name of the MCP server. Within a project, MCP server names are unique
    """
    description: NotRequired[str | None]
    """
    Textual description of the MCP server
    """
    url: str
    """
    URL of the MCP server endpoint
    """


MessageRole: TypeAlias = Literal['system', 'user', 'assistant', 'function', 'tool', 'model', 'developer']


class ModelParamsModelParamsToolChoiceFunction(TypedDict):
    name: str


class ModelParamsModelParamsToolChoice(TypedDict):
    type: Literal['function']
    function: ModelParamsModelParamsToolChoiceFunction


class ModelParamsModelParamsFunctionCall(TypedDict):
    name: str


class ModelParamsModelParams1(TypedDict):
    use_cache: NotRequired[bool | None]
    reasoning_enabled: NotRequired[bool | None]
    reasoning_budget: NotRequired[float | None]
    max_tokens: float
    temperature: float
    top_p: NotRequired[float | None]
    top_k: NotRequired[float | None]
    stop_sequences: NotRequired[Sequence[str] | None]
    max_tokens_to_sample: NotRequired[float | None]
    """
    This is a legacy parameter that should not be used.
    """


class ModelParamsModelParams2(TypedDict):
    use_cache: NotRequired[bool | None]
    reasoning_enabled: NotRequired[bool | None]
    reasoning_budget: NotRequired[float | None]
    temperature: NotRequired[float | None]
    maxOutputTokens: NotRequired[float | None]
    topP: NotRequired[float | None]
    topK: NotRequired[float | None]


class ModelParamsModelParams3(TypedDict):
    use_cache: NotRequired[bool | None]
    reasoning_enabled: NotRequired[bool | None]
    reasoning_budget: NotRequired[float | None]
    temperature: NotRequired[float | None]
    topK: NotRequired[float | None]


class ModelParamsModelParams4(TypedDict):
    use_cache: NotRequired[bool | None]
    reasoning_enabled: NotRequired[bool | None]
    reasoning_budget: NotRequired[float | None]


class NullableSavedFunctionIdNullableSavedFunctionId(TypedDict):
    type: Literal['function']
    id: str
    version: NotRequired[str | None]
    """
    The version of the function
    """


class NullableSavedFunctionIdNullableSavedFunctionId1(TypedDict):
    type: Literal['global']
    name: str
    function_type: NotRequired[FunctionTypeEnum | None]


NullableSavedFunctionId: TypeAlias = (
    NullableSavedFunctionIdNullableSavedFunctionId | NullableSavedFunctionIdNullableSavedFunctionId1 | None
)
"""
Default preprocessor for this project. When set, functions that use preprocessors will use this instead of their built-in default.
"""


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
    _xact_id: NotRequired[str | None]
    """
    Transaction ID of the original event.
    """
    created: NotRequired[str | None]
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
    _xact_id: NotRequired[str | None]
    """
    Transaction ID of the original event.
    """
    created: NotRequired[str | None]
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
    api_url: NotRequired[str | None]
    is_universal_api: NotRequired[bool | None]
    proxy_url: NotRequired[str | None]
    realtime_url: NotRequired[str | None]
    created: NotRequired[str | None]
    """
    Date of organization creation
    """
    image_rendering_mode: NotRequired[ImageRenderingMode | None]


Permission: TypeAlias = Literal[
    'create', 'read', 'update', 'delete', 'create_acls', 'read_acls', 'update_acls', 'delete_acls'
]
"""
Each permission permits a certain type of operation on an object in the system

Permissions can be assigned to to objects on an individual basis, or grouped into roles
"""


class ProjectAutomationConfigAction(TypedDict):
    type: Literal['webhook']
    """
    The type of action to take
    """
    url: str
    """
    The webhook URL to send the request to
    """


class ProjectAutomationConfigAction1(TypedDict):
    type: Literal['slack']
    """
    The type of action to take
    """
    workspace_id: str
    """
    The Slack workspace ID to post to
    """
    channel: str
    """
    The Slack channel ID to post to
    """
    message_template: NotRequired[str | None]
    """
    Custom message template for the alert
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
    action: ProjectAutomationConfigAction | ProjectAutomationConfigAction1
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
    export_definition: (
        ProjectAutomationConfig1ExportDefinition
        | ProjectAutomationConfig1ExportDefinition1
        | ProjectAutomationConfig1ExportDefinition2
    )
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
    batch_size: NotRequired[float | None]
    """
    The number of rows to export in each batch
    """


class ProjectAutomationConfig3Action(TypedDict):
    type: Literal['webhook']
    """
    The type of action to take
    """
    url: str
    """
    The webhook URL to send the request to
    """


class ProjectAutomationConfig3Action1(TypedDict):
    type: Literal['slack']
    """
    The type of action to take
    """
    workspace_id: str
    """
    The Slack workspace ID to post to
    """
    channel: str
    """
    The Slack channel ID to post to
    """
    message_template: NotRequired[str | None]
    """
    Custom message template for the alert
    """


class ProjectAutomationConfig3(TypedDict):
    event_type: Literal['environment_update']
    """
    The type of automation.
    """
    environment_filter: NotRequired[Sequence[str] | None]
    """
    Optional list of environment slugs to filter by
    """
    action: ProjectAutomationConfig3Action | ProjectAutomationConfig3Action1
    """
    The action to take when the automation rule is triggered
    """


class ProjectLogsEventMetadata(TypedDict):
    model: NotRequired[str | None]
    """
    The model used for this example
    """


class ProjectLogsEventMetrics(TypedDict):
    start: NotRequired[float | None]
    """
    A unix timestamp recording when the section of code which produced the project logs event started
    """
    end: NotRequired[float | None]
    """
    A unix timestamp recording when the section of code which produced the project logs event finished
    """
    prompt_tokens: NotRequired[int | None]
    """
    The number of tokens in the prompt used to generate the project logs event (only set if this is an LLM span)
    """
    completion_tokens: NotRequired[int | None]
    """
    The number of tokens in the completion generated by the model (only set if this is an LLM span)
    """
    tokens: NotRequired[int | None]
    """
    The total number of tokens in the input and output of the project logs event.
    """
    caller_functionname: NotRequired[Any | None]
    """
    This metric is deprecated
    """
    caller_filename: NotRequired[Any | None]
    """
    This metric is deprecated
    """
    caller_lineno: NotRequired[Any | None]
    """
    This metric is deprecated
    """


class ProjectLogsEventContext(TypedDict):
    caller_functionname: NotRequired[str | None]
    """
    The function in code which created the project logs event
    """
    caller_filename: NotRequired[str | None]
    """
    Name of the file in code where the project logs event was created
    """
    caller_lineno: NotRequired[int | None]
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


ProjectScoreType: TypeAlias = Literal['slider', 'categorical', 'weighted', 'minimum', 'maximum', 'online', 'free-form']
"""
The type of the configured score
"""


class ProjectSettingsSpanFieldOrderItem(TypedDict):
    object_type: str
    column_id: str
    position: str
    layout: NotRequired[Literal['full'] | Literal['two_column'] | None]


class ProjectSettingsRemoteEvalSource(TypedDict):
    url: str
    name: str
    description: NotRequired[str | None]


class ProjectSettings(TypedDict):
    comparison_key: NotRequired[str | None]
    """
    The key used to join two experiments (defaults to `input`)
    """
    baseline_experiment_id: NotRequired[str | None]
    """
    The id of the experiment to use as the default baseline for comparisons
    """
    spanFieldOrder: NotRequired[Sequence[ProjectSettingsSpanFieldOrderItem] | None]
    """
    The order of the fields to display in the trace view
    """
    remote_eval_sources: NotRequired[Sequence[ProjectSettingsRemoteEvalSource] | None]
    """
    The remote eval sources to use for the project
    """
    disable_realtime_queries: NotRequired[bool | None]
    """
    If true, disable real-time queries for this project. This can improve query performance for high-volume logs.
    """
    default_preprocessor: NotRequired[NullableSavedFunctionId | None]


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
    created: NotRequired[str | None]
    """
    Date of project tag creation
    """
    name: str
    """
    Name of the project tag
    """
    description: NotRequired[str | None]
    """
    Textual description of the project tag
    """
    color: NotRequired[str | None]
    """
    Color of the tag for the UI
    """
    position: NotRequired[str | None]
    """
    An optional LexoRank-based string that sets the sort position for the tag in the UI
    """


class PromptBlockDataPromptBlockData1(TypedDict):
    type: Literal['completion']
    content: str


class PromptBlockDataNullishPromptBlockDataNullish1(TypedDict):
    type: Literal['completion']
    content: str


class PromptDataOrigin(TypedDict):
    prompt_id: NotRequired[str | None]
    project_id: NotRequired[str | None]
    prompt_version: NotRequired[str | None]


class PromptDataNullishOrigin(TypedDict):
    prompt_id: NotRequired[str | None]
    project_id: NotRequired[str | None]
    prompt_version: NotRequired[str | None]


class PromptParserNullish(TypedDict):
    type: Literal['llm_classifier']
    use_cot: bool
    choice_scores: NotRequired[Mapping[str, float] | None]
    """
    Map of choices to scores (0-1). Used by scorers.
    """
    choice: NotRequired[Sequence[str] | None]
    """
    List of valid choices without score mapping. Used by classifiers that deposit output to tags.
    """
    allow_no_match: NotRequired[bool | None]
    """
    If true, adds a 'No match' option. When selected, no tag is deposited.
    """


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
    _pagination_key: NotRequired[str | None]
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
    prompt_session_data: NotRequired[Any | None]
    """
    Data about the prompt session
    """
    prompt_data: NotRequired[Any | None]
    """
    Data about the prompt
    """
    function_data: NotRequired[Any | None]
    """
    Data about the function
    """
    function_type: NotRequired[FunctionTypeEnumNullish | None]
    object_data: NotRequired[Any | None]
    """
    Data about the mapped data
    """
    completion: NotRequired[Any | None]
    """
    Data about the completion
    """
    tags: NotRequired[Sequence[str] | None]
    """
    A list of tags to log
    """


class RepoInfo(TypedDict):
    commit: NotRequired[str | None]
    """
    SHA of most recent commit
    """
    branch: NotRequired[str | None]
    """
    Name of the branch the most recent commit belongs to
    """
    tag: NotRequired[str | None]
    """
    Name of the tag on the most recent commit
    """
    dirty: NotRequired[bool | None]
    """
    Whether or not the repo had uncommitted changes when snapshotted
    """
    author_name: NotRequired[str | None]
    """
    Name of the author of the most recent commit
    """
    author_email: NotRequired[str | None]
    """
    Email of the author of the most recent commit
    """
    commit_message: NotRequired[str | None]
    """
    Most recent commit message
    """
    commit_time: NotRequired[str | None]
    """
    Time of the most recent commit
    """
    git_diff: NotRequired[str | None]
    """
    If the repo was dirty when run, this includes the diff between the current state of the repo and the most recent commit.
    """


class ResponseFormatResponseFormat(TypedDict):
    type: Literal['json_object']


class ResponseFormatResponseFormat2(TypedDict):
    type: Literal['text']


class ResponseFormatJsonSchema(TypedDict):
    name: str
    description: NotRequired[str | None]
    schema: NotRequired[Mapping[str, Any] | str | None]
    strict: NotRequired[bool | None]


class ResponseFormatNullishResponseFormatNullish(TypedDict):
    type: Literal['json_object']


class ResponseFormatNullishResponseFormatNullish1(TypedDict):
    type: Literal['json_schema']
    json_schema: ResponseFormatJsonSchema


class ResponseFormatNullishResponseFormatNullish2(TypedDict):
    type: Literal['text']


ResponseFormatNullish: TypeAlias = (
    ResponseFormatNullishResponseFormatNullish
    | ResponseFormatNullishResponseFormatNullish1
    | ResponseFormatNullishResponseFormatNullish2
    | None
)


RetentionObjectType: TypeAlias = Literal['project_logs', 'experiment', 'dataset']
"""
The object type that the retention policy applies to
"""


class RoleMemberPermission(TypedDict):
    permission: Permission
    restrict_object_type: NotRequired[AclObjectType | None]


class Role(TypedDict):
    id: str
    """
    Unique identifier for the role
    """
    org_id: NotRequired[str | None]
    """
    Unique id for the organization that the role belongs under

    A null org_id indicates a system role, which may be assigned to anybody and inherited by any other role, but cannot be edited.

    It is forbidden to change the org after creating a role
    """
    user_id: NotRequired[str | None]
    """
    Identifies the user who created the role
    """
    created: NotRequired[str | None]
    """
    Date of role creation
    """
    name: str
    """
    Name of the role
    """
    description: NotRequired[str | None]
    """
    Textual description of the role
    """
    deleted_at: NotRequired[str | None]
    """
    Date of role deletion, or null if the role is still active
    """
    member_permissions: NotRequired[Sequence[RoleMemberPermission] | None]
    """
    (permission, restrict_object_type) tuples which belong to this role
    """
    member_roles: NotRequired[Sequence[str] | None]
    """
    Ids of the roles this role inherits from

    An inheriting role has all the permissions contained in its member roles, as well as all of their inherited permissions
    """


class RunEvalData(TypedDict):
    dataset_id: str
    _internal_btql: NotRequired[Mapping[str, Any] | None]


class RunEvalData1(TypedDict):
    project_name: str
    dataset_name: str
    _internal_btql: NotRequired[Mapping[str, Any] | None]


class RunEvalData2(TypedDict):
    data: Sequence[Any]


class TaskTask(TypedDict):
    function_id: str
    """
    The ID of the function
    """
    version: NotRequired[str | None]
    """
    The version of the function
    """


class TaskTask1(TypedDict):
    project_name: str
    """
    The name of the project containing the function
    """
    slug: str
    """
    The slug of the function
    """
    version: NotRequired[str | None]
    """
    The version of the function
    """


class TaskTask2(TypedDict):
    global_function: str
    """
    The name of the global function. Currently, the global namespace includes the functions in autoevals
    """
    function_type: NotRequired[FunctionTypeEnum | None]


class TaskTask3(TypedDict):
    prompt_session_id: str
    """
    The ID of the prompt session
    """
    prompt_session_function_id: str
    """
    The ID of the function in the prompt session
    """
    version: NotRequired[str | None]
    """
    The version of the function
    """


class TaskTask4InlineContext(TypedDict):
    runtime: Literal['node', 'python', 'browser', 'quickjs']
    version: str


class TaskTask4(TypedDict):
    inline_context: TaskTask4InlineContext
    code: str
    """
    The inline code to execute
    """
    name: NotRequired[str | None]
    """
    The name of the inline code function
    """


class TaskTask7(TypedDict):
    pass


class TaskTask8(TaskTask, TaskTask7):
    pass


class TaskTask9(TaskTask1, TaskTask7):
    pass


class TaskTask10(TaskTask2, TaskTask7):
    pass


class TaskTask11(TaskTask3, TaskTask7):
    pass


class TaskTask12(TaskTask4, TaskTask7):
    pass


class ParentParentRowIds(TypedDict):
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


class ParentParent(TypedDict):
    object_type: Literal['project_logs', 'experiment', 'playground_logs']
    object_id: str
    """
    The id of the container object you are logging to
    """
    row_ids: NotRequired[ParentParentRowIds | None]
    """
    Identifiers for the row to to log a subspan under
    """
    propagated_event: NotRequired[Mapping[str, Any] | None]
    """
    Include these properties in every span created under this parent
    """


class ParentParent1(TypedDict):
    pass


class ParentParent2(ParentParent, ParentParent1):
    pass


Parent: TypeAlias = ParentParent2


class RunEvalMcpAuth(TypedDict):
    oauth_token: NotRequired[str | None]
    """
    The OAuth token to use
    """


class SavedFunctionIdSavedFunctionId(TypedDict):
    type: Literal['function']
    id: str
    version: NotRequired[str | None]
    """
    The version of the function
    """


class SavedFunctionIdSavedFunctionId1(TypedDict):
    type: Literal['global']
    name: str
    function_type: NotRequired[FunctionTypeEnum | None]


SavedFunctionId: TypeAlias = SavedFunctionIdSavedFunctionId | SavedFunctionIdSavedFunctionId1


class ServiceToken(TypedDict):
    id: str
    """
    Unique identifier for the service token
    """
    created: NotRequired[str | None]
    """
    Date of service token creation
    """
    name: str
    """
    Name of the service token
    """
    preview_name: str
    service_account_id: NotRequired[str | None]
    """
    Unique identifier for the service token
    """
    service_account_email: NotRequired[str | None]
    """
    The service account email (not routable)
    """
    service_account_name: NotRequired[str | None]
    """
    The service account name
    """
    org_id: NotRequired[str | None]
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
    user_id: NotRequired[str | None]
    """
    Identifies the user who created the span iframe
    """
    created: NotRequired[str | None]
    """
    Date of span iframe creation
    """
    deleted_at: NotRequired[str | None]
    """
    Date of span iframe deletion, or null if the span iframe is still active
    """
    name: str
    """
    Name of the span iframe
    """
    description: NotRequired[str | None]
    """
    Textual description of the span iframe
    """
    url: str
    """
    URL to embed the project viewer in an iframe
    """
    post_message: NotRequired[bool | None]
    """
    Whether to post messages to the iframe containing the span's data. This is useful when you want to render more data than fits in the URL.
    """


class SpanScope(TypedDict):
    type: Literal['span']


SpanType: TypeAlias = Literal[
    'llm', 'score', 'function', 'eval', 'task', 'tool', 'automation', 'facet', 'preprocessor', 'classifier'
]
"""
Type of the span, for display purposes only
"""


class SSEConsoleEventData(TypedDict):
    stream: Literal['stderr', 'stdout']
    message: str


class SSEProgressEventData(TypedDict):
    id: str
    """
    The id of the span this event is for
    """
    object_type: FunctionObjectType
    origin: NotRequired[ObjectReferenceNullish | None]
    format: FunctionFormat
    output_type: FunctionOutputType
    name: str
    event: Literal['reasoning_delta', 'text_delta', 'json_delta', 'error', 'console', 'start', 'done', 'progress']
    data: str


StreamingMode: TypeAlias = Literal['auto', 'parallel', 'json', 'text']
"""
The mode format of the returned value (defaults to 'auto')
"""


class ToolFunctionDefinitionFunction(TypedDict):
    name: str
    description: NotRequired[str | None]
    parameters: NotRequired[Mapping[str, Any] | None]
    strict: NotRequired[bool | None]


class ToolFunctionDefinition(TypedDict):
    type: Literal['function']
    function: ToolFunctionDefinitionFunction


class TraceScope(TypedDict):
    type: Literal['trace']
    idle_seconds: NotRequired[float | None]
    """
    Consider trace complete after this many seconds of inactivity (default: 30)
    """


class TriggeredFunctionStateScope(TypedDict):
    type: Literal['span']


class TriggeredFunctionStateScope1(TypedDict):
    type: Literal['trace']


class TriggeredFunctionStateScope2(TypedDict):
    type: Literal['group']
    key: str
    value: str


class TriggeredFunctionState(TypedDict):
    triggered_xact_id: str
    """
    The xact_id when this function was triggered
    """
    completed_xact_id: NotRequired[str | None]
    """
    The xact_id when this function completed (matches triggered_xact_id if done)
    """
    attempts: NotRequired[int | None]
    """
    Number of execution attempts (for retry tracking)
    """
    scope: TriggeredFunctionStateScope | TriggeredFunctionStateScope1 | TriggeredFunctionStateScope2
    """
    The scope of data this function operates on
    """


UploadStatus: TypeAlias = Literal['uploading', 'done', 'error']


class User(TypedDict):
    id: str
    """
    Unique identifier for the user
    """
    given_name: NotRequired[str | None]
    """
    Given name of the user
    """
    family_name: NotRequired[str | None]
    """
    Family name of the user
    """
    email: NotRequired[str | None]
    """
    The user's email
    """
    avatar_url: NotRequired[str | None]
    """
    URL of the user's Avatar image
    """
    created: NotRequired[str | None]
    """
    Date of user creation
    """


class ViewDataSearch(TypedDict):
    filter: NotRequired[Sequence[Any] | None]
    tag: NotRequired[Sequence[Any] | None]
    match: NotRequired[Sequence[Any] | None]
    sort: NotRequired[Sequence[Any] | None]


class ViewOptionsViewOptionsOptions(TypedDict):
    spanType: NotRequired[Literal['range', 'frame'] | None]
    rangeValue: NotRequired[str | None]
    frameStart: NotRequired[str | None]
    frameEnd: NotRequired[str | None]
    tzUTC: NotRequired[bool | None]
    chartVisibility: NotRequired[Mapping[str, Any] | None]
    projectId: NotRequired[str | None]
    type: NotRequired[Literal['project', 'experiment'] | None]
    groupBy: NotRequired[str | None]


class ViewOptionsViewOptions(TypedDict):
    viewType: Literal['monitor']
    options: ViewOptionsViewOptionsOptions
    freezeColumns: NotRequired[bool | None]


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
    columnVisibility: NotRequired[Mapping[str, Any] | None]
    columnOrder: NotRequired[Sequence[str] | None]
    columnSizing: NotRequired[Mapping[str, Any] | None]
    grouping: NotRequired[str | None]
    rowHeight: NotRequired[str | None]
    tallGroupRows: NotRequired[bool | None]
    layout: NotRequired[str | None]
    chartHeight: NotRequired[float | None]
    excludedMeasures: NotRequired[Sequence[ViewOptionsViewOptions1ExcludedMeasure] | None]
    yMetric: NotRequired[ViewOptionsViewOptions1YMetric | None]
    xAxis: NotRequired[ViewOptionsViewOptions1XAxis | None]
    symbolGrouping: NotRequired[ViewOptionsViewOptions1SymbolGrouping | None]
    xAxisAggregation: NotRequired[str | None]
    """
    One of 'avg', 'sum', 'min', 'max', 'median', 'all'
    """
    chartAnnotations: NotRequired[Sequence[ViewOptionsViewOptions1ChartAnnotation] | None]
    timeRangeFilter: NotRequired[str | ViewOptionsViewOptions1TimeRangeFilter | None]
    queryShape: NotRequired[Literal['traces', 'spans'] | None]
    freezeColumns: NotRequired[bool | None]


ViewOptions: TypeAlias = ViewOptionsViewOptions | ViewOptionsViewOptions1 | None
"""
Options for the view in the app
"""


class Acl(TypedDict):
    id: str
    """
    Unique identifier for the acl
    """
    object_type: AclObjectType
    object_id: str
    """
    The id of the object the ACL applies to
    """
    user_id: NotRequired[str | None]
    """
    Id of the user the ACL applies to. Exactly one of `user_id` and `group_id` will be provided
    """
    group_id: NotRequired[str | None]
    """
    Id of the group the ACL applies to. Exactly one of `user_id` and `group_id` will be provided
    """
    permission: NotRequired[Permission | None]
    restrict_object_type: NotRequired[AclObjectType | None]
    role_id: NotRequired[str | None]
    """
    Id of the role the ACL grants. Exactly one of `permission` and `role_id` will be provided
    """
    _object_org_id: str
    """
    The organization the ACL's referred object belongs to
    """
    created: NotRequired[str | None]
    """
    Date of acl creation
    """


class AnyModelParams(TypedDict):
    temperature: NotRequired[float | None]
    top_p: NotRequired[float | None]
    max_tokens: float
    max_completion_tokens: NotRequired[float | None]
    """
    The successor to max_tokens
    """
    frequency_penalty: NotRequired[float | None]
    presence_penalty: NotRequired[float | None]
    response_format: NotRequired[ResponseFormatNullish | None]
    tool_choice: NotRequired[Literal['auto'] | Literal['none'] | Literal['required'] | AnyModelParamsToolChoice | None]
    function_call: NotRequired[Literal['auto'] | Literal['none'] | AnyModelParamsFunctionCall | None]
    n: NotRequired[float | None]
    stop: NotRequired[Sequence[str] | None]
    reasoning_effort: NotRequired[Literal['none', 'minimal', 'low', 'medium', 'high'] | None]
    verbosity: NotRequired[Literal['low', 'medium', 'high'] | None]
    top_k: NotRequired[float | None]
    stop_sequences: NotRequired[Sequence[str] | None]
    reasoning_enabled: NotRequired[bool | None]
    reasoning_budget: NotRequired[float | None]
    max_tokens_to_sample: NotRequired[float | None]
    """
    This is a legacy parameter that should not be used.
    """
    maxOutputTokens: NotRequired[float | None]
    topP: NotRequired[float | None]
    topK: NotRequired[float | None]
    use_cache: NotRequired[bool | None]


class AsyncScoringControlAsyncScoringControl1(TypedDict):
    kind: Literal['state_override']
    state: AsyncScoringState


AsyncScoringControl: TypeAlias = (
    AsyncScoringControlAsyncScoringControl
    | AsyncScoringControlAsyncScoringControl1
    | AsyncScoringControlAsyncScoringControl2
    | AsyncScoringControlAsyncScoringControl3
    | AsyncScoringControlAsyncScoringControl4
    | AsyncScoringControlAsyncScoringControl5
    | AsyncScoringControlAsyncScoringControl6
)


AttachmentReference: TypeAlias = BraintrustAttachmentReference | ExternalAttachmentReference


class AttachmentStatus(TypedDict):
    upload_status: UploadStatus
    error_message: NotRequired[str | None]
    """
    Describes the error encountered while uploading.
    """


class PreprocessorPreprocessor1(TypedDict):
    type: Literal['global']
    name: str
    function_type: NotRequired[FunctionTypeEnum | None]


class PreprocessorPreprocessor4(PreprocessorPreprocessor1, PreprocessorPreprocessor2):
    pass


Preprocessor: TypeAlias = PreprocessorPreprocessor3 | PreprocessorPreprocessor4


class BatchedFacetData(TypedDict):
    type: Literal['batched_facet']
    preprocessor: NotRequired[Preprocessor | None]
    facets: Sequence[BatchedFacetDataFacet]


ChatCompletionContentPart: TypeAlias = (
    ChatCompletionContentPartTextWithTitle
    | ChatCompletionContentPartImageWithTitle
    | ChatCompletionContentPartFileWithTitle
)


class ChatCompletionMessageParamChatCompletionMessageParam1(TypedDict):
    content: str | Sequence[ChatCompletionContentPart]
    role: Literal['user']
    name: NotRequired[str | None]


class ChatCompletionMessageParamChatCompletionMessageParam2(TypedDict):
    role: Literal['assistant']
    content: NotRequired[str | Sequence[ChatCompletionContentPartText] | None]
    function_call: NotRequired[ChatCompletionMessageParamChatCompletionMessageParam2FunctionCall | None]
    name: NotRequired[str | None]
    tool_calls: NotRequired[Sequence[ChatCompletionMessageToolCall] | None]
    reasoning: NotRequired[Sequence[ChatCompletionMessageReasoning] | None]


ChatCompletionMessageParam: TypeAlias = (
    ChatCompletionMessageParamChatCompletionMessageParam
    | ChatCompletionMessageParamChatCompletionMessageParam1
    | ChatCompletionMessageParamChatCompletionMessageParam2
    | ChatCompletionMessageParamChatCompletionMessageParam3
    | ChatCompletionMessageParamChatCompletionMessageParam4
    | ChatCompletionMessageParamChatCompletionMessageParam5
    | ChatCompletionMessageParamChatCompletionMessageParam6
)


class ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam1(TypedDict):
    content: str | Sequence[ChatCompletionContentPart]
    role: Literal['user']
    name: NotRequired[str | None]


ChatCompletionOpenAIMessageParam: TypeAlias = (
    ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam
    | ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam1
    | ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam2
    | ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam3
    | ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam4
    | ChatCompletionOpenAIMessageParamChatCompletionOpenAIMessageParam5
)


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
    _pagination_key: NotRequired[str | None]
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
    input: NotRequired[Any | None]
    """
    The argument that uniquely define an input case (an arbitrary, JSON serializable object)
    """
    expected: NotRequired[Any | None]
    """
    The output of your application, including post-processing (an arbitrary, JSON serializable object)
    """
    metadata: NotRequired[DatasetEventMetadata | None]
    """
    A dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings
    """
    tags: NotRequired[Sequence[str] | None]
    """
    A list of tags to log
    """
    span_id: str
    """
    A unique identifier used to link different dataset events together as part of a full trace. See the [tracing guide](https://www.braintrust.dev/docs/instrument) for full details on tracing
    """
    root_span_id: str
    """
    A unique identifier for the trace this dataset event belongs to
    """
    is_root: NotRequired[bool | None]
    """
    Whether this span is a root span
    """
    origin: NotRequired[ObjectReferenceNullish | None]
    comments: NotRequired[Sequence[Any] | None]
    """
    Optional list of comments attached to this event
    """
    audit_data: NotRequired[Sequence[Any] | None]
    """
    Optional list of audit entries attached to this event
    """
    facets: NotRequired[Mapping[str, Any] | None]
    """
    Facets for categorization (dictionary from facet id to value)
    """
    classifications: NotRequired[Mapping[str, Any] | None]
    """
    Classifications for this event (dictionary from classification name to items)
    """


class EvalStatusPage(TypedDict):
    id: str
    """
    Unique identifier for the eval status page
    """
    project_id: str
    """
    Unique identifier for the project that the eval status page belongs under
    """
    user_id: NotRequired[str | None]
    """
    Identifies the user who created the eval status page
    """
    created: NotRequired[str | None]
    """
    Date of eval status page creation
    """
    deleted_at: NotRequired[str | None]
    """
    Date of eval status page deletion, or null if the eval status page is still active
    """
    name: str
    """
    Name of the eval status page
    """
    description: NotRequired[str | None]
    """
    Textual description of the eval status page
    """
    logo_url: NotRequired[str | None]
    """
    URL of the logo to display on the page
    """
    theme: EvalStatusPageTheme
    config: EvalStatusPageConfig


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
    description: NotRequired[str | None]
    """
    Textual description of the experiment
    """
    created: NotRequired[str | None]
    """
    Date of experiment creation
    """
    repo_info: NotRequired[RepoInfo | None]
    commit: NotRequired[str | None]
    """
    Commit, taken directly from `repo_info.commit`
    """
    base_exp_id: NotRequired[str | None]
    """
    Id of default base experiment to compare against when viewing this experiment
    """
    deleted_at: NotRequired[str | None]
    """
    Date of experiment deletion, or null if the experiment is still active
    """
    dataset_id: NotRequired[str | None]
    """
    Identifier of the linked dataset, or null if the experiment is not linked to a dataset
    """
    dataset_version: NotRequired[str | None]
    """
    Version number of the linked dataset the experiment was run against. This can be used to reproduce the experiment after the dataset has been modified.
    """
    public: bool
    """
    Whether or not the experiment is public. Public experiments can be viewed by anybody inside or outside the organization
    """
    user_id: NotRequired[str | None]
    """
    Identifies the user who created the experiment
    """
    metadata: NotRequired[Mapping[str, Any] | None]
    """
    User-controlled metadata about the experiment
    """
    tags: NotRequired[Sequence[str] | None]
    """
    A list of tags for the experiment
    """


class ExtendedSavedFunctionIdExtendedSavedFunctionId1(TypedDict):
    type: Literal['global']
    name: str
    function_type: NotRequired[FunctionTypeEnum | None]


ExtendedSavedFunctionId: TypeAlias = (
    ExtendedSavedFunctionIdExtendedSavedFunctionId
    | ExtendedSavedFunctionIdExtendedSavedFunctionId1
    | ExtendedSavedFunctionIdExtendedSavedFunctionId2
)


class Preprocessor1Preprocessor11(TypedDict):
    type: Literal['global']
    name: str
    function_type: NotRequired[FunctionTypeEnum | None]


class Preprocessor1Preprocessor14(Preprocessor1Preprocessor11, Preprocessor1Preprocessor12):
    pass


Preprocessor1: TypeAlias = Preprocessor1Preprocessor13 | Preprocessor1Preprocessor14


class FacetData(TypedDict):
    type: Literal['facet']
    preprocessor: NotRequired[Preprocessor1 | None]
    prompt: str
    """
    The prompt to use for LLM extraction. The preprocessed text will be provided as context.
    """
    model: NotRequired[str | None]
    """
    The model to use for facet extraction
    """
    no_match_pattern: NotRequired[str | None]
    """
    Regex pattern to identify outputs that do not match the facet. If the output matches, the facet will be saved as 'no_match'
    """


class FunctionDataFunctionData3(TypedDict):
    type: Literal['global']
    name: str
    function_type: NotRequired[FunctionTypeEnum | None]
    config: NotRequired[Mapping[str, Any] | None]
    """
    Configuration options to pass to the global function (e.g., for preprocessor customization)
    """


class FunctionIdFunctionId2(TypedDict):
    global_function: str
    """
    The name of the global function. Currently, the global namespace includes the functions in autoevals
    """
    function_type: NotRequired[FunctionTypeEnum | None]


class InvokeFunctionInvokeFunction7(TypedDict):
    input: NotRequired[Any | None]
    """
    Argument to the function, which can be any JSON serializable value
    """
    expected: NotRequired[Any | None]
    """
    The expected output of the function
    """
    metadata: NotRequired[Mapping[str, Any] | None]
    """
    Any relevant metadata. This will be logged and available as the `metadata` argument.
    """
    tags: NotRequired[Sequence[str] | None]
    """
    Any relevant tags to log on the span.
    """
    messages: NotRequired[Sequence[ChatCompletionMessageParam] | None]
    """
    If the function is an LLM, additional messages to pass along to it
    """
    parent: NotRequired[InvokeParent | None]
    stream: NotRequired[bool | None]
    """
    Whether to stream the response. If true, results will be returned in the Braintrust SSE format.
    """
    mode: NotRequired[StreamingMode | None]
    strict: NotRequired[bool | None]
    """
    If true, throw an error if one of the variables in the prompt is not present in the input
    """
    mcp_auth: NotRequired[Mapping[str, InvokeFunctionMcpAuth] | None]
    """
    Map of MCP server URL to auth credentials
    """
    overrides: NotRequired[Mapping[str, Any] | None]
    """
    Partial function definition to merge with the function being invoked. Fields are validated against the function type's schema at runtime. For facets: { preprocessor?, prompt?, model? }. For prompts: { model?, ... }.
    """


class InvokeFunctionInvokeFunction8(InvokeFunctionInvokeFunction, InvokeFunctionInvokeFunction7):
    pass


class InvokeFunctionInvokeFunction9(InvokeFunctionInvokeFunction1, InvokeFunctionInvokeFunction7):
    pass


class InvokeFunctionInvokeFunction10(InvokeFunctionInvokeFunction2, InvokeFunctionInvokeFunction7):
    pass


class InvokeFunctionInvokeFunction11(InvokeFunctionInvokeFunction3, InvokeFunctionInvokeFunction7):
    pass


class InvokeFunctionInvokeFunction12(InvokeFunctionInvokeFunction4, InvokeFunctionInvokeFunction7):
    pass


class ModelParamsModelParams(TypedDict):
    use_cache: NotRequired[bool | None]
    reasoning_enabled: NotRequired[bool | None]
    reasoning_budget: NotRequired[float | None]
    temperature: NotRequired[float | None]
    top_p: NotRequired[float | None]
    max_tokens: NotRequired[float | None]
    max_completion_tokens: NotRequired[float | None]
    """
    The successor to max_tokens
    """
    frequency_penalty: NotRequired[float | None]
    presence_penalty: NotRequired[float | None]
    response_format: NotRequired[ResponseFormatNullish | None]
    tool_choice: NotRequired[
        Literal['auto'] | Literal['none'] | Literal['required'] | ModelParamsModelParamsToolChoice
    ]
    function_call: NotRequired[Literal['auto'] | Literal['none'] | ModelParamsModelParamsFunctionCall | None]
    n: NotRequired[float | None]
    stop: NotRequired[Sequence[str] | None]
    reasoning_effort: NotRequired[Literal['none', 'minimal', 'low', 'medium', 'high'] | None]
    verbosity: NotRequired[Literal['low', 'medium', 'high'] | None]


ModelParams: TypeAlias = (
    ModelParamsModelParams
    | ModelParamsModelParams1
    | ModelParamsModelParams2
    | ModelParamsModelParams3
    | ModelParamsModelParams4
)


class OnlineScoreConfig(TypedDict):
    sampling_rate: float
    """
    The sampling rate for online scoring
    """
    scorers: Sequence[SavedFunctionId]
    """
    The list of functions to run for online scoring. Can include scorers, facets, or other function types.
    """
    btql_filter: NotRequired[str | None]
    """
    Filter logs using BTQL
    """
    apply_to_root_span: NotRequired[bool | None]
    """
    Whether to trigger online scoring on the root span of each trace. Only applies when scope is 'span' or unset.
    """
    apply_to_span_names: NotRequired[Sequence[str] | None]
    """
    Trigger online scoring on any spans with a name in this list. Only applies when scope is 'span' or unset.
    """
    skip_logging: NotRequired[bool | None]
    """
    Whether to skip adding scorer spans when computing scores
    """
    scope: NotRequired[SpanScope | TraceScope | GroupScope | None]
    """
    The scope at which to run the functions. Defaults to span-level execution. Trace/group scope requires all functions to be facets.
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
    description: NotRequired[str | None]
    """
    Textual description of the project
    """
    created: NotRequired[str | None]
    """
    Date of project creation
    """
    deleted_at: NotRequired[str | None]
    """
    Date of project deletion, or null if the project is still active
    """
    user_id: NotRequired[str | None]
    """
    Identifies the user who created the project
    """
    settings: NotRequired[ProjectSettings | None]


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
    user_id: NotRequired[str | None]
    """
    Identifies the user who created the project automation
    """
    created: NotRequired[str | None]
    """
    Date of project automation creation
    """
    name: str
    """
    Name of the project automation
    """
    description: NotRequired[str | None]
    """
    Textual description of the project automation
    """
    config: ProjectAutomationConfig | ProjectAutomationConfig1 | ProjectAutomationConfig2 | ProjectAutomationConfig3
    """
    The configuration for the automation rule
    """


ProjectScoreCategories: TypeAlias = Sequence[ProjectScoreCategory] | Mapping[str, float] | Sequence[str] | None


class ProjectScoreConfig(TypedDict):
    multi_select: NotRequired[bool | None]
    destination: NotRequired[str | None]
    online: NotRequired[OnlineScoreConfig | None]


class PromptBlockDataPromptBlockData(TypedDict):
    type: Literal['chat']
    messages: Sequence[ChatCompletionMessageParam]
    tools: NotRequired[str | None]


PromptBlockData: TypeAlias = PromptBlockDataPromptBlockData | PromptBlockDataPromptBlockData1


class PromptBlockDataNullishPromptBlockDataNullish(TypedDict):
    type: Literal['chat']
    messages: Sequence[ChatCompletionMessageParam]
    tools: NotRequired[str | None]


PromptBlockDataNullish: TypeAlias = (
    PromptBlockDataNullishPromptBlockDataNullish | PromptBlockDataNullishPromptBlockDataNullish1 | None
)


class PromptOptions(TypedDict):
    model: NotRequired[str | None]
    params: NotRequired[ModelParams | None]
    position: NotRequired[str | None]


class PromptOptionsNullish(TypedDict):
    model: NotRequired[str | None]
    params: NotRequired[ModelParams | None]
    position: NotRequired[str | None]


class ResponseFormatResponseFormat1(TypedDict):
    type: Literal['json_schema']
    json_schema: ResponseFormatJsonSchema


ResponseFormat: TypeAlias = (
    ResponseFormatResponseFormat | ResponseFormatResponseFormat1 | ResponseFormatResponseFormat2
)


class SpanAttributes(TypedDict):
    name: NotRequired[str | None]
    """
    Name of the span, for display purposes only
    """
    type: NotRequired[SpanType | None]


class ViewData(TypedDict):
    search: NotRequired[ViewDataSearch | None]
    custom_charts: NotRequired[Any | None]


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
    _pagination_key: NotRequired[str | None]
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
    input: NotRequired[Any | None]
    """
    The arguments that uniquely define a test case (an arbitrary, JSON serializable object). Later on, Braintrust will use the `input` to know whether two test cases are the same between experiments, so they should not contain experiment-specific state. A simple rule of thumb is that if you run the same experiment twice, the `input` should be identical
    """
    output: NotRequired[Any | None]
    """
    The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question
    """
    expected: NotRequired[Any | None]
    """
    The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate your experiments while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models
    """
    error: NotRequired[Any | None]
    """
    The error that occurred, if any.
    """
    scores: NotRequired[Mapping[str, Any] | None]
    """
    A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare experiments
    """
    metadata: NotRequired[ExperimentEventMetadata | None]
    """
    A dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings
    """
    tags: NotRequired[Sequence[str] | None]
    """
    A list of tags to log
    """
    metrics: NotRequired[ExperimentEventMetrics | None]
    """
    Metrics are numerical measurements tracking the execution of the code that produced the experiment event. Use "start" and "end" to track the time span over which the experiment event was produced
    """
    context: NotRequired[ExperimentEventContext | None]
    """
    Context is additional information about the code that produced the experiment event. It is essentially the textual counterpart to `metrics`. Use the `caller_*` attributes to track the location in code which produced the experiment event
    """
    span_id: str
    """
    A unique identifier used to link different experiment events together as part of a full trace. See the [tracing guide](https://www.braintrust.dev/docs/instrument) for full details on tracing
    """
    span_parents: NotRequired[Sequence[str] | None]
    """
    An array of the parent `span_ids` of this experiment event. This should be empty for the root span of a trace, and should most often contain just one parent element for subspans
    """
    root_span_id: str
    """
    A unique identifier for the trace this experiment event belongs to
    """
    span_attributes: NotRequired[SpanAttributes | None]
    is_root: NotRequired[bool | None]
    """
    Whether this span is a root span
    """
    origin: NotRequired[ObjectReferenceNullish | None]
    comments: NotRequired[Sequence[Any] | None]
    """
    Optional list of comments attached to this event
    """
    audit_data: NotRequired[Sequence[Any] | None]
    """
    Optional list of audit entries attached to this event
    """
    facets: NotRequired[Mapping[str, Any] | None]
    """
    Facets for categorization (dictionary from facet id to value)
    """
    classifications: NotRequired[Mapping[str, Any] | None]
    """
    Classifications for this event (dictionary from classification name to items)
    """


class GraphNodeGraphNode7(TypedDict):
    description: NotRequired[str | None]
    """
    The description of the node
    """
    position: NotRequired[GraphNodeGraphNode7Position | None]
    """
    The position of the node
    """
    type: Literal['prompt_template']
    prompt: PromptBlockData


GraphNode: TypeAlias = (
    GraphNodeGraphNode
    | GraphNodeGraphNode1
    | GraphNodeGraphNode2
    | GraphNodeGraphNode3
    | GraphNodeGraphNode4
    | GraphNodeGraphNode5
    | GraphNodeGraphNode6
    | GraphNodeGraphNode7
)


class ProjectLogsEvent(TypedDict):
    id: str
    """
    A unique identifier for the project logs event. If you don't provide one, Braintrust will generate one for you
    """
    _xact_id: str
    """
    The transaction id of an event is unique to the network operation that processed the event insertion. Transaction ids are monotonically increasing over time and can be used to retrieve a versioned snapshot of the project logs (see the `version` parameter)
    """
    _pagination_key: NotRequired[str | None]
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
    input: NotRequired[Any | None]
    """
    The arguments that uniquely define a user input (an arbitrary, JSON serializable object).
    """
    output: NotRequired[Any | None]
    """
    The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.
    """
    expected: NotRequired[Any | None]
    """
    The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.
    """
    error: NotRequired[Any | None]
    """
    The error that occurred, if any.
    """
    scores: NotRequired[Mapping[str, Any] | None]
    """
    A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare logs.
    """
    metadata: NotRequired[ProjectLogsEventMetadata | None]
    """
    A dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings
    """
    tags: NotRequired[Sequence[str] | None]
    """
    A list of tags to log
    """
    metrics: NotRequired[ProjectLogsEventMetrics | None]
    """
    Metrics are numerical measurements tracking the execution of the code that produced the project logs event. Use "start" and "end" to track the time span over which the project logs event was produced
    """
    context: NotRequired[ProjectLogsEventContext | None]
    """
    Context is additional information about the code that produced the project logs event. It is essentially the textual counterpart to `metrics`. Use the `caller_*` attributes to track the location in code which produced the project logs event
    """
    span_id: str
    """
    A unique identifier used to link different project logs events together as part of a full trace. See the [tracing guide](https://www.braintrust.dev/docs/instrument) for full details on tracing
    """
    span_parents: NotRequired[Sequence[str] | None]
    """
    An array of the parent `span_ids` of this project logs event. This should be empty for the root span of a trace, and should most often contain just one parent element for subspans
    """
    root_span_id: str
    """
    A unique identifier for the trace this project logs event belongs to
    """
    is_root: NotRequired[bool | None]
    """
    Whether this span is a root span
    """
    span_attributes: NotRequired[SpanAttributes | None]
    origin: NotRequired[ObjectReferenceNullish | None]
    comments: NotRequired[Sequence[Any] | None]
    """
    Optional list of comments attached to this event
    """
    audit_data: NotRequired[Sequence[Any] | None]
    """
    Optional list of audit entries attached to this event
    """
    _async_scoring_state: NotRequired[Any | None]
    """
    The async scoring state for this event
    """
    facets: NotRequired[Mapping[str, Any] | None]
    """
    Facets for categorization (dictionary from facet id to value)
    """
    classifications: NotRequired[Mapping[str, Any] | None]
    """
    Classifications for this event (dictionary from classification name to items)
    """


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
    created: NotRequired[str | None]
    """
    Date of project score creation
    """
    name: str
    """
    Name of the project score
    """
    description: NotRequired[str | None]
    """
    Textual description of the project score
    """
    score_type: ProjectScoreType
    categories: NotRequired[ProjectScoreCategories | None]
    config: NotRequired[ProjectScoreConfig | None]
    position: NotRequired[str | None]
    """
    An optional LexoRank-based string that sets the sort position for the score in the UI
    """


class PromptData(TypedDict):
    prompt: NotRequired[PromptBlockDataNullish | None]
    options: NotRequired[PromptOptionsNullish | None]
    parser: NotRequired[PromptParserNullish | None]
    tool_functions: NotRequired[Sequence[SavedFunctionId] | None]
    template_format: NotRequired[Literal['mustache', 'nunjucks', 'none'] | None]
    mcp: NotRequired[Mapping[str, Any] | None]
    origin: NotRequired[PromptDataOrigin | None]


class PromptDataNullish(TypedDict):
    prompt: NotRequired[PromptBlockDataNullish | None]
    options: NotRequired[PromptOptionsNullish | None]
    parser: NotRequired[PromptParserNullish | None]
    tool_functions: NotRequired[Sequence[SavedFunctionId] | None]
    template_format: NotRequired[Literal['mustache', 'nunjucks', 'none'] | None]
    mcp: NotRequired[Mapping[str, Any] | None]
    origin: NotRequired[PromptDataNullishOrigin | None]


class TaskTask5(TypedDict):
    inline_prompt: NotRequired[PromptData | None]
    inline_function: Mapping[str, Any]
    function_type: NotRequired[FunctionTypeEnum | None]
    name: NotRequired[str | None]
    """
    The name of the inline function
    """


class TaskTask6(TypedDict):
    inline_prompt: PromptData
    function_type: NotRequired[FunctionTypeEnum | None]
    name: NotRequired[str | None]
    """
    The name of the inline prompt
    """


class TaskTask13(TaskTask5, TaskTask7):
    pass


class TaskTask14(TaskTask6, TaskTask7):
    pass


Task: TypeAlias = TaskTask8 | TaskTask9 | TaskTask10 | TaskTask11 | TaskTask12 | TaskTask13 | TaskTask14


class View(TypedDict):
    id: str
    """
    Unique identifier for the view
    """
    object_type: AclObjectType
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
        'classifiers',
        'logs',
        'monitor',
        'for_review_project_log',
        'for_review_experiments',
        'for_review_datasets',
    ]
    """
    Type of object that the view corresponds to.
    """
    name: str
    """
    Name of the view
    """
    created: NotRequired[str | None]
    """
    Date of view creation
    """
    view_data: NotRequired[ViewData | None]
    options: NotRequired[ViewOptions | None]
    user_id: NotRequired[str | None]
    """
    Identifies the user who created the view
    """
    deleted_at: NotRequired[str | None]
    """
    Date of role deletion, or null if the role is still active
    """


class FunctionIdFunctionId5(TypedDict):
    inline_prompt: NotRequired[PromptData | None]
    inline_function: Mapping[str, Any]
    function_type: NotRequired[FunctionTypeEnum | None]
    name: NotRequired[str | None]
    """
    The name of the inline function
    """


class FunctionIdFunctionId6(TypedDict):
    inline_prompt: PromptData
    function_type: NotRequired[FunctionTypeEnum | None]
    name: NotRequired[str | None]
    """
    The name of the inline prompt
    """


FunctionId: TypeAlias = (
    FunctionIdFunctionId
    | FunctionIdFunctionId1
    | FunctionIdFunctionId2
    | FunctionIdFunctionId3
    | FunctionIdFunctionId4
    | FunctionIdFunctionId5
    | FunctionIdFunctionId6
)
"""
Options for identifying a function
"""


class GraphData(TypedDict):
    type: Literal['graph']
    nodes: Mapping[str, GraphNode]
    edges: Mapping[str, GraphEdge]


class InvokeFunctionInvokeFunction5(TypedDict):
    inline_prompt: NotRequired[PromptData | None]
    inline_function: Mapping[str, Any]
    function_type: NotRequired[FunctionTypeEnum | None]
    name: NotRequired[str | None]
    """
    The name of the inline function
    """


class InvokeFunctionInvokeFunction6(TypedDict):
    inline_prompt: PromptData
    function_type: NotRequired[FunctionTypeEnum | None]
    name: NotRequired[str | None]
    """
    The name of the inline prompt
    """


class InvokeFunctionInvokeFunction13(InvokeFunctionInvokeFunction5, InvokeFunctionInvokeFunction7):
    pass


class InvokeFunctionInvokeFunction14(InvokeFunctionInvokeFunction6, InvokeFunctionInvokeFunction7):
    pass


InvokeFunction: TypeAlias = (
    InvokeFunctionInvokeFunction8
    | InvokeFunctionInvokeFunction9
    | InvokeFunctionInvokeFunction10
    | InvokeFunctionInvokeFunction11
    | InvokeFunctionInvokeFunction12
    | InvokeFunctionInvokeFunction13
    | InvokeFunctionInvokeFunction14
)
"""
Options for identifying a function
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
    description: NotRequired[str | None]
    """
    Textual description of the prompt
    """
    created: NotRequired[str | None]
    """
    Date of prompt creation
    """
    prompt_data: NotRequired[PromptDataNullish | None]
    tags: NotRequired[Sequence[str] | None]
    """
    A list of tags for the prompt
    """
    metadata: NotRequired[Mapping[str, Any] | None]
    """
    User-controlled metadata about the prompt
    """
    function_type: NotRequired[FunctionTypeEnumNullish | None]


class RunEval(TypedDict):
    project_id: str
    """
    Unique identifier for the project to run the eval in
    """
    data: RunEvalData | RunEvalData1 | RunEvalData2
    """
    The dataset to use
    """
    task: Task
    scores: Sequence[FunctionId]
    """
    The functions to score the eval on
    """
    experiment_name: NotRequired[str | None]
    """
    An optional name for the experiment created by this eval. If it conflicts with an existing experiment, it will be suffixed with a unique identifier.
    """
    metadata: NotRequired[Mapping[str, Any] | None]
    """
    Optional experiment-level metadata to store about the evaluation. You can later use this to slice & dice across experiments.
    """
    parent: NotRequired[Parent | None]
    stream: NotRequired[bool | None]
    """
    Whether to stream the results of the eval. If true, the request will return two events: one to indicate the experiment has started, and another upon completion. If false, the request will return the evaluation's summary upon completion.
    """
    trial_count: NotRequired[float | None]
    """
    The number of times to run the evaluator per input. This is useful for evaluating applications that have non-deterministic behavior and gives you both a stronger aggregate measure and a sense of the variance in the results.
    """
    is_public: NotRequired[bool | None]
    """
    Whether the experiment should be public. Defaults to false.
    """
    timeout: NotRequired[float | None]
    """
    The maximum duration, in milliseconds, to run the evaluation. Defaults to undefined, in which case there is no timeout.
    """
    max_concurrency: NotRequired[float | None]
    """
    The maximum number of tasks/scorers that will be run concurrently. Defaults to 10. If null is provided, no max concurrency will be used.
    """
    base_experiment_name: NotRequired[str | None]
    """
    An optional experiment name to use as a base. If specified, the new experiment will be summarized and compared to this experiment.
    """
    base_experiment_id: NotRequired[str | None]
    """
    An optional experiment id to use as a base. If specified, the new experiment will be summarized and compared to this experiment.
    """
    git_metadata_settings: NotRequired[GitMetadataSettings | None]
    repo_info: NotRequired[RepoInfo | None]
    strict: NotRequired[bool | None]
    """
    If true, throw an error if one of the variables in the prompt is not present in the input
    """
    stop_token: NotRequired[str | None]
    """
    The token to stop the run
    """
    extra_messages: NotRequired[str | None]
    """
    A template path of extra messages to append to the conversion. These messages will be appended to the end of the conversation, after the last message.
    """
    tags: NotRequired[Sequence[str] | None]
    """
    Optional tags that will be added to the experiment.
    """
    mcp_auth: NotRequired[Mapping[str, RunEvalMcpAuth] | None]


FunctionData: TypeAlias = (
    FunctionDataFunctionData
    | FunctionDataFunctionData1
    | GraphData
    | FunctionDataFunctionData2
    | FunctionDataFunctionData3
    | FacetData
    | BatchedFacetData
)


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
    description: NotRequired[str | None]
    """
    Textual description of the prompt
    """
    created: NotRequired[str | None]
    """
    Date of prompt creation
    """
    prompt_data: NotRequired[PromptDataNullish | None]
    tags: NotRequired[Sequence[str] | None]
    """
    A list of tags for the prompt
    """
    metadata: NotRequired[Mapping[str, Any] | None]
    """
    User-controlled metadata about the prompt
    """
    function_type: NotRequired[FunctionTypeEnumNullish | None]
    function_data: FunctionData
    origin: NotRequired[FunctionOrigin | None]
    function_schema: NotRequired[FunctionFunctionSchema | None]
    """
    JSON schema for the function's parameters and return type
    """

__all__ = []
