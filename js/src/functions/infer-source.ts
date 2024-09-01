import { SourceMapConsumer } from "source-map";
import * as fs from "fs/promises";
import { EvaluatorFile, scorerName, warning } from "../framework";
import { loadModule } from "./load-module";
import { CodeBundle } from "@braintrust/core/typespecs/dist";

interface SourceMapContext {
  inFiles: Record<string, string[]>;
  outFileModule: EvaluatorFile;
  outFileLines: string[];
  sourceMap: SourceMapConsumer;
}

export async function makeSourceMapContext({
  inFile,
  outFile,
  sourceMapFile,
}: {
  inFile: string;
  outFile: string;
  sourceMapFile: string;
}): Promise<SourceMapContext> {
  const [inFileContents, outFileContents, sourceMap] = await Promise.all([
    fs.readFile(inFile, "utf8"),
    fs.readFile(outFile, "utf8"),
    (async () => {
      const sourceMap = await fs.readFile(sourceMapFile, "utf8");
      const sourceMapJSON = JSON.parse(sourceMap);
      return new SourceMapConsumer(sourceMapJSON);
    })(),
  ]);
  return {
    inFiles: { [inFile]: inFileContents.split("\n") },
    outFileModule: loadModule({ inFile, moduleText: outFileContents }),
    outFileLines: outFileContents.split("\n"),
    sourceMap,
  };
}

function isNative(fn: Function): boolean {
  return /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(fn));
}

export async function findCodeDefinition({
  location,
  ctx: { inFiles, outFileModule, outFileLines, sourceMap },
}: {
  location: CodeBundle["location"];
  ctx: SourceMapContext;
}): Promise<string | undefined> {
  const evaluator = outFileModule.evaluators[location.eval_name]?.evaluator;
  if (!evaluator) {
    console.warn(
      warning(
        `Failed to find evaluator for ${location.eval_name}. Will not display preview.`,
      ),
    );
    return undefined;
  }

  const fn =
    location.position.type === "task"
      ? evaluator.task
      : evaluator.scores[location.position.index];

  if (!fn) {
    console.warn(
      warning(
        `Failed to find ${location.position.type} for ${location.eval_name}. Will not display preview.`,
      ),
    );
    return undefined;
  }

  const sourceCode = fn.toString();
  if (isNative(fn)) {
    return undefined;
  }
  let lineNumber = 0;
  let columnNumber = -1;
  //   console.log("Source code:", sourceCode);
  for (const line of outFileLines) {
    const sourceDefinition = line.indexOf(sourceCode);
    if (sourceDefinition !== -1) {
      //   console.log("FOO BAR BING!!!", lineNumber, sourceDefinition);
      columnNumber = sourceDefinition;
      break;
    }
    lineNumber++;
  }

  if (columnNumber === -1) {
    console.warn(warning(`Failed to find code definition for ${fn.name}`));
    return undefined;
  }
  const originalPosition = sourceMap.originalPositionFor({
    line: lineNumber + 1,
    column: columnNumber,
  });

  if (originalPosition.source === null || originalPosition.line === null) {
    return undefined;
  }

  if (!inFiles[originalPosition.source]) {
    inFiles[originalPosition.source] = (
      await fs.readFile(originalPosition.source, "utf-8")
    ).split("\n");
  }

  const originalLines = inFiles[originalPosition.source];

  // Extract the function definition
  let functionDefinition = "";
  let bracketCount = 0;
  for (let i = originalPosition.line - 1; i < originalLines.length; i++) {
    const line = originalLines[i];
    functionDefinition += line + "\n";
    bracketCount += (line.match(/{/g) || []).length;
    bracketCount -= (line.match(/}/g) || []).length;
    if (bracketCount === 0 && functionDefinition.trim().length > 0) {
      break;
    }
  }

  const ret = functionDefinition.trim();
  return ret.length === 0 ? undefined : ret.slice(0, 10240);
}
