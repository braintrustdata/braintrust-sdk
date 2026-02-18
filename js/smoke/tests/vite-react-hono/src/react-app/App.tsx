import { useState } from "react";
import "./App.css";

function App() {
  const [testResult, setTestResult] = useState<string>("Not run");
  const [isRunning, setIsRunning] = useState(false);

  const runSmokeTest = async () => {
    setIsRunning(true);
    setTestResult("Running tests...");

    try {
      const response = await fetch("/api/test");
      const result = await response.json();

      if (result.success) {
        setTestResult(
          `✅ All ${result.totalTests} tests passed!\n${result.message}`,
        );
      } else {
        setTestResult(
          `❌ ${result.failedTests}/${result.totalTests} tests failed\n${result.message}`,
        );
      }
    } catch (error) {
      setTestResult(
        `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="App">
      <h1>Braintrust Vite + React + Hono Smoke Test</h1>
      <div className="card">
        <button onClick={runSmokeTest} disabled={isRunning}>
          {isRunning ? "Running..." : "Run Smoke Tests"}
        </button>
        <pre
          style={{
            textAlign: "left",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {testResult}
        </pre>
      </div>
    </div>
  );
}

export default App;
