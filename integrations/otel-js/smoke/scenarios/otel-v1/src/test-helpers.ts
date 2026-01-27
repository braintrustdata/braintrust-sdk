import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockOtlpCollector {
  url: string;
  payloads: unknown[];
  cleanup: () => Promise<void>;
}

/**
 * Sets up a mock OTLP collector HTTP server that captures trace payloads.
 * Returns the server URL, captured payloads array, and cleanup function.
 */
export async function setupMockOtlpCollector(): Promise<MockOtlpCollector> {
  const payloads: unknown[] = [];

  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/otel/v1/traces") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString();
          if (body.length > 0) {
            payloads.push(JSON.parse(body));
          }
        } catch (error) {
          res.writeHead(500).end();
          throw error;
        }
        res.writeHead(200).end();
      });
      return;
    }
    res.writeHead(404).end();
  });

  const url = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addressInfo = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addressInfo.port}/`);
    });
  });

  return {
    url,
    payloads,
    cleanup: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
