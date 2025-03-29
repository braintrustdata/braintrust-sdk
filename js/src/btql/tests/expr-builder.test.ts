import { BTQL } from "../query";
import { field, and, or, not, literal } from "../expr";
import {
  booleanExprSchema,
  unaryExprSchema,
  includesExprSchema,
  comparisonExprSchema,
  Expr,
  Ident,
  Literal,
} from "../ast";
import { beforeEach, describe, test, expect } from "vitest";

// Type guards for narrowing expression types
function isIdentExpr(expr: Expr): expr is Ident {
  return expr.op === "ident";
}

function isLiteralExpr(expr: Expr): expr is Literal {
  return expr.op === "literal";
}

describe("Expression Builder", () => {
  let query: BTQL;

  beforeEach(() => {
    // Create a new BTQL query for each test
    query = BTQL.from("experiment");
  });

  test("simple comparison expressions", () => {
    // Example 1: Simple comparison
    query.filter(field("age").gt(30));

    // Parse and validate the expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("gt");
    expect(compExpr.left.op).toBe("ident");
    expect(compExpr.right.op).toBe("literal");

    if (isIdentExpr(compExpr.left)) {
      expect(compExpr.left.name).toEqual(["age"]);
    }

    if (isLiteralExpr(compExpr.right)) {
      expect(compExpr.right.value).toBe(30);
    }
  });

  test("nested property access", () => {
    // Example 2: Nested property access
    query.filter(field("user").name.eq("John"));

    // Parse and validate the expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("eq");

    const leftSide = isIdentExpr(compExpr.left) ? compExpr.left : null;
    expect(leftSide).not.toBeNull();
    expect(leftSide?.name).toEqual(["user", "name"]);

    const rightSide = isLiteralExpr(compExpr.right) ? compExpr.right : null;
    expect(rightSide).not.toBeNull();
    expect(rightSide?.value).toBe("John");
  });

  test("multiple conditions with AND", () => {
    // Example 3: Multiple conditions with AND
    query.filter(
      and(field("status").eq("active"), field("role").includes("admin")),
    );

    // Parse and validate the boolean expression
    const boolExpr = booleanExprSchema.parse(query.queryObj.filter);
    expect(boolExpr.op).toBe("and");

    // Validate left side is a comparison expression
    const leftExpr = comparisonExprSchema.parse(boolExpr.left);
    expect(leftExpr.op).toBe("eq");

    // Validate right side is an includes expression
    const rightExpr = includesExprSchema.parse(boolExpr.right);
    expect(rightExpr.op).toBe("includes");
  });

  test("complex nested expressions", () => {
    // Example 4: Complex nested expressions
    query.filter(
      or(
        and(field("category").eq("books"), field("price").lt(100)),
        and(field("category").eq("electronics"), field("price").gt(500)),
        field("featured").eq(true),
      ),
    );

    // Validate the overall expression is a boolean expression
    const boolExpr = booleanExprSchema.parse(query.queryObj.filter);
    expect(boolExpr.op).toBe("or");

    // Validate the left side is also a boolean expression (from the OR structure)
    const nestedBoolExpr = booleanExprSchema.parse(boolExpr.left);
    expect(nestedBoolExpr.op).toBe("or");

    // Validate the left side of the nested expression is an AND
    const firstAndExpr = booleanExprSchema.parse(nestedBoolExpr.left);
    expect(firstAndExpr.op).toBe("and");
  });

  test("NOT expressions", () => {
    // Example 5: Using NOT
    query.filter(not(field("status").eq("deleted")));

    // Validate against the unary expression schema
    const notExpr = unaryExprSchema.parse(query.queryObj.filter);
    expect(notExpr.op).toBe("not");

    // Validate the expression inside the NOT
    const innerExpr = comparisonExprSchema.parse(notExpr.expr);
    expect(innerExpr.op).toBe("eq");

    if (isIdentExpr(innerExpr.left)) {
      expect(innerExpr.left.op).toBe("ident");
    }

    if (isLiteralExpr(innerExpr.right)) {
      expect(innerExpr.right.value).toBe("deleted");
    }
  });

  test("comparing fields to each other", () => {
    // Example 6: Comparing fields to each other
    query.filter(field("endDate").gt(field("startDate")));

    // Parse and validate the comparison expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("gt");

    const leftField = isIdentExpr(compExpr.left) ? compExpr.left : null;
    expect(leftField).not.toBeNull();
    expect(leftField?.name).toEqual(["endDate"]);

    const rightField = isIdentExpr(compExpr.right) ? compExpr.right : null;
    expect(rightField).not.toBeNull();
    expect(rightField?.name).toEqual(["startDate"]);
  });

  test("NULL checks", () => {
    // Example 7: NULL checks
    query.filter(field("email").isNotNull());

    // Parse and validate the unary expression
    const unaryExpr = unaryExprSchema.parse(query.queryObj.filter);
    expect(unaryExpr.op).toBe("isnotnull");

    const fieldExpr = isIdentExpr(unaryExpr.expr) ? unaryExpr.expr : null;
    expect(fieldExpr).not.toBeNull();
    expect(fieldExpr?.name).toEqual(["email"]);
  });

  test("using literals", () => {
    // Example 8: Using literals
    query.filter(field("verified").eq(literal(true)));

    // Parse and validate the comparison expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("eq");

    const leftField = isIdentExpr(compExpr.left) ? compExpr.left : null;
    expect(leftField).not.toBeNull();
    expect(leftField?.name).toEqual(["verified"]);

    const rightLiteral = isLiteralExpr(compExpr.right) ? compExpr.right : null;
    expect(rightLiteral).not.toBeNull();

    // Handle both possible implementations - direct value or nested literal
    if (rightLiteral) {
      const literalValue = rightLiteral.value;

      // Check if it's a nested literal (the structure is a bit complex here)
      if (
        typeof literalValue === "object" &&
        literalValue !== null &&
        "op" in literalValue
      ) {
        // Handle structured literal value
        expect(literalValue.op).toBe("literal");
        if ("value" in literalValue) {
          expect(literalValue.value).toBe(true);
        }
      } else {
        // Handle direct value
        expect(literalValue).toBe(true);
      }
    }
  });
});
