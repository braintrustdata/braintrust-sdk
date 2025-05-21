# BTQL Expression Builder

The BTQL Expression Builder provides a fluent API for building BTQL query expressions. In JavaScript/TypeScript, it uses a `Query` class for query construction and a module of functions (e.g., `field`, `and`, `or`, `literal`) for creating composable expressions. In Python, it uses `Query` and `Expr` classes. This system makes it easy to build complex expressions with a natural, chainable syntax.

## Basic Usage

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { Query, btql, field } from "braintrust/btql";

// Build a query with fluent filters
const query = Query.experiment("<experiment id>")
  // Call .filter() as many times as you like – they are merged with AND
  .filter(field("age").gt(30))
  .filter(
    field("status")
      .eq("active")
      .and(field("user").name.eq("John"))
      .and(field("role").includes("admin").or(field("isVerified").eq(true))),
  );

// Embed raw BTQL safely with the tagged‑template helper
const highTokenQuery = Query.project_logs("<project>").filter(
  btql`metrics.tokens * 2`.gt(1000),
);
```

```python
from braintrust.btql import Query, Expr, literal

# Build a query with fluent filters
query = (
    Query.experiment("<experiment id>")
      # Call .filter() as many times as you like – they are merged with AND
      .filter(Expr.field("age") > 30)
      .filter(
          (Expr.field("status") == "active")
          & (Expr.field("user").name == "John")
          & (
              Expr.field("role").includes("admin")
              | (Expr.field("is_verified") == True)
          )
      )
)

# Embed raw BTQL safely with Expr.raw()
high_token_query = Query.project_logs("<project>").filter(
  Expr.raw("metrics.tokens * 2") > 1000
)
```

</CodeTabs>

## Field References

In TypeScript and Python, the `field()` function (from the `expr` module) creates a reference to a field. `field` generates an `Expr` object. You can also call
`Expr.field` to achieve the same.

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { Expr, field } from "braintrust/btql";

// Simple field
field("name");
Expr.field("name");

// Nested property access
field("user").name; // Returns a new Expression object for "user.name"
field("metadata").tags[0]; // Returns a new Expression object for "metadata.tags[0]"

// Alternative syntax for nested fields (initial creation)
field("user", "name");
field("metadata", "tags", 0);
```

```python
from braintrust.btql import Expr, field

# Simple field
field("name")
Expr.field("name")

# Nested property access
field("user").name  # Returns a new Expr for "user.name"
field("metadata").tags[0]  # Returns a new Expr for "metadata.tags[0]"

# Alternative syntax for nested fields (initial creation)
field("user", "name")  # Returns a new Expr for "user.name"
field("metadata", "tags", 0)
```

</CodeTabs>

## Literals

Use the `literal()` function to create literal values within expressions.

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { field, literal } from "braintrust/btql/expr";

field("verified").eq(literal(true));
field("count").eq(literal(0));
field("name").eq(literal("John"));
```

```python
from braintrust.btql import field, literal

field("verified").eq(literal(True))
field("count").eq(literal(0))
field("name").eq(literal("John"))
```

</CodeTabs>

## Arithmetic Operations

Expression objects (returned by `field()`, `literal()`, etc.) can be used in arithmetic expressions using their instance methods.

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { field, literal } from "braintrust/btql/expr";

// Basic arithmetic
field("price").add(10);
field("quantity").subtract(5);
field("total").multiply(1.2);
field("amount").divide(2);

// Chaining arithmetic operations
field("price").add(5).multiply(1.1);

// Arithmetic with other fields
field("total").eq(field("price").multiply(field("quantity")));

// Complex calculations
field("discountedTotal").eq(
  field("price")
    .multiply(field("quantity"))
    .multiply(literal(1).subtract(field("discountRate"))),
);
```

```python
from braintrust.btql import field, literal

# Basic arithmetic
field("price").add(10)
field("quantity").subtract(5)
field("total").multiply(1.2)
field("amount").divide(2)

# Chaining arithmetic operations
field("price").add(5).multiply(1.1)

# Arithmetic with other fields
field("total").eq(field("price").multiply(field("quantity")))

# Complex calculations
field("discounted_total").eq(
  field("price")
    .multiply(field("quantity"))
    .multiply(literal(1).subtract(field("discount_rate")))
)
```

</CodeTabs>

## Comparison Operators

Any Expression object can be used with comparison operator methods. These methods often accept raw literal values directly.

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { field } from "braintrust/btql/expr";

// Equality
field("status").eq("active"); // .eq() can take a literal directly
field("status").ne("deleted");

// Numeric comparisons
field("age").gt(30);
field("age").lt(50);
field("age").ge(18);
field("age").le(65);

// Arithmetic comparisons
field("total").gt(field("price").multiply(field("quantity")));
field("discountedPrice").lt(field("originalPrice").multiply(0.8));
field("margin").ge(field("price").subtract(field("cost")));

// String comparisons
field("name").like("J%");
field("name").ilike("%john%");
field("name").match("John");

// NULL checks
field("email").isNull();
field("email").isNotNull();

// Custom comparisons
field("tags").includes("admin");
field("type").is("customer");
```

```python
from braintrust.btql import field

# Equality
field("status").eq("active")  # .eq() can take a literal directly
field("status").ne("deleted")

# Numeric comparisons
field("age").gt(30)
field("age").lt(50)
field("age").ge(18)
field("age").le(65)

# Arithmetic comparisons
field("total").gt(field("price").multiply(field("quantity")))
field("discounted_price").lt(field("original_price").multiply(0.8))
field("margin").ge(field("price").subtract(field("cost")))

# String comparisons
field("name").like("J%")  # SQL LIKE pattern matching
field("name").ilike("%john%")  # Case-insensitive LIKE
field("name").match("John")  # Exact match

# NULL checks
field("email").is_null()
field("email").is_not_null()

# Custom comparisons
field("tags").includes("admin")
field("type").is_("customer")
```

</CodeTabs>

## Logical Operators

Combine Expression objects with logical operator functions (`and`, `or`, `not` in TS) or chain them using instance methods (e.g., `.and()` on an expression). In Python, use `Expr.and_`, `Expr.or_`, `Expr.not_` or the chainable `.and_()`.

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { field, and, or, not } from "braintrust/btql";

// AND - all conditions must be true
and(field("status").eq("active"), field("age").gt(21));

// OR - at least one condition must be true
or(field("role").eq("admin"), field("role").eq("moderator"));

// NOT - negates a condition
not(field("status").eq("deleted"));

// Complex combinations
and(
  field("status").eq("active"),
  not(field("role").eq("guest")),
  or(field("subscription").eq("premium"), field("trialDays").gt(0)),
);

// Using chainable .and() method on an Expression object instance
field("status").eq("active").and(field("age").gt(21));

// Combining chainable .and() with other operators
field("price")
  .gt(100)
  .and(field("inStock").eq(true))
  .and(
    or(
      field("category").eq("electronics"),
      field("category").eq("accessories"),
    ),
  );

// Complex arithmetic with chainable .and()
field("total")
  .gt(1000)
  .and(field("margin").ge(field("price").multiply(0.2)))
  .and(field("quantity").gt(0));
```

```python
from braintrust.btql import field, and_, or_, not_

# AND - all conditions must be true
and_(field("status").eq("active"), field("age").gt(21))

# OR - at least one condition must be true
or_(field("role").eq("admin"), field("role").eq("moderator"))

# NOT - negates a condition
not_(field("status").eq("deleted"))

# Complex combinations
and_(
  field("status").eq("active"),
  not_(field("role").eq("guest")),
  or_(
    field("subscription").eq("premium"),
    field("trial_days").gt(0)
  )
)

# Using chainable .and_() method on an Expr instance
field("status").eq("active").and_(field("age").gt(21))

# Combining chainable .and_() with other operators
field("status").eq("active").and_(
    field("age").gt(21).and_(
        or_(
            field("category").eq("electronics"),
            field("category").eq("accessories")
        )
    )
)

# Complex arithmetic with chainable .and_()
(field("total")
  .gt(1000)
  .and_(field("margin").ge(field("price").multiply(0.2)))
  .and_(field("quantity").gt(0)))
```

</CodeTabs>

## Comparing Fields

You can compare Expression objects to other Expression objects:

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { field } from "braintrust/btql";

// Check if endDate is after startDate
field("endDate").gt(field("startDate"));

// Check if actualAmount equals expectedAmount
field("actualAmount").eq(field("expectedAmount"));
```

```python
from braintrust.btql import field

// Check if end_date is after start_date
field("end_date").gt(field("start_date"))

// Check if actual_amount equals expected_amount
field("actual_amount").eq(field("expected_amount"))
```

</CodeTabs>

## Direct BTQL Queries

You can initialize a `Query` from a full BTQL string using `Query.fromString()`. For embedding raw BTQL expressions within the builder, use the `raw()` function (TS) or `Expr.raw()`/`raw()` (Python).

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { Query, field, and, raw } from "braintrust/btql";

// Direct BTQL query string for the whole query
const directQuery = Query.fromString(`
  select: metadata.model as model, scores.Factuality as score
  from: project_logs('<PROJECT_ID>')
  filter: created > now() - interval 1 day
  sort: score desc
`);

// Mix BTQL expressions (raw) with builder syntax
const mixedQuery = Query.experiment("<experiment id>").filter(
  raw("metrics.tokens * 2").gt(1000), // raw() creates an Expression object
  raw("scores.Factuality + scores.Coherence").gt(1.5),
);

// Combine builder syntax with raw BTQL expressions
const combinedQuery = Query.experiment("<experiment id>").filter(
  and(
    field("status").eq("active"),
    raw("metrics.latency < avg(metrics.latency)"),
    field("score").gt(raw("percentile(scores.Factuality, 0.95)")),
  ),
);
```

```python
from braintrust.btql import Query, field, and_, raw, literal, Expr

# Direct BTQL query string for the whole query
direct_query = Query.from_string("""
  select: metadata.model as model, scores.Factuality as score
  from: project_logs('<PROJECT_ID>')
  filter: created > now() - interval 1 day
  sort: score desc
""")

# Mix BTQL expressions with builder syntax, using Python operators
mixed_query = (Query.experiment("<experiment id>")
  .filter(raw("metrics.tokens * 2") > 1000)
  .filter(raw("scores.Factuality + scores.Coherence") > 1.5))

# Combine builder syntax with raw BTQL expressions, using Python operators
combined_query = (Query.experiment("<experiment id>")
  .filter(
      (field("status") == "active")
      & raw("metrics.latency < avg(metrics.latency)")
      & (field("score") > raw("percentile(scores.Factuality, 0.95)"))
  ))
```

</CodeTabs>

## Query Execution and Response Format

When you execute a `Query`, you can do so synchronously using `.execute()` or asynchronously using `.execute_async()` (recommended for JavaScript/TypeScript). Both methods return a `BTQLResponse` object which contains an async iterator for the data (`response.data`), schema information (`response.schema`), and a method to get the current page of results (`response.currentPage()`). The `response.data` async iterator automatically handles pagination for you when iterating through all results.

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { Query, field } from "braintrust/btql";

// Build and execute a query
const query = Query.experiment("<experiment id>")
  .filter(field("status").eq("active"))
  .sort("created", "desc") // Assuming sort takes field name and optional direction
  .limit(100);

interface JSONSchema {
  type?: string;
  format?: string;
  items?: JSONSchema;
  properties?: { [key: string]: JSONSchema };
  // Add other JSON Schema fields as needed
}

// Response format (conceptual)
interface BTQLResponse<T extends Record<string, unknown>> {
  // Iterator for the actual data rows - automatically handles pagination
  data: AsyncIterator<T>;

  // Schema information describing the data structure in JSON Schema format
  schema: {
    type: "array";
    items: {
      type: "object";
      properties: {
        [key: string]: JSONSchema;
      };
    };
  };

  // The response object automatically iterates through pages, but you can
  // use currentPage() to access just the current one.
  currentPage(): Promise<T[]>;
}

const response: BTQLResponse<any> = await query.execute_async();
console.log("Response schema:");
console.log(response.schema);

// Iterate through ALL results - pagination is handled automatically
console.log("All rows:");
for await (const row of response.data) {
  console.log(row);
}
```

```python
from typing import AsyncIterator, Generic, TypeVar, List, Dict, Any, Coroutine, Optional, TypedDict
from braintrust.btql import Query, field
import asyncio # For running async code from sync in examples

T = TypeVar('T') # T is expected to be a dict-like object, e.g., Dict[str, Any]

JSONSchema = Dict[str, Any] # Can contain keys like 'type', 'format', 'items', 'properties', etc.

class ItemsSchema(TypedDict):
    type: str # Expected to be "object"
    properties: Dict[str, JSONSchema]

class RootSchemaStructure(TypedDict):
    type: str # Expected to be "array"
    items: ItemsSchema

class BTQLResponse(Generic[T]):
    """Response from a BTQL query execution."""
    data: AsyncIterator[T]
    schema: RootSchemaStructure

    def __init__(self, data: AsyncIterator[T], schema: RootSchemaStructure):
        self.data = data
        self.schema = schema

    async def current_page(self) -> List[T]:
        """Fetches and returns only the current page of results."""
        pass # Actual implementation would fetch/return a page

# Build and execute a query
query = (Query.experiment("<experiment id>")
  .filter(field("status").eq("active"))
  .sort("created", "desc")
  .limit(100))

# Asynchronous execution example
async def fetch_data_async():
    response: BTQLResponse[Any] = await query.execute_async()

    print("Response schema:")
    print(response.schema)

    # Iterate through ALL results - pagination is handled automatically
    print("All rows:")
    async for row in response.data:
        print(row)

# Synchronous execution example
def fetch_data_sync():
    response: BTQLResponse[Any] = query.execute() # Synchronous call, blocks until initial response/schema is ready
    print("Response schema:")
    print(response.schema)

    # Iterate through ALL results - pagination is handled automatically
    print("All rows:")
    async for row in response.data:
        print(row)
```

</CodeTabs>
