import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  GitHubCopilotAssistantMessageEvent,
  GitHubCopilotMessageOptions,
  GitHubCopilotResumeSessionConfig,
  GitHubCopilotSession,
  GitHubCopilotSessionConfig,
} from "../../vendor-sdk-types/github-copilot";

export const gitHubCopilotChannels: {
  createSession: MaterializedChannel<
    ChannelSpec<
      [GitHubCopilotSessionConfig],
      GitHubCopilotSession,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  resumeSession: MaterializedChannel<
    ChannelSpec<
      [string, GitHubCopilotResumeSessionConfig],
      GitHubCopilotSession,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  sendAndWait: MaterializedChannel<
    ChannelSpec<
      [GitHubCopilotMessageOptions, number?],
      GitHubCopilotAssistantMessageEvent | undefined,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@github/copilot-sdk",
    {
      createSession: channel<
        [GitHubCopilotSessionConfig],
        GitHubCopilotSession
      >({
        channelName: "client.createSession",
        kind: "async",
      }),
      resumeSession: channel<
        [string, GitHubCopilotResumeSessionConfig],
        GitHubCopilotSession
      >({
        channelName: "client.resumeSession",
        kind: "async",
      }),
      sendAndWait: channel<
        [GitHubCopilotMessageOptions, number?],
        GitHubCopilotAssistantMessageEvent | undefined
      >({
        channelName: "session.sendAndWait",
        kind: "async",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.GITHUB_COPILOT },
  ))();
