# BTQL Expression Builder

The BTQL Expression Builder provides a fluent, type-safe API for building BTQL query expressions using JavaScript/TypeScript or Python. It makes it easy to build complex expressions with a natural, chainable syntax.

## Basic Usage

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
import { BTQL, field, and, or, not, literal } from "braintrust/btql";

// Create a new query
const query = BTQL.from("experiment", "<experiment id>")
  .filter(field("age").gt(30))
  .filter(
    and(
      field("status").eq("active"),
      field("user").name.eq("John"),
      or(field("role").includes("admin"), field("isVerified").eq(true)),
    ),
  );
```

```python
from braintrust.btql import BTQL, field, and_, or_, not_, literal

// Create a new query
query = (BTQL.from_("experiment", "<experiment id>")
  .filter(field("age").gt(30))
  .filter(
    and_(
      field("status").eq("active"),
      field("user").name.eq("John"),
      or_(field("role").includes("admin"), field("is_verified").eq(True)),
    ),
  ))
```

</CodeTabs>

## Field References

The `field()` function creates a reference to a field in your data. It supports both simple fields and nested properties.

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
// Simple field
field("name");

// Nested property access
field("user").name;
field("metadata").tags[0];

// Alternative syntax for nested fields
field("user", "name");
field("metadata", "tags", 0);
```

```python
# Simple field
field("name")

# Nested property access
field("user").name
field("metadata").tags[0]

# Alternative syntax for nested fields
field("user", "name")
field("metadata", "tags", 0)
```

</CodeTabs>

## Literals

Use the `literal()` function to create literal values:

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
field("verified").eq(literal(true));
field("count").eq(literal(0));
field("name").eq(literal("John"));
```

```python
field("verified").eq(literal(True))
field("count").eq(literal(0))
field("name").eq(literal("John"))
```

</CodeTabs>

## Arithmetic Operations

Fields can be used in arithmetic expressions:

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
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

Any expression can be used with comparison operators:

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
// Equality
field("status").eq("active");
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
field("name").like("J%"); // SQL LIKE pattern matching
field("name").ilike("%john%"); // Case-insensitive LIKE
field("name").match("John"); // Exact match

// NULL checks
field("email").isNull();
field("email").isNotNull();

// Custom comparisons
field("tags").includes("admin");
field("type").is("customer");
```

```python
# Equality
field("status").eq("active")
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

Combine expressions with logical operators:

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
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

// Using chainable .and() method
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
  or_(field("subscription").eq("premium"), field("trial_days").gt(0))
)

# Using chainable .and_() method
field("status").eq("active").and_(field("age").gt(21))

# Combining chainable .and_() with other operators
(field("price").gt(100)
  .and_(field("in_stock").eq(True))
  .and_(
    or_(
      field("category").eq("electronics"),
      field("category").eq("accessories")
    )
  ))

# Complex arithmetic with chainable .and_()
(field("total").gt(1000)
  .and_(field("margin").ge(field("price").multiply(0.2)))
  .and_(field("quantity").gt(0)))
```

</CodeTabs>

## Comparing Fields

You can compare fields to other fields:

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
// Check if endDate is after startDate
field("endDate").gt(field("startDate"));

// Check if actualAmount equals expectedAmount
field("actualAmount").eq(field("expectedAmount"));
```

```python
# Check if end_date is after start_date
field("end_date").gt(field("start_date"))

# Check if actual_amount equals expected_amount
field("actual_amount").eq(field("expected_amount"))
```

</CodeTabs>

## Direct BTQL Queries

You can also write BTQL queries directly as strings and mix them with the builder syntax:

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
// Direct BTQL query string
const directQuery = BTQL.fromString(`
  select: metadata.model as model, scores.Factuality as score
  from: project_logs('<PROJECT_ID>')
  filter: created > now() - interval 1 day
  sort: score desc
`);

// Mix BTQL expressions with builder syntax
const mixedQuery = BTQL.from("experiment", "<experiment id>").filter(
  // Use btql() to embed BTQL expressions in the builder
  btql("metrics.tokens * 2").gt(1000),
  btql("scores.Factuality + scores.Coherence").gt(1.5),
);

// Combine builder syntax with BTQL expressions
const combinedQuery = BTQL.from("experiment", "<experiment id>").filter(
  and(
    field("status").eq("active"),
    btql("metrics.latency < avg(metrics.latency)"),
    field("score").gt(btql("percentile(scores.Factuality, 0.95)")),
  ),
);
```

```python
# Direct BTQL query string
direct_query = BTQL.from_string("""
  select: metadata.model as model, scores.Factuality as score
  from: project_logs('<PROJECT_ID>')
  filter: created > now() - interval 1 day
  sort: score desc
""")

# Mix BTQL expressions with builder syntax
mixed_query = (BTQL.from_("experiment", "<experiment id>")
  .filter(
    # Use btql() to embed BTQL expressions in the builder
    btql("metrics.tokens * 2").gt(1000),
    btql("scores.Factuality + scores.Coherence").gt(1.5),
  ))

# Combine builder syntax with BTQL expressions
combined_query = (BTQL.from_("experiment", "<experiment id>")
  .filter(
    and_(
      field("status").eq("active"),
      btql("metrics.latency < avg(metrics.latency)"),
      field("score").gt(btql("percentile(scores.Factuality, 0.95)")),
    ),
  ))
```

</CodeTabs>

## Query Execution and Response Format

When you execute a BTQL query, it returns an object containing an async iterator for the data, schema information, and other metadata. The async iterator automatically handles pagination for you, so you can simply iterate through all results without managing cursors manually:

<CodeTabs items={["TypeScript", "Python"]}>

```typescript
// Build and execute a query
const query = BTQL.from("experiment", "<experiment id>")
  .filter(field("status").eq("active"))
  .sort("created", "desc")
  .limit(100);

// Response format
interface BTQLResponse<T> {
  // Iterator for the actual data rows - automatically handles pagination
  data: AsyncIterator<T>;

  // Schema information describing the data structure
  schema: {
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
const response = await query.execute();

// Iterate through ALL results - pagination is handled automatically
for await (const row of response.data) {
  console.log(row);
}

// Access schema information
console.log(response.schema);
// {
//   fields: [
//     { name: "id", type: "string", nullable: false },
//     { name: "status", type: "string", nullable: true },
//     { name: "created", type: "timestamp", nullable: false },
//     // ...
//   ]
// }
```

```python
# Build and execute a query
query = (BTQL.from_("experiment", "<experiment id>")
  .filter(field("status").eq("active"))
  .sort("created", "desc")
  .limit(100))

# Response format
class BTQLResponse(Generic[T]):
    """Response from a BTQL query execution."""
    # Iterator for the actual data rows - automatically handles pagination
    data: AsyncIterator[T]

    # Schema information describing the data structure
    schema: Schema

    # Additional metadata
    metadata: Optional[Dict[str, Any]]

class Schema:
    """Schema information for BTQL query results."""
    fields: List[Field]

class Field:
    """Information about a field in the schema."""
    name: str
    type: str
    nullable: bool

# Example usage
response = await query.execute()

# Iterate through ALL results - pagination is handled automatically
async for row in response.data:
    print(row)

# Access schema information
print(response.schema)
# Schema(fields=[
#     Field(name="id", type="string", nullable=False),
#     Field(name="status", type="string", nullable=True),
#     Field(name="created", type="timestamp", nullable=False),
#     # ...
# ])
```

</CodeTabs>
