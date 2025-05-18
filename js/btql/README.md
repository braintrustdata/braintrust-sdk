# BTQL Expression Builder

The BTQL Expression Builder provides a fluent API for building BTQL query expressions. In JavaScript/TypeScript, it uses a `Query` class for query construction and a module of functions (e.g., `field`, `and`, `or`, `literal`) for creating composable expressions. In Python, it uses `Query` and `Expr` classes. This system makes it easy to build complex expressions with a natural, chainable syntax.

## Basic Usage

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { Query } from "braintrust/btql";
import { field, and, or, literal } from "braintrust/btql/expr"; // Or from "braintrust/btql" if re-exported

// Create a new query
const query = Query.from("experiment", "<experiment id>")
  .filter(field("age").gt(30)) // field() returns an Expression object
  .filter(
    and(
      // and() takes Expression objects and returns one
      field("status").eq("active"),
      field("user").name.eq("John"), // .name on an Expression object returns a new one for the nested path
      or(field("role").includes("admin"), field("isVerified").eq(true)),
    ),
  );
```

```python
from braintrust.btql import Query, Expr

# Create a new query
query = (Query.from_("experiment", "<experiment id>")
  .filter(Expr.field("age").gt(30))
  .filter(
    Expr.and_(
      Expr.field("status").eq("active"),
      Expr.field("user").name.eq("John"), # Assumes .name on an Expr returns a new Expr
      Expr.or_(
        Expr.field("role").includes("admin"),
        Expr.field("is_verified").eq(True)
      ),
    ),
  ))
```

</CodeTabs>

## Field References

In TypeScript, the `field()` function (from the `expr` module) creates a reference to a field. In Python, this is `Expr.field()`. These support simple fields and nested properties through attribute access or indexing on the returned Expression object.

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { field } from "braintrust/btql/expr";

// Simple field
field("name");

// Nested property access
field("user").name; // Returns a new Expression object for "user.name"
field("metadata").tags[0]; // Returns a new Expression object for "metadata.tags[0]"

// Alternative syntax for nested fields (initial creation)
field("user", "name");
field("metadata", "tags", 0);
```

```python
from braintrust.btql import Expr

# Simple field
Expr.field("name")

# Nested property access
Expr.field("user").name  # Returns a new Expr for "user.name"
Expr.field("metadata").tags[0]  # Returns a new Expr for "metadata.tags[0]"

# Alternative syntax for nested fields (initial creation)
Expr.field("user", "name")
Expr.field("metadata", "tags", 0)
```

</CodeTabs>

## Literals

Use the `literal()` function (TS) or `Expr.literal()` (Python) to create literal values within expressions.

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { field, literal } from "braintrust/btql/expr";

field("verified").eq(literal(true));
field("count").eq(literal(0));
field("name").eq(literal("John"));
```

```python
from braintrust.btql import Expr

Expr.field("verified").eq(Expr.literal(True))
Expr.field("count").eq(Expr.literal(0))
Expr.field("name").eq(Expr.literal("John"))
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
from braintrust.btql import Expr

// Basic arithmetic
Expr.field("price").add(10)
Expr.field("quantity").subtract(5)
Expr.field("total").multiply(1.2)
Expr.field("amount").divide(2)

// Chaining arithmetic operations
Expr.field("price").add(5).multiply(1.1)

// Arithmetic with other fields
Expr.field("total").eq(Expr.field("price").multiply(Expr.field("quantity")))

// Complex calculations
Expr.field("discounted_total").eq(
  Expr.field("price")
    .multiply(Expr.field("quantity"))
    .multiply(Expr.literal(1).subtract(Expr.field("discount_rate")))
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
from braintrust.btql import Expr

// Equality
Expr.field("status").eq("active")  # .eq() can take a literal directly
Expr.field("status").ne("deleted")

// Numeric comparisons
Expr.field("age").gt(30)
Expr.field("age").lt(50)
Expr.field("age").ge(18)
Expr.field("age").le(65)

// Arithmetic comparisons
Expr.field("total").gt(Expr.field("price").multiply(Expr.field("quantity")))
Expr.field("discounted_price").lt(Expr.field("original_price").multiply(0.8))
Expr.field("margin").ge(Expr.field("price").subtract(Expr.field("cost")))

// String comparisons
Expr.field("name").like("J%")  # SQL LIKE pattern matching
Expr.field("name").ilike("%john%")  # Case-insensitive LIKE
Expr.field("name").match("John")  # Exact match

// NULL checks
Expr.field("email").is_null()
Expr.field("email").is_not_null()

// Custom comparisons
Expr.field("tags").includes("admin")
Expr.field("type").is_("customer")
```

</CodeTabs>

## Logical Operators

Combine Expression objects with logical operator functions (`and`, `or`, `not` in TS) or chain them using instance methods (e.g., `.and()` on an expression). In Python, use `Expr.and_`, `Expr.or_`, `Expr.not_` or the chainable `.and_()`.

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { field, and, or, not } from "braintrust/btql/expr";

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
from braintrust.btql import Expr

// AND - all conditions must be true
Expr.and_(Expr.field("status").eq("active"), Expr.field("age").gt(21))

// OR - at least one condition must be true
Expr.or_(Expr.field("role").eq("admin"), Expr.field("role").eq("moderator"))

// NOT - negates a condition
Expr.not_(Expr.field("status").eq("deleted"))

// Complex combinations
Expr.and_(
  Expr.field("status").eq("active"),
  Expr.not_(Expr.field("role").eq("guest")),
  Expr.or_(
    Expr.field("subscription").eq("premium"),
    Expr.field("trial_days").gt(0)
  )
)

// Using chainable .and_() method on an Expr instance
Expr.field("status").eq("active").and_(Expr.field("age").gt(21))

// Combining chainable .and_() with other operators
(Expr.field("price")
  .gt(100)
  .and_(Expr.field("in_stock").eq(True))
  .and_(
    Expr.or_(
      Expr.field("category").eq("electronics"),
      Expr.field("category").eq("accessories")
    )
  ))

// Complex arithmetic with chainable .and_()
(Expr.field("total")
  .gt(1000)
  .and_(Expr.field("margin").ge(Expr.field("price").multiply(0.2)))
  .and_(Expr.field("quantity").gt(0)))
```

</CodeTabs>

## Comparing Fields

You can compare Expression objects to other Expression objects:

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { field } from "braintrust/btql/expr";

// Check if endDate is after startDate
field("endDate").gt(field("startDate"));

// Check if actualAmount equals expectedAmount
field("actualAmount").eq(field("expectedAmount"));
```

```python
from braintrust.btql import Expr

// Check if end_date is after start_date
Expr.field("end_date").gt(Expr.field("start_date"))

// Check if actual_amount equals expected_amount
Expr.field("actual_amount").eq(Expr.field("expected_amount"))
```

</CodeTabs>

## Direct BTQL Queries

You can initialize a `Query` from a full BTQL string. For embedding raw BTQL expressions within the builder, use the `raw()` function (TS) or `Expr.raw()` (Python).

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { Query } from "braintrust/btql";
import { field, and, raw, literal } from "braintrust/btql/expr";

// Direct BTQL query string for the whole query
const directQuery = Query.fromString(`
  select: metadata.model as model, scores.Factuality as score
  from: project_logs('<PROJECT_ID>')
  filter: created > now() - interval 1 day
  sort: score desc
`);

// Mix BTQL expressions (raw) with builder syntax
const mixedQuery = Query.from("experiment", "<experiment id>").filter(
  raw("metrics.tokens * 2").gt(1000), // raw() creates an Expression object
  raw("scores.Factuality + scores.Coherence").gt(1.5),
);

// Combine builder syntax with raw BTQL expressions
const combinedQuery = Query.from("experiment", "<experiment id>").filter(
  and(
    field("status").eq("active"),
    raw("metrics.latency < avg(metrics.latency)"),
    field("score").gt(raw("percentile(scores.Factuality, 0.95)")),
  ),
);
```

```python
from braintrust.btql import Query, Expr

// Direct BTQL query string for the whole query
direct_query = Query.from_string("""
  select: metadata.model as model, scores.Factuality as score
  from: project_logs('<PROJECT_ID>')
  filter: created > now() - interval 1 day
  sort: score desc
""")

// Mix BTQL expressions (Expr.raw) with builder syntax
mixed_query = (Query.from_("experiment", "<experiment id>")
  .filter(
    Expr.raw("metrics.tokens * 2").gt(1000),  # Expr.raw creates an Expr from a string
    Expr.raw("scores.Factuality + scores.Coherence").gt(1.5),
  ))

// Combine builder syntax with raw BTQL expressions
combined_query = (Query.from_("experiment", "<experiment id>")
  .filter(
    Expr.and_(
      Expr.field("status").eq("active"),
      Expr.raw("metrics.latency < avg(metrics.latency)"),
      Expr.field("score").gt(Expr.raw("percentile(scores.Factuality, 0.95)")),
    ),
  ))
```

</CodeTabs>

## Query Execution and Response Format

When you execute a `Query` (e.g., by calling `.execute()`), it returns an object containing an async iterator for the data, schema information, and other metadata. The async iterator automatically handles pagination for you.

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { Query } from "braintrust/btql";
import { field } from "braintrust/btql/expr";

// Build and execute a query
const query = Query.from("experiment", "<experiment id>")
  .filter(field("status").eq("active"))
  .sort("created", "desc") // Assuming sort takes field name and optional direction
  .limit(100);

// Response format (conceptual)
interface BTQLResponse<T> {
  // Iterator for the actual data rows - automatically handles pagination
  data: AsyncIterator<T>;

  // Schema information describing the data structure
  schema: {
    // This would be a more structured Schema object
    fields: Array<{
      name: string;
      type: string;
      nullable: boolean;
    }>;
  };

  // Additional metadata
  metadata?: {
    [key: string]: any;
  };
}

// Example usage
async function fetchData() {
  const response: BTQLResponse<any> = await query.execute();

  // Iterate through ALL results - pagination is handled automatically
  for await (const row of response.data) {
    console.log(row);
  }

  // Access schema information
  console.log(response.schema);
  // Example:
  // {
  //   fields: [
  //     { name: "id", type: "string", nullable: false },
  //     { name: "status", type: "string", nullable: true },
  //     // ...
  //   ]
  // }
}
```

```python
from typing import AsyncIterator, Generic, TypeVar, List, Optional, Dict, Any
from braintrust.btql import Query, Expr # Ensure Expr is imported if field() is used within Query calls indirectly

T = TypeVar('T')

class FieldSchema:
    name: str
    type: str
    nullable: bool

    def __init__(self, name: str, type: str, nullable: bool):
        self.name = name
        self.type = type
        self.nullable = nullable

class QuerySchema:
    fields: List[FieldSchema]

    def __init__(self, fields: List[FieldSchema]):
        self.fields = fields

class BTQLResponse(Generic[T]):
    """Response from a BTQL query execution."""
    data: AsyncIterator[T]
    schema: QuerySchema
    metadata: Optional[Dict[str, Any]]

    def __init__(self, data: AsyncIterator[T], schema: QuerySchema, metadata: Optional[Dict[str, Any]] = None):
        self.data = data
        self.schema = schema
        self.metadata = metadata

# Build and execute a query
query = (Query.from_("experiment", "<experiment id>")
  .filter(Expr.field("status").eq("active")) # Python still uses Expr.field here
  .sort("created", "desc")
  .limit(100))

# Example usage
async def fetch_data():
    response: BTQLResponse[Any] = await query.execute()

    # Iterate through ALL results - pagination is handled automatically
    async for row in response.data:
        print(row)

    # Access schema information
    # Example: print(response.schema.fields[0].name)
    # print(response.schema)
    # QuerySchema(fields=[
    #     FieldSchema(name="id", type="string", nullable=False),
    #     FieldSchema(name="status", type="string", nullable=True),
    #     # ...
    # ])
```

</CodeTabs>
