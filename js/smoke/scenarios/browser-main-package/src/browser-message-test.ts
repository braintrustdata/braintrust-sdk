// Import from main package - should resolve to browser build via "browser" field
import * as braintrust from "braintrust";

declare global {
  interface Window {
    __btBrowserMessageTest?: {
      completed: boolean;
      consoleMessages: string[];
      importSuccessful: boolean;
      hasInit: boolean;
      hasNewId: boolean;
      hasTraceable: boolean;
    };
  }
}

// Capture console.info messages
const capturedMessages: string[] = [];
const originalConsoleInfo = console.info;
console.info = (...args: any[]) => {
  const message = args.join(" ");
  capturedMessages.push(message);
  originalConsoleInfo.apply(console, args);
};

// Test that imports work
const importSuccessful = true;
const hasInit = typeof braintrust.init === "function";
const hasNewId = typeof braintrust.newId === "function";
const hasTraceable = typeof braintrust.traceable === "function";

// Store results
window.__btBrowserMessageTest = {
  completed: true,
  consoleMessages: capturedMessages,
  importSuccessful,
  hasInit,
  hasNewId,
  hasTraceable,
};

// Display results
const output = document.getElementById("output");
if (output) {
  output.innerHTML = `
    <h2>Test Results</h2>
    <ul>
      <li>Import successful: ${importSuccessful ? "✓" : "✗"}</li>
      <li>Has init function: ${hasInit ? "✓" : "✗"}</li>
      <li>Has newId function: ${hasNewId ? "✓" : "✗"}</li>
      <li>Has traceable function: ${hasTraceable ? "✓" : "✗"}</li>
      <li>Console messages captured: ${capturedMessages.length}</li>
    </ul>
    <h3>Console Messages:</h3>
    <pre>${capturedMessages.join("\n")}</pre>
  `;
}
