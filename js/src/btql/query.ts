import { Expr, ParsedQuery } from "./ast";

export type BTQLObjectType =
  | "experiment"
  | "dataset"
  | "prompt_session"
  | "playground_logs"
  | "project_logs"
  | "project_prompts"
  | "project_functions";

/**
 * BTQL query builder and execution class
 * Provides a fluent API for building and executing BTQL queries
 */
export class BTQL {
  queryObj: ParsedQuery = {};

  private constructor(queryObj: ParsedQuery) {
    this.queryObj = queryObj;
  }

  /**
   * Static factory method to create a new BTQL query instance
   * @param objectType The type of object to query
   * @param objectIds Optional array of specific object IDs to query
   */
  static from(objectType: BTQLObjectType, ...objectIds: string[]): BTQL {
    const btql = new BTQL({});
    return btql.from(objectType, ...objectIds);
  }

  /**
   * Specify the data source for the query
   * @param objectType The type of object to query
   * @param objectIds Optional array of specific object IDs to query
   */
  from(objectType: BTQLObjectType, ...objectIds: string[]): BTQL {
    return new BTQL({
      ...this.queryObj,
      from: {
        op: "function" as const,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        name: { op: "ident", name: [objectType] },
        args: objectIds.map((id) => ({
          op: "literal",
          value: id,
        })),
      },
    });
  }

  /**
   * Add fields to select in the query
   * @param fields Field names to select or expressions
   */
  select(...fields: (string | { expr: Expr | string; alias: string })[]): BTQL {
    if (!this.queryObj.select) {
      this.queryObj.select = [];
    }

    for (const field of fields) {
      if (field === "*") {
        this.queryObj.select.push({ op: "star" });
      } else if (typeof field === "string") {
        // Simple field name
        this.queryObj.select.push({
          expr: { op: "ident", name: [field] },
          alias: field,
        });
      } else if (typeof field === "object" && "expr" in field) {
        const { expr, alias } = field;
        // Expression with alias
        if (typeof expr === "string") {
          this.queryObj.select.push({
            expr: { btql: expr },
            alias,
          });
        } else {
          this.queryObj.select.push({
            expr,
            alias,
          });
        }
      }
    }
    return this;
  }

  /**
   * Add a filter condition to the query
   * @param conditions Filter expressions
   */
  filter(...conditions: Expr[]): BTQL {
    if (conditions.length === 0) return this;

    // Combine multiple conditions with AND
    let filterExpr: Expr = { op: "literal", value: true };
    if (conditions.length === 1) {
      filterExpr = conditions[0];
    } else {
      filterExpr = this.and(...conditions);
    }

    this.queryObj.filter = filterExpr;
    return this;
  }

  /**
   * Add a sort expression to the query
   * @param fields Fields to sort by with optional direction
   */
  sort(...fields: (string | { field: string; dir: "asc" | "desc" })[]): BTQL {
    if (!this.queryObj.sort) {
      this.queryObj.sort = [];
    }

    for (const field of fields) {
      if (typeof field === "string") {
        this.queryObj.sort.push({
          expr: { op: "ident", name: [field] },
          dir: "asc",
        });
      } else {
        this.queryObj.sort.push({
          expr: { op: "ident", name: [field.field] },
          dir: field.dir,
        });
      }
    }
    return this;
  }

  /**
   * Set a limit on the number of results
   * @param limit Maximum number of results to return
   */
  limit(limit: number): BTQL {
    this.queryObj.limit = limit;
    return this;
  }

  /**
   * Add dimensions for aggregation
   * @param dimensions Dimension fields
   */
  dimensions(...dimensions: (string | { expr: Expr; alias: string })[]): BTQL {
    if (!this.queryObj.dimensions) {
      this.queryObj.dimensions = [];
    }

    for (const dim of dimensions) {
      if (typeof dim === "string") {
        this.queryObj.dimensions.push({
          expr: { op: "ident", name: [dim] },
          alias: dim,
        });
      } else {
        this.queryObj.dimensions.push(dim);
      }
    }
    return this;
  }

  /**
   * Add measures for aggregation
   * @param measures Measure fields
   */
  measures(...measures: (string | { expr: Expr; alias: string })[]): BTQL {
    if (!this.queryObj.measures) {
      this.queryObj.measures = [];
    }

    for (const measure of measures) {
      if (typeof measure === "string") {
        this.queryObj.measures.push({
          expr: { op: "ident", name: [measure] },
          alias: measure,
        });
      } else {
        this.queryObj.measures.push(measure);
      }
    }
    return this;
  }

  /**
   * Create a logical AND of multiple expressions
   */
  and(...expressions: Expr[]): Expr {
    if (expressions.length === 0) {
      return { op: "literal", value: true };
    }
    if (expressions.length === 1) {
      return expressions[0];
    }

    let result = expressions[0];
    for (let i = 1; i < expressions.length; i++) {
      result = {
        op: "and",
        left: result,
        right: expressions[i],
      };
    }
    return result;
  }

  /**
   * Create a logical OR of multiple expressions
   */
  or(...expressions: Expr[]): Expr {
    if (expressions.length === 0) {
      return { op: "literal", value: false };
    }
    if (expressions.length === 1) {
      return expressions[0];
    }

    let result = expressions[0];
    for (let i = 1; i < expressions.length; i++) {
      result = {
        op: "or",
        left: result,
        right: expressions[i],
      };
    }
    return result;
  }

  /**
   * Get the built query object
   */
  getQuery(): ParsedQuery {
    return this.queryObj;
  }

  /**
   * Execute the query and return results
   * This needs to be implemented by the SDK client
   */
  async execute<T = unknown>(): Promise<T> {
    // Implementation would depend on how your SDK makes API calls
    // For example:
    // return apiClient.executeQuery(this.getQuery());
    throw new Error(
      "Not implemented: Override this method or implement in subclass",
    );
  }

  /**
   * Convert the query to a BTQL string representation
   */
  toString(): string {
    return JSON.stringify(this.queryObj, null, 2);
  }
}
