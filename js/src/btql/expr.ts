import { Expr, ComparisonOp, LiteralValue, Ident } from "./ast";

/**
 * Interface for the base field object
 */
interface FieldObject {
  _fieldName: (string | number)[];
  _toField(): Ident;
  eq(value: unknown): Expr;
  ne(value: unknown): Expr;
  gt(value: unknown): Expr;
  lt(value: unknown): Expr;
  ge(value: unknown): Expr;
  le(value: unknown): Expr;
  includes(value: unknown): Expr;
  is(value: unknown): Expr;
  isNull(): Expr;
  isNotNull(): Expr;
  match(value: string): Expr;
  get(prop: string): FieldProxy;

  /**
   * @deprecated Use `match` instead
   */
  like(value: string): Expr;
  /**
   * @deprecated Use `match` instead
   */
  ilike(value: string): Expr;
}

/**
 * Type for the proxy that adds property access for nested fields
 */
export type FieldProxy = FieldObject & {
  [key: string]: FieldProxy;
};

/**
 * Checks if a value is a field object
 */
function isFieldObject(value: unknown): value is FieldObject {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    "_toField" in (value as object)
  );
}

/**
 * Creates a field reference for use in BTQL expressions
 * @param name The field name or path
 * @returns A proxy object that provides methods for building expressions
 */
export function field(name: string | (string | number)[]): FieldProxy {
  const baseField: FieldObject = {
    _fieldName: Array.isArray(name) ? name : [name],

    // Helper to create the field expression
    _toField(): Ident {
      return { op: "ident", name: this._fieldName };
    },

    // Standard comparison methods
    eq(value: unknown): Expr {
      return createComparisonExpr("eq", this._toField(), value);
    },

    ne(value: unknown): Expr {
      return createComparisonExpr("ne", this._toField(), value);
    },

    gt(value: unknown): Expr {
      return createComparisonExpr("gt", this._toField(), value);
    },

    lt(value: unknown): Expr {
      return createComparisonExpr("lt", this._toField(), value);
    },

    ge(value: unknown): Expr {
      return createComparisonExpr("ge", this._toField(), value);
    },

    le(value: unknown): Expr {
      return createComparisonExpr("le", this._toField(), value);
    },

    /**
     * @deprecated Use `match` instead
     */
    like(value: string): Expr {
      return createComparisonExpr("like", this._toField(), value);
    },

    /**
     * @deprecated Use `match` instead
     */
    ilike(value: string): Expr {
      return createComparisonExpr("ilike", this._toField(), value);
    },

    includes(value: unknown): Expr {
      return {
        op: "includes",
        haystack: this._toField(),
        needle: isFieldObject(value)
          ? value._toField()
          : // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            { op: "literal", value: value as LiteralValue },
      };
    },

    is(value: unknown): Expr {
      return createComparisonExpr("is", this._toField(), value);
    },

    isNull(): Expr {
      return {
        op: "isnull",
        expr: this._toField(),
      };
    },

    isNotNull(): Expr {
      return {
        op: "isnotnull",
        expr: this._toField(),
      };
    },

    match(value: string): Expr {
      return createComparisonExpr("match", this._toField(), value);
    },

    // Method for nested properties
    get(prop: string): FieldProxy {
      return field([...this._fieldName, prop]);
    },
  };

  // Create and return a proxy for the field
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return new Proxy(baseField, {
    get(target, prop, receiver) {
      // Return existing methods/properties
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }

      // Handle nested fields when property access is used
      if (typeof prop === "string" && !prop.startsWith("_")) {
        return field([...target._fieldName, prop]);
      }

      return undefined;
    },
  }) as FieldProxy;
}

/**
 * Helper function to create comparison expressions
 */
function createComparisonExpr(
  op: ComparisonOp,
  left: Expr,
  value: unknown,
): Expr {
  return {
    op,
    left,
    right: isFieldObject(value)
      ? value._toField()
      : // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        { op: "literal", value: value as LiteralValue },
  };
}

/**
 * Creates a literal value for use in BTQL expressions
 * @param value The value to create a literal for
 * @returns An expression representing the literal value
 */
export function literal(value: LiteralValue): Expr {
  return { op: "literal", value };
}

/**
 * Combines multiple conditions with AND
 * @param conditions Expressions to combine
 * @returns An expression representing the AND of all conditions
 */
export function and(...conditions: Expr[]): Expr {
  if (conditions.length === 0) return literal(true);
  if (conditions.length === 1) return conditions[0];

  return conditions.reduce((acc, curr) => ({
    op: "and",
    left: acc,
    right: curr,
  }));
}

/**
 * Combines multiple conditions with OR
 * @param conditions Expressions to combine
 * @returns An expression representing the OR of all conditions
 */
export function or(...conditions: Expr[]): Expr {
  if (conditions.length === 0) return literal(false);
  if (conditions.length === 1) return conditions[0];

  return conditions.reduce((acc, curr) => ({
    op: "or",
    left: acc,
    right: curr,
  }));
}

/**
 * Creates a NOT expression
 * @param condition Expression to negate
 * @returns An expression representing the NOT of the condition
 */
export function not(condition: Expr): Expr {
  return {
    op: "not",
    expr: condition,
  };
}

/**
 * Creates an interval expression
 * @param value The numeric value
 * @param unit The time unit
 * @returns An expression representing the time interval
 */
export function interval(value: number, unit: string): Expr {
  return {
    op: "interval",
    value,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    unit: unit as any, // Type will be refined by Zod validation
  };
}
