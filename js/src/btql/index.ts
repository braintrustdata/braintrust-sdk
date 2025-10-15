/**
 * BTQL (Braintrust Query Language) type definitions and query builder.
 *
 * This module provides type-safe query building using TypeScript types.
 * Import types and operators from here to build BTQL queries programmatically.
 *
 * @example
 * ```typescript
 * import { Query, ParsedQuery, Ident, FunctionExpr, AliasExpr } from "braintrust/btql";
 *
 * const query: ParsedQuery = {
 *   from: { op: "function", name: { op: "ident", name: ["project_logs"] }, args: [...] },
 *   select: [{ expr: { op: "ident", name: ["id"] }, alias: "id" }],
 *   limit: 10,
 * };
 *
 * const result = await Query.fromObject(query).execute();
 * ```
 */

export { Query, BTQLQueryResult } from "./query";
export type * from "./types";
