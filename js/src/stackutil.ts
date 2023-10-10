import * as path from "path";

import { CallerLocation } from "./isomorph";

export interface StackTraceEntry {
  functionName: string;
  fileName: string;
  lineNo: number;
}

export function getStackTrace(): StackTraceEntry[] {
  const trace = new Error().stack;
  if (trace === undefined) {
    return [];
  }
  const traceLines = trace.split("\n");
  const out: StackTraceEntry[] = [];
  const stackFrameRegex = /at(.*)\((.*):(\d+):(\d+)\)/;
  for (const traceLine of traceLines.slice(1)) {
    const matches = traceLine.match(stackFrameRegex);
    if (matches === null || matches.length !== 5) {
      continue;
    }
    const entry: StackTraceEntry = {
      functionName: matches[1].trim(),
      fileName: matches[2],
      lineNo: parseInt(matches[3]),
    };
    if (!isNaN(entry.lineNo)) {
      out.push(entry);
    }
  }
  return out;
}

// Fetches the first StackTraceEntry not contained inside the same directory as
// this file and converts it into a CallerLocation.
export function getCallerLocation(): CallerLocation | undefined {
  let thisDir: string | undefined = undefined;
  const entries = getStackTrace();
  for (const frame of entries) {
    if (thisDir === undefined) {
      thisDir = path.dirname(frame.fileName);
    }
    if (path.dirname(frame.fileName) !== thisDir) {
      return {
        caller_function_name: frame.functionName,
        caller_file_name: frame.fileName,
        caller_line_num: frame.lineNo,
      };
    }
  }
  return undefined;
}
