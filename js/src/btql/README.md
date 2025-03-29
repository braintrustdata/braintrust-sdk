# BTQL Expression Builder

The BTQL Expression Builder provides a fluent, type-safe API for building BTQL query expressions using JavaScript/TypeScript. It makes it easy to build complex expressions with a natural, chainable syntax.

## Basic Usage

```typescript
import { BTQL } from "./query";
import { field, and, or, not, literal } from "./expr";

// Create a new query
const query = BTQL.from("experiment");

// Add a simple filter
query.filter(field("age").gt(30));

// Add a more complex filter
query.filter(
  and(
    field("status").eq("active"),
    field("user").name.eq("John"),
    or(field("role").includes("admin"), field("isVerified").eq(true)),
  ),
);
```

## Field References

The `field()` function creates a reference to a field in your data. It supports both simple fields and nested properties.

```typescript
// Simple field
field("name");

// Nested property access
field("user").name;
field("metadata").tags[0];

// Alternative syntax for nested fields
field(["user", "name"]);
field(["metadata", "tags", 0]);
```

## Comparison Operators

Field references support various comparison operators:

```typescript
// Equality
field("status").eq("active");
field("status").ne("deleted");

// Numeric comparisons
field("age").gt(30);
field("age").lt(50);
field("age").ge(18);
field("age").le(65);

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

## Logical Operators

Combine expressions with logical operators:

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
```

## Comparing Fields

You can compare fields to other fields:

```typescript
// Check if endDate is after startDate
field("endDate").gt(field("startDate"));

// Check if actualAmount equals expectedAmount
field("actualAmount").eq(field("expectedAmount"));
```

## Literals

Use the `literal()` function to create literal values:

```typescript
field("verified").eq(literal(true));
field("count").eq(literal(0));
field("name").eq(literal("John"));
```

## More Examples

See the [examples](./examples/expr-builder.ts) directory for comprehensive usage examples.
