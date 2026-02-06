#!/usr/bin/env node
/**
 * Minimal mock Braintrust API server for CI testing.
 * Accepts SDK API calls and returns success responses.
 */

const http = require("http");
const url = require("url");

const PORT = process.env.PORT || 8001;
const HOST = process.env.HOST || "0.0.0.0";
const BASE_URL = `http://localhost:${PORT}`;

// Mock responses for various endpoints
const mockResponses = {
  "/api/apikey/login": {
    org_info: [
      {
        id: "mock-org-id",
        name: "mock-org",
        api_url: BASE_URL,
        proxy_url: BASE_URL,
        is_universal_api: true,
        git_metadata: {},
      },
    ],
  },
  "/api/project/register": {
    project: { id: "mock-project-id", name: "test-project" },
  },
  "/api/experiment/register": {
    project: { id: "mock-project-id", name: "test-project" },
    experiment: {
      id: "mock-experiment-id",
      name: "test-experiment",
      created: new Date().toISOString(),
    },
  },
  "/api/dataset/register": {
    project: { id: "mock-project-id", name: "test-project" },
    dataset: { id: "mock-dataset-id", name: "test-dataset" },
  },
  "/api/base_experiment/get_id": { id: "mock-base-experiment-id" },
  "/api/experiment/get": { id: "mock-experiment-id", name: "test-experiment" },
  "/version": { version: "1.0.0", logs3_payload_max_bytes: 6291456 },
  "/logs3": { success: true },
  "/logs3/overflow": {
    method: "PUT",
    signedUrl: `${BASE_URL}/mock-upload`,
    key: "mock-overflow-key",
    headers: {},
  },
  "/attachment": {
    id: "mock-attachment-id",
    url: `${BASE_URL}/mock-attachment`,
  },
  "/mock-upload": { success: true },
  "/mock-attachment": { content: "mock attachment data" },
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;

  // Log request for debugging
  console.log(`[${new Date().toISOString()}] ${req.method} ${path}`);

  // Collect body data
  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", () => {
    // Handle all requests
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // Find matching mock response
    let response = mockResponses[path];

    // If no exact match, try to find a pattern match
    if (!response) {
      for (const [pattern, mockResp] of Object.entries(mockResponses)) {
        if (path.startsWith(pattern) || path.includes(pattern)) {
          response = mockResp;
          break;
        }
      }
    }

    // Default success response if no match found
    if (!response) {
      response = { success: true, message: `Mock response for ${path}` };
    }

    res.writeHead(200);
    res.end(JSON.stringify(response));
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Mock Braintrust API server running at http://${HOST}:${PORT}`);
  console.log(`Ready to accept SDK test requests`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
