import type { StartEvent } from "./types";
import { isObject, mergeDicts } from "../../util";

export type ChannelConfig = {
  name: string;
  type: string;
};

type ChannelSpanInfo = {
  name?: string;
  spanAttributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

function getChannelSpanInfo(event: StartEvent): ChannelSpanInfo | undefined {
  const fromContext = (event as Record<string, unknown>).span_info;
  if (isObject(fromContext)) {
    return fromContext as ChannelSpanInfo;
  }

  const firstArg = event.arguments?.[0];
  if (
    isObject(firstArg) &&
    isObject((firstArg as Record<string, unknown>).span_info)
  ) {
    return (firstArg as Record<string, unknown>).span_info as ChannelSpanInfo;
  }

  return undefined;
}

export function buildStartSpanArgs(
  config: ChannelConfig,
  event: StartEvent,
): {
  name: string;
  spanAttributes: Record<string, unknown>;
  spanInfoMetadata: Record<string, unknown> | undefined;
} {
  const spanInfo = getChannelSpanInfo(event);
  const spanAttributes: Record<string, unknown> = {
    type: config.type,
  };

  if (isObject(spanInfo?.spanAttributes)) {
    mergeDicts(spanAttributes, spanInfo.spanAttributes);
  }

  return {
    name:
      typeof spanInfo?.name === "string" && spanInfo.name
        ? spanInfo.name
        : config.name,
    spanAttributes,
    spanInfoMetadata: isObject(spanInfo?.metadata)
      ? spanInfo.metadata
      : undefined,
  };
}

export function mergeInputMetadata(
  metadata: unknown,
  spanInfoMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!spanInfoMetadata) {
    return isObject(metadata)
      ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        (metadata as Record<string, unknown>)
      : undefined;
  }

  const mergedMetadata: Record<string, unknown> = {};
  mergeDicts(mergedMetadata, spanInfoMetadata);

  if (isObject(metadata)) {
    mergeDicts(mergedMetadata, metadata as Record<string, unknown>);
  }

  return mergedMetadata;
}
