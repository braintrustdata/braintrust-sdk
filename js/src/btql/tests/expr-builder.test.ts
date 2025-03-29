import { BTQL } from "../query";
import {
  field,
  and,
  or,
  not,
  literal,
  add,
  sub,
  mul,
  div,
  mod,
  // Function helpers
  func,
  concat,
  length,
  lower,
  upper,
  count,
  sum,
  avg,
  // Dimension/measure helpers
  dimension,
  measure,
  star,
} from "../expr";
import {
  booleanExprSchema,
  unaryExprSchema,
  includesExprSchema,
  comparisonExprSchema,
  arithmeticExprSchema,
  functionSchema,
  Expr,
  Ident,
  Literal,
  identSchema,
  literalSchema,
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

  test("arithmetic expressions - addition using helper", () => {
    // Create an addition expression using the helper function
    query.filter(field("total").eq(add(field("field1"), "value2")));

    // Parse and validate the comparison expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("eq");

    // Validate the right side is an arithmetic expression
    const arithExpr = arithmeticExprSchema.parse(compExpr.right);
    expect(arithExpr.op).toBe("add");

    // Check the left operand
    const leftField = identSchema.parse(arithExpr.left);
    expect(leftField.op).toBe("ident");

    // Check the right operand
    const rightField = literalSchema.parse(arithExpr.right);
    expect(rightField.op).toBe("literal");
    expect(rightField.value).toBe("value2");
  });

  test("arithmetic expressions - subtraction using helper", () => {
    // Create a subtraction expression using the helper function
    query.filter(field("result").eq(sub("total", 10)));

    // Parse and validate the comparison expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("eq");

    // Validate the right side is an arithmetic expression
    const arithExpr = arithmeticExprSchema.parse(compExpr.right);
    expect(arithExpr.op).toBe("sub");

    // Check the left operand - "total" as a string is converted to a literal, not an ident
    const leftLit = literalSchema.parse(arithExpr.left);
    expect(leftLit.op).toBe("literal");
    expect(leftLit.value).toBe("total");

    // Check the right operand
    const rightLit = literalSchema.parse(arithExpr.right);
    expect(rightLit.op).toBe("literal");
    expect(rightLit.value).toBe(10);
  });

  test("arithmetic expressions - complex calculation", () => {
    // Create a more complex arithmetic expression using multiple operations
    const complexExpr = add(
      mul("price", "quantity"),
      div(sub("tax", "discount"), 100),
    );

    query.filter(field("finalTotal").eq(complexExpr));

    // Parse and validate the expression structure
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("eq");

    // Validate top-level addition
    const addExpr = arithmeticExprSchema.parse(compExpr.right);
    expect(addExpr.op).toBe("add");

    // Validate multiplication operation (left side of addition)
    const mulExpr = arithmeticExprSchema.parse(addExpr.left);
    expect(mulExpr.op).toBe("mul");

    // Validate division operation (right side of addition)
    const divExpr = arithmeticExprSchema.parse(addExpr.right);
    expect(divExpr.op).toBe("div");

    // Validate subtraction operation (numerator of division)
    const subExpr = arithmeticExprSchema.parse(divExpr.left);
    expect(subExpr.op).toBe("sub");
  });

  test("arithmetic expressions - modulo operation", () => {
    // Create a modulo expression using the helper function
    query.filter(field("remainder").eq(mod("value", 10)));

    // Parse and validate the comparison expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("eq");

    // Validate the right side is an arithmetic expression
    const arithExpr = arithmeticExprSchema.parse(compExpr.right);
    expect(arithExpr.op).toBe("mod");

    // Check the left operand - "value" as a string is converted to a literal, not an ident
    const leftLit = literalSchema.parse(arithExpr.left);
    expect(leftLit.op).toBe("literal");
    expect(leftLit.value).toBe("value");

    // Check the right operand
    const rightLit = literalSchema.parse(arithExpr.right);
    expect(rightLit.op).toBe("literal");
    expect(rightLit.value).toBe(10);
  });

  test("function calls", () => {
    // Create a function call expression using func helper instead of raw object
    const funcExpr = func("count", star());

    query.filter(field("records").gt(funcExpr));

    // Parse and validate the comparison expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("gt");

    // Validate the right side is a function call
    const fnExpr = functionSchema.parse(compExpr.right);
    expect(fnExpr.op).toBe("function");
    expect(fnExpr.name.name).toEqual(["count"]);
    expect(fnExpr.args.length).toBe(1);
    expect(fnExpr.args[0].op).toBe("star");
  });

  test("complex mixed expressions with helper functions", () => {
    // Create a more complex expression with arithmetic, functions and comparisons
    const avgExpr: Expr = {
      op: "function",
      name: { op: "ident", name: ["avg"] },
      args: [field("score")._toField()],
    };

    // Create the threshold using the arithmetic helper
    const thresholdExpr = add(50, 25);

    // Create the comparison expression
    query.filter({
      op: "gt",
      left: avgExpr,
      right: thresholdExpr,
    });

    // Parse and validate the overall expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("gt");

    // Check that the left side is a function
    const fnExpr = functionSchema.parse(compExpr.left);
    expect(fnExpr.op).toBe("function");
    expect(fnExpr.name.name).toEqual(["avg"]);

    // Check that the right side is an arithmetic expression
    const arithExpr = arithmeticExprSchema.parse(compExpr.right);
    expect(arithExpr.op).toBe("add");
    expect(arithExpr.left.op).toBe("literal");
    expect(arithExpr.right.op).toBe("literal");
  });

  test("scalar function - concat", () => {
    // Create a concat function call
    query.filter(field("fullName").eq(concat("firstName", " ", "lastName")));

    // Parse and validate the comparison expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("eq");

    // Validate right side is a function call
    const funcExpr = functionSchema.parse(compExpr.right);
    expect(funcExpr.op).toBe("function");
    expect(funcExpr.name.name).toEqual(["concat"]);
    expect(funcExpr.args.length).toBe(3);
  });

  test("scalar function - length", () => {
    // Create a length function call
    query.filter(field("nameLength").eq(length("name")));

    // Parse and validate the comparison expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("eq");

    // Validate right side is a function call
    const funcExpr = functionSchema.parse(compExpr.right);
    expect(funcExpr.op).toBe("function");
    expect(funcExpr.name.name).toEqual(["length"]);
    expect(funcExpr.args.length).toBe(1);

    // Validate the argument is a literal (string arguments are converted to literals)
    const argExpr = funcExpr.args[0];
    expect(argExpr.op).toBe("literal");
    if (isLiteralExpr(argExpr)) {
      expect(argExpr.value).toBe("name");
    }
  });

  test("generic function call with func helper", () => {
    // Create a custom function call using directly convertible values
    query.filter(
      field("result").eq(func("my_custom_function", "arg1", 42, "arg3")),
    );

    // Parse and validate the comparison expression
    const compExpr = comparisonExprSchema.parse(query.queryObj.filter);
    expect(compExpr.op).toBe("eq");

    // Validate right side is a function call
    const funcExpr = functionSchema.parse(compExpr.right);
    expect(funcExpr.op).toBe("function");
    expect(funcExpr.name.name).toEqual(["my_custom_function"]);
    expect(funcExpr.args.length).toBe(3);
  });

  test("creating dimension objects", () => {
    // Create a dimension with a string field
    const dim1 = dimension("category");
    expect(dim1.expr.op).toBe("ident");
    expect(dim1.alias).toBe("category");

    // Create a dimension with an expression and custom alias
    const dim2 = dimension(upper("name"), "upper_name");
    expect(dim2.expr.op).toBe("function");
    expect(dim2.alias).toBe("upper_name");

    // Test in a real query
    const testQuery = BTQL.from("experiment");
    testQuery.dimensions(
      dimension("category"),
      dimension(lower("name"), "lowercase_name"),
    );

    // Verify the dimensions were added correctly
    expect(testQuery.queryObj.dimensions?.length).toBe(2);
    expect(testQuery.queryObj.dimensions?.[0].alias).toBe("category");
    expect(testQuery.queryObj.dimensions?.[1].alias).toBe("lowercase_name");
  });

  test("creating measure objects", () => {
    // Create a measure with count
    const measure1 = measure(count());
    expect(measure1.expr.op).toBe("function");
    expect(measure1.alias).toBe("count_star");

    // Create a measure with a sum aggregation and custom alias
    const measure2 = measure(sum("amount"), "total_amount");
    expect(measure2.expr.op).toBe("function");
    expect(measure2.alias).toBe("total_amount");

    // Test in a real query
    const testQuery = BTQL.from("experiment");
    testQuery.measures(
      measure(count()),
      measure(avg("score"), "average_score"),
    );

    // Verify the measures were added correctly
    expect(testQuery.queryObj.measures?.length).toBe(2);
    expect(testQuery.queryObj.measures?.[0].alias).toBe("count_star");
    expect(testQuery.queryObj.measures?.[1].alias).toBe("average_score");
  });

  test("complete query with dimensions and measures", () => {
    // Create a complete query with dimensions, measures, and filter
    const testQuery = BTQL.from("experiment")
      .dimensions(dimension("category"), dimension("status"))
      .measures(
        measure(count(), "record_count"),
        measure(avg("score"), "average_score"),
        measure(sum("amount"), "total_amount"),
      )
      .filter(and(field("category").ne("deleted"), field("score").gt(0)))
      .sort({ field: "average_score", dir: "desc" })
      .limit(100);

    // Verify structure
    expect(testQuery.queryObj.dimensions?.length).toBe(2);
    expect(testQuery.queryObj.measures?.length).toBe(3);
    expect(testQuery.queryObj.filter).toBeDefined();
    expect(testQuery.queryObj.sort?.length).toBe(1);
    expect(testQuery.queryObj.limit).toBe(100);

    // Verify dimensions
    const dimensions = testQuery.queryObj.dimensions || [];
    expect(dimensions[0].alias).toBe("category");
    expect(dimensions[1].alias).toBe("status");

    // Verify measures
    const measures = testQuery.queryObj.measures || [];
    expect(measures[0].alias).toBe("record_count");
    expect(measures[1].alias).toBe("average_score");
    expect(measures[2].alias).toBe("total_amount");

    // Verify filter uses AND
    const filter = testQuery.queryObj.filter;
    expect(filter?.op).toBe("and");
  });
});
