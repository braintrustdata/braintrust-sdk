type Failure = {
  testName: string;
  message?: string;
  error?: string;
  stack?: string;
};

export type SmokeSectionResult = {
  name: string;
  completed: boolean;
  passed: number;
  failed: number;
  failures: Failure[];
};

export type BrowserSmokeResults = {
  completed: boolean;
  startedAt: number;
  finishedAt?: number;
  sections: Record<string, SmokeSectionResult>;
  unhandledErrors: Failure[];
  logs: string[];
};

function toFailure(testName: string, err: unknown, message?: string): Failure {
  const e = err as Error | undefined;
  let serialized: string | undefined;
  if (!e?.message) {
    if (typeof err === "string") {
      serialized = err;
    } else {
      try {
        serialized = JSON.stringify(err);
      } catch {
        serialized = String(err);
      }
    }
  }
  return {
    testName,
    message,
    error: e?.message || serialized || String(err),
    stack: e?.stack,
  };
}

export type BrowserHarness = {
  results: BrowserSmokeResults;
  section(name: string): SmokeSectionResult;
  log(line: string): void;
  fail(
    sectionName: string,
    testName: string,
    err: unknown,
    message?: string,
  ): void;
  pass(sectionName: string, testName: string, message?: string): void;
  completeSection(name: string): void;
  completeAll(): void;
};

export function createBrowserHarness(outputEl: HTMLElement): BrowserHarness {
  const results: BrowserSmokeResults = {
    completed: false,
    startedAt: Date.now(),
    sections: {},
    unhandledErrors: [],
    logs: [],
  };

  const appendLine = (line: string, color?: string) => {
    const p = document.createElement("p");
    if (color) p.style.color = color;
    p.textContent = line;
    outputEl.appendChild(p);
  };

  const log = (line: string) => {
    results.logs.push(line);
    if (results.logs.length > 200) results.logs.shift();
    console.log(line);
    appendLine(line);
  };

  const logError = (line: string, err?: unknown) => {
    results.logs.push(line);
    if (results.logs.length > 200) results.logs.shift();
    console.error(line, err);
    appendLine(line, "red");
  };

  const section = (name: string): SmokeSectionResult => {
    if (!results.sections[name]) {
      results.sections[name] = {
        name,
        completed: false,
        passed: 0,
        failed: 0,
        failures: [],
      };
    }
    return results.sections[name];
  };

  const pass = (sectionName: string, testName: string, message?: string) => {
    const s = section(sectionName);
    s.passed += 1;
    log(`✓ [${sectionName}] ${testName}${message ? `: ${message}` : ""}`);
  };

  const fail = (
    sectionName: string,
    testName: string,
    err: unknown,
    message?: string,
  ) => {
    const s = section(sectionName);
    s.failed += 1;
    const failure = toFailure(testName, err, message);
    s.failures.push(failure);
    logError(
      `✗ [${sectionName}] ${testName}${message ? `: ${message}` : ""}`,
      err,
    );
  };

  window.addEventListener("error", (event) => {
    const failure = toFailure(
      "window.error",
      event.error || event.message,
      "Unhandled error",
    );
    results.unhandledErrors.push(failure);
    logError("✗ [runtime] Unhandled error", event.error || event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const failure = toFailure(
      "window.unhandledrejection",
      event.reason,
      "Unhandled promise rejection",
    );
    results.unhandledErrors.push(failure);
    logError("✗ [runtime] Unhandled promise rejection", event.reason);
  });

  const completeSection = (name: string) => {
    section(name).completed = true;
  };

  const completeAll = () => {
    results.completed = true;
    results.finishedAt = Date.now();
  };

  return { results, section, log, fail, pass, completeSection, completeAll };
}
