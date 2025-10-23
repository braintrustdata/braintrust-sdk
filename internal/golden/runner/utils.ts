import fs from "fs";
import path from "path";
import { Span } from "braintrust";
import { TEST_FUNCTION_PREFIX } from "./constants";

export const toSnakeCase = (text: string): string => {
  return text
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
};

export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

export const isTestExample = (
  key: string,
  value: unknown,
): value is () => Promise<Span> => {
  return typeof value === "function" && key.startsWith(TEST_FUNCTION_PREFIX);
};

// Helper to serialize errors properly for JSON
const serializeError = (obj: unknown): unknown => {
  if (obj instanceof Error) {
    return {
      message: obj.message,
      stack: obj.stack,
      name: obj.name,
    };
  }
  if (obj && typeof obj === "object") {
    if (Array.isArray(obj)) {
      return obj.map(serializeError);
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeError(value);
    }
    return result;
  }
  return obj;
};

export const saveResult = async (
  filePath: string,
  testName: string,
  data: {
    testFile: string;
    testName: string;
    spans: unknown;
    normalized: unknown;
    lingua: unknown;
  },
): Promise<void> => {
  // Create folder name from file path
  const dirName = path.dirname(filePath);
  const baseName = path.basename(filePath, ".ts");
  const folderName = slugify(baseName) + "-ts";
  const outputDir = path.join(dirName, folderName);

  // Create directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Convert test name to snake_case (don't slugify to preserve underscores)
  const baseFileName = toSnakeCase(testName);

  // Save raw spans
  const rawPath = path.join(outputDir, `${baseFileName}.raw.json`);
  await fs.promises.writeFile(
    rawPath,
    JSON.stringify(data.spans, null, 2),
    "utf-8",
  );

  // Save normalized result
  const normalizedPath = path.join(
    outputDir,
    `${baseFileName}.normalized.json`,
  );
  await fs.promises.writeFile(
    normalizedPath,
    JSON.stringify(serializeError(data.normalized), null, 2),
    "utf-8",
  );

  // Save lingua result
  const linguaPath = path.join(outputDir, `${baseFileName}.lingua.json`);
  await fs.promises.writeFile(
    linguaPath,
    JSON.stringify(serializeError(data.lingua), null, 2),
    "utf-8",
  );

  console.error(
    `    Saved to: ${outputDir}/${baseFileName}.[raw|normalized|lingua].json`,
  );
};
