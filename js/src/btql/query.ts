import parsedQuerySchema from "./schema";
import type { ParsedQuery } from "./types";

export interface BTQLQueryOptions {
  apiKey?: string;
  apiUrl?: string;
}

export interface BTQLQueryResult<T = Record<string, unknown>> {
  data?: T[];
}

async function executeBTQLQuery<T = Record<string, unknown>>(
  query: string,
  options?: BTQLQueryOptions,
): Promise<BTQLQueryResult<T>> {
  const baseUrl =
    options?.apiUrl ??
    (typeof process !== "undefined" && process.env?.BRAINTRUST_API_URL) ??
    "https://api.braintrust.dev";
  const authKey =
    options?.apiKey ??
    (typeof process !== "undefined" && process.env?.BRAINTRUST_API_KEY);

  if (!authKey) {
    throw new Error("BRAINTRUST_API_KEY is required to query BTQL");
  }

  const response = await fetch(`${baseUrl}/btql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`BTQL query failed: ${response.status} ${text}`);
  }

  return (await response.json()) as BTQLQueryResult<T>;
}

async function executeBTQLQueryFromObject<T = Record<string, unknown>>(
  queryObj: ParsedQuery,
  options?: BTQLQueryOptions,
): Promise<BTQLQueryResult<T>> {
  const baseUrl =
    options?.apiUrl ??
    (typeof process !== "undefined" && process.env?.BRAINTRUST_API_URL) ??
    "https://api.braintrust.dev";
  const authKey =
    options?.apiKey ??
    (typeof process !== "undefined" && process.env?.BRAINTRUST_API_KEY);

  if (!authKey) {
    throw new Error("BRAINTRUST_API_KEY is required to query BTQL");
  }

  const response = await fetch(`${baseUrl}/btql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: queryObj }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`BTQL query failed: ${response.status} ${text}`);
  }

  return (await response.json()) as BTQLQueryResult<T>;
}

type QueryInput = ParsedQuery | Record<string, unknown>;

const materializeQuery = (value: QueryInput): ParsedQuery => {
  return parsedQuerySchema.parse(value) as ParsedQuery;
};

export class Query<T = Record<string, unknown>> {
  private queryObj?: ParsedQuery;
  private rawQuery?: string;
  private options: BTQLQueryOptions;

  private constructor(options: BTQLQueryOptions = {}) {
    this.options = options;
  }

  /**
   * Create a Query from a structured BTQL query object.
   *
   * This method provides full TypeScript type checking for query structure.
   * If you're having trouble with types or need to construct queries dynamically,
   * consider using `fromString()` instead and passing a BTQL string query.
   *
   * @example
   * ```typescript
   * import { Query, type ParsedQuery } from "braintrust";
   *
   * const query: ParsedQuery = {
   *   from: {
   *     op: "function",
   *     name: { op: "ident", name: ["project_logs"] },
   *     args: [{ op: "literal", value: projectId }],
   *   },
   *   select: [{ expr: { op: "ident", name: ["id"] }, alias: "id" }],
   *   limit: 10,
   * };
   *
   * const result = await Query.fromObject(query).execute();
   * ```
   *
   * @param query - A ParsedQuery object with strict type checking
   * @param options - Optional configuration (API key, API URL)
   * @returns A Query instance ready to execute
   */
  static fromObject(
    query: QueryInput,
    options?: BTQLQueryOptions,
  ): Query<Record<string, unknown>> {
    const validated = materializeQuery(query);
    const instance = new Query(options);
    instance.queryObj = validated;
    return instance;
  }

  /**
   * Create a Query from a BTQL string.
   *
   * Use this method when you need to construct queries dynamically or bypass
   * TypeScript type checking. The query string will be validated at runtime
   * when executed.
   *
   * @example
   * ```typescript
   * import { Query } from "braintrust";
   *
   * const query = `
   *   SELECT id, created, input, output
   *   FROM project_logs('${projectId}')
   *   WHERE error IS NOT NULL
   *   LIMIT 10
   * `;
   *
   * const result = await Query.fromString(query).execute();
   * ```
   *
   * @param query - A BTQL query string
   * @param options - Optional configuration (API key, API URL)
   * @returns A Query instance ready to execute
   */
  static fromString(
    query: string,
    options?: BTQLQueryOptions,
  ): Query<Record<string, unknown>> {
    const instance = new Query(options);
    instance.rawQuery = query;
    return instance;
  }

  toInternalBtql(): ParsedQuery {
    if (this.rawQuery) {
      throw new Error(
        "Cannot convert raw BTQL string queries to internal BTQL structure",
      );
    }
    if (this.queryObj) {
      return this.queryObj;
    }
    throw new Error("No query specified");
  }

  async execute(): Promise<BTQLQueryResult<T>> {
    if (this.rawQuery) {
      return await executeBTQLQuery<T>(this.rawQuery, this.options);
    }

    if (this.queryObj) {
      return await executeBTQLQueryFromObject<T>(this.queryObj, this.options);
    }

    throw new Error("No query specified");
  }
}

export type { ParsedQuery };
