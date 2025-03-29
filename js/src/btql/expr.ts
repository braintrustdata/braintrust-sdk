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

/**
 * Creates an addition expression
 * @param left Left operand
 * @param right Right operand
 * @returns An expression representing left + right
 */
export function add(
  left: Expr | string | number,
  right: Expr | string | number,
): Expr {
  return createArithmeticExpr("add", left, right);
}

/**
 * Creates a subtraction expression
 * @param left Left operand
 * @param right Right operand
 * @returns An expression representing left - right
 */
export function sub(
  left: Expr | string | number,
  right: Expr | string | number,
): Expr {
  return createArithmeticExpr("sub", left, right);
}

/**
 * Creates a multiplication expression
 * @param left Left operand
 * @param right Right operand
 * @returns An expression representing left * right
 */
export function mul(
  left: Expr | string | number,
  right: Expr | string | number,
): Expr {
  return createArithmeticExpr("mul", left, right);
}

/**
 * Creates a division expression
 * @param left Left operand
 * @param right Right operand
 * @returns An expression representing left / right
 */
export function div(
  left: Expr | string | number,
  right: Expr | string | number,
): Expr {
  return createArithmeticExpr("div", left, right);
}

/**
 * Creates a modulo expression
 * @param left Left operand
 * @param right Right operand
 * @returns An expression representing left % right
 */
export function mod(
  left: Expr | string | number,
  right: Expr | string | number,
): Expr {
  return createArithmeticExpr("mod", left, right);
}

/**
 * Helper for creating arithmetic expressions
 */
function createArithmeticExpr(
  op: "add" | "sub" | "mul" | "div" | "mod",
  left: Expr | string | number,
  right: Expr | string | number,
): Expr {
  const leftExpr = convertToExpr(left);
  const rightExpr = convertToExpr(right);

  return {
    op,
    left: leftExpr,
    right: rightExpr,
  };
}

/**
 * Helper to create a generic function call expression
 *
 * @param name Function name
 * @param args Function arguments
 * @returns An expression representing the function call
 */
export function func(
  name: string,
  ...args: (Expr | string | number | boolean)[]
): Expr {
  return {
    op: "function",
    name: { op: "ident", name: [name] },
    args: args.map((arg) => convertToExpr(arg)),
  };
}

/**
 * Creates a star (*) expression for use in functions like count(*)
 */
export function star(): Expr {
  return { op: "star" };
}

//=============================================================================
// SCALAR FUNCTIONS
// These can be used anywhere in expressions (filter, select, etc.)
//=============================================================================

/**
 * Creates a string concatenation function call
 * @param args Arguments to concatenate
 * @returns An expression representing concat(arg1, arg2, ...)
 */
export function concat(...args: (Expr | string | number | boolean)[]): Expr {
  return func("concat", ...args);
}

/**
 * Creates a length/string length function call
 * @param arg The argument to get the length of
 * @returns An expression representing length(arg)
 */
export function length(arg: Expr | string): Expr {
  return func("length", arg);
}

/**
 * Creates a lowercase function call
 * @param arg The string to convert to lowercase
 * @returns An expression representing lower(arg)
 */
export function lower(arg: Expr | string): Expr {
  return func("lower", arg);
}

/**
 * Creates an uppercase function call
 * @param arg The string to convert to uppercase
 * @returns An expression representing upper(arg)
 */
export function upper(arg: Expr | string): Expr {
  return func("upper", arg);
}

/**
 * Creates a substring function call
 * @param string The string to extract from
 * @param start The starting position (1-based index)
 * @param length Optional length of substring to extract
 * @returns An expression representing substring(string, start, length)
 */
export function substring(
  string: Expr | string,
  start: number,
  length?: number,
): Expr {
  return length !== undefined
    ? func("substring", string, start, length)
    : func("substring", string, start);
}

/**
 * Creates a coalesce function call (returns first non-null value)
 * @param args Arguments to check
 * @returns An expression representing coalesce(arg1, arg2, ...)
 */
export function coalesce(...args: (Expr | string | number | boolean)[]): Expr {
  return func("coalesce", ...args);
}

//=============================================================================
// AGGREGATE FUNCTIONS
// These should only be used in measures and having clauses
//=============================================================================

/**
 * Creates a count function call (for use in measures)
 * @param arg The field to count, or star() for count(*)
 * @returns An expression representing count(arg)
 */
export function count(arg: Expr | string = star()): Expr {
  return func("count", arg);
}

/**
 * Creates a sum function call (for use in measures)
 * @param arg The field to sum
 * @returns An expression representing sum(arg)
 */
export function sum(arg: Expr | string): Expr {
  return func("sum", arg);
}

/**
 * Creates an average function call (for use in measures)
 * @param arg The field to average
 * @returns An expression representing avg(arg)
 */
export function avg(arg: Expr | string): Expr {
  return func("avg", arg);
}

/**
 * Creates a min function call (for use in measures)
 * @param arg The field to find the minimum value of
 * @returns An expression representing min(arg)
 */
export function min(arg: Expr | string): Expr {
  return func("min", arg);
}

/**
 * Creates a max function call (for use in measures)
 * @param arg The field to find the maximum value of
 * @returns An expression representing max(arg)
 */
export function max(arg: Expr | string): Expr {
  return func("max", arg);
}

/**
 * Convert various input types to expressions
 */
function convertToExpr(value: Expr | string | number | boolean): Expr {
  if (typeof value === "object" && value !== null && "op" in value) {
    return value;
  } else if (typeof value === "string") {
    return field(value)._toField();
  } else {
    return literal(value);
  }
}

/**
 * Creates a dimension object for use in the dimensions() clause
 *
 * @param expr The expression to use as a dimension
 * @param alias Optional alias name. If not provided, uses a string representation of the expr
 * @returns A dimension object
 */
export function dimension(
  expr: Expr | string,
  alias?: string,
): { expr: Expr; alias: string } {
  const exprObj = typeof expr === "string" ? field(expr)._toField() : expr;
  const derivedAlias = alias || (typeof expr === "string" ? expr : "dim");

  return {
    expr: exprObj,
    alias: derivedAlias,
  };
}

/**
 * Creates a measure object for use in the measures() clause
 *
 * @param expr The aggregation expression to use as a measure
 * @param alias Optional alias name. If not provided, derives from the expression
 * @returns A measure object
 */
export function measure(
  expr: Expr | string,
  alias?: string,
): { expr: Expr; alias: string } {
  const exprObj = typeof expr === "string" ? field(expr)._toField() : expr;

  // Try to derive a sensible default alias
  let derivedAlias = alias;
  if (!derivedAlias) {
    if (typeof expr === "string") {
      derivedAlias = expr;
    } else if (expr.op === "function" && expr.name.op === "ident") {
      // For function calls like count(*), use something like "count_star"
      const funcName = expr.name.name.join("_");
      let argDesc = "";

      if (expr.args.length > 0) {
        const firstArg = expr.args[0];
        if (firstArg.op === "star") {
          argDesc = "star";
        } else if (firstArg.op === "ident") {
          argDesc = firstArg.name.join("_");
        }
      }

      derivedAlias = argDesc ? `${funcName}_${argDesc}` : funcName;
    } else {
      derivedAlias = "measure";
    }
  }

  return {
    expr: exprObj,
    alias: derivedAlias,
  };
}
