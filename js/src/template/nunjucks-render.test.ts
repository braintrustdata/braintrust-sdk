import { describe, test, expect } from "vitest";
import {
  lintTemplate,
  analyzeNunjucksTemplateWithLocations,
} from "./nunjucks-utils";
import { nunjucks } from "./nunjucks";

function getEnv() {
  return new nunjucks.Environment(null, {
    autoescape: false,
    throwOnUndefined: false,
  });
}

function getStrictEnv() {
  return new nunjucks.Environment(null, {
    autoescape: false,
    throwOnUndefined: true,
  });
}

describe("nunjucks rendering", () => {
  test("renders variable and control structures", () => {
    const env = getEnv();
    const out = env.renderString(
      "Hello {{ name | upper }} {% if age > 18 %}Adult{% else %}Minor{% endif %}",
      { name: "alice", age: 30 },
    );
    expect(out).toBe("Hello ALICE Adult");
  });

  test("loops render", () => {
    const env = getEnv();
    const out = env.renderString(
      `{% for item in items %}{{ item }},{% endfor %}`,
      { items: ["a", "b"] },
    );
    expect(out).toBe("a,b,");
  });

  test("strict mode throws for missing top-level variable", () => {
    const env = getStrictEnv();
    const tpl = "Hello {{ name }}";
    expect(() => env.renderString(tpl, { user: "x" })).toThrow();
  });

  test("strict mode passes for defined variable and filters", () => {
    const env = getStrictEnv();
    const tpl = "Hello {{ name | upper }}";
    expect(() => env.renderString(tpl, { name: "alice" })).not.toThrow();
  });

  test("strict mode: for over undefined is empty (does not throw)", () => {
    const env = getStrictEnv();
    const tpl = `{% for item in items %}{{ item }}{% endfor %}`;
    expect(() => env.renderString(tpl, { items: [1, 2, 3] })).not.toThrow();
    expect(() => env.renderString(tpl, {})).not.toThrow();
  });

  test("strict mode: nested path with numeric index using brackets", () => {
    const env = getStrictEnv();
    const tpl = `{{ user.addresses[2].city }}`;
    const ok = { user: { addresses: [{}, {}, { city: "SF" }] } };
    expect(() => env.renderString(tpl, ok)).not.toThrow();
    const bad = { user: {} };
    expect(() => env.renderString(tpl, bad)).toThrow();
  });
});

describe("nunjucks lintTemplate", () => {
  test("passes when variables exist", () => {
    expect(() =>
      lintTemplate("Hello {{ user.name }}", {
        user: { name: "Ada" },
      }),
    ).not.toThrow();
  });

  test("throws for missing top-level variable", () => {
    expect(() => lintTemplate("{{ missing }}", {})).toThrow(
      "Variable 'missing'",
    );
  });

  test("handles nested lookups with numeric indices", () => {
    expect(() =>
      lintTemplate("{{ users[2].profile.city }}", {
        users: [{}, {}, { profile: { city: "NYC" } }],
      }),
    ).not.toThrow();
    expect(() =>
      lintTemplate("{{ users[2].profile.city }}", {
        users: [{}, {}],
      }),
    ).toThrow("Variable 'users[2].profile.city'");
  });

  test("reports missing leaf when ancestors exist", () => {
    expect(() =>
      lintTemplate("{{ users[1].profile.zip }}", {
        users: [{ profile: { zip: "10001" } }, { profile: { city: "NYC" } }],
      }),
    ).toThrow("Variable 'users[1].profile.zip'");
  });

  test("requires arrays used in for-loops to exist", () => {
    expect(() =>
      lintTemplate(`{% for item in items %}{{ item }}{% endfor %}`, {}),
    ).toThrow("Variable 'items[0]' does not exist.");
  });

  test("tracks loop-scoped variables", () => {
    expect(() =>
      lintTemplate(
        `{% for user in users %}{{ loop.index }} {{ user.name }}{% endfor %}`,
        { users: [{ name: "Ada" }] },
      ),
    ).not.toThrow();
  });

  test("supports set blocks defining new variables", () => {
    expect(() =>
      lintTemplate(
        `{% set message %}Hello {{ name }}{% endset %}{{ message }}`,
        { name: "Linus" },
      ),
    ).not.toThrow();
  });

  test("supports macros with arguments", () => {
    const tpl = `{% macro greet(person, fallback="friend") %}Hi {{ person or fallback }}{% endmacro %}{{ greet(name) }}`;
    expect(() => lintTemplate(tpl, { name: "Alex" })).not.toThrow();
    expect(() => lintTemplate(tpl, {})).toThrow(
      "Variable 'name' does not exist.",
    );
  });

  test("detects missing iterable path when similar field exists", () => {
    const tpl = `{% if metadata.foods %}{% for item in metadata.food %}{{ item }}{% endfor %}{% endif %}`;
    expect(() => lintTemplate(tpl, { metadata: { foods: [1, 2, 3] } })).toThrow(
      "Variable 'metadata.food[0]' does not exist.",
    );
  });

  test("tracks variables in boolean and expressions", () => {
    const tpl = `{% if user and user.active %}Yes{% endif %}`;
    expect(() => lintTemplate(tpl, { user: { active: true } })).not.toThrow();
    expect(() => lintTemplate(tpl, { user: {} })).toThrow(
      "Variable 'user.active' does not exist.",
    );
  });

  test("tracks variables in boolean or expressions", () => {
    const tpl = `{% if user.isAdmin or user.isModerator %}Access granted{% endif %}`;
    expect(() =>
      lintTemplate(tpl, { user: { isAdmin: false, isModerator: true } }),
    ).not.toThrow();
    expect(() => lintTemplate(tpl, { user: { isAdmin: false } })).toThrow(
      "Variable 'user.isModerator' does not exist.",
    );
  });

  test("tracks variables in ternary if expressions", () => {
    const tpl = `{{ user.name if user else 'Guest' }}`;
    expect(() => lintTemplate(tpl, { user: { name: "Alice" } })).not.toThrow();
    expect(() => lintTemplate(tpl, {})).toThrow(
      "Variable 'user' does not exist.",
    );
  });

  test("handles multiple special loop variables", () => {
    const tpl = `{% for item in items %}{{ loop.index }}, {{ loop.index0 }}, {{ loop.first }}, {{ loop.last }}{% endfor %}`;
    // All loop.* properties should be recognized as built-ins
    expect(() => lintTemplate(tpl, { items: [1, 2, 3] })).not.toThrow();
  });

  test("tracks variables in not expressions", () => {
    const tpl = `{% if not user.disabled %}Active{% endif %}`;
    expect(() =>
      lintTemplate(tpl, { user: { disabled: false } }),
    ).not.toThrow();
    // Not operator doesn't prevent tracking the variable
    const vars = analyzeNunjucksTemplateWithLocations(tpl);
    expect(vars.map((v) => v.path.join(".")).includes("user.disabled")).toBe(
      true,
    );
  });

  test("handles else in for loops", () => {
    const tpl = `{% for item in items %}{{ item.name }}{% else %}No items{% endfor %}`;
    // Empty arrays are valid but will trigger the else block
    // However, lintTemplate still checks items[0].name exists
    expect(() => lintTemplate(tpl, { items: [] })).toThrow(
      "Variable 'items[0]' does not exist.",
    );
    expect(() => lintTemplate(tpl, { items: [{}] })).toThrow(
      "Variable 'items[0].name' does not exist.",
    );
    expect(() =>
      lintTemplate(tpl, { items: [{ name: "Test" }] }),
    ).not.toThrow();
  });

  test("handles multiple variables in single expression", () => {
    const tpl = `{{ user.firstName + ' ' + user.lastName }}`;
    expect(() =>
      lintTemplate(tpl, { user: { firstName: "John", lastName: "Doe" } }),
    ).not.toThrow();
    expect(() => lintTemplate(tpl, { user: { firstName: "John" } })).toThrow(
      "Variable 'user.lastName' does not exist.",
    );
  });

  test("handles nested loops with outer variable references", () => {
    const tpl = `{% for user in users %}{% for order in user.orders %}{{ user.name }}: {{ order.id }}{% endfor %}{% endfor %}`;
    expect(() =>
      lintTemplate(tpl, {
        users: [{ name: "Alice", orders: [{ id: 1 }, { id: 2 }] }],
      }),
    ).not.toThrow();
    expect(() =>
      lintTemplate(tpl, { users: [{ orders: [{ id: 1 }] }] }),
    ).toThrow("Variable 'users[0].name' does not exist.");
  });

  test("ignores variables in string literals", () => {
    const tpl = `{{ "This is not a {{ variable }}" }}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl);
    // String literals should not track embedded variable syntax
    expect(vars.length).toBe(0);
  });

  test("tracks all variables in arithmetic expressions", () => {
    const tpl = `{{ price * quantity + tax - discount }}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl);
    const paths = vars.map((v) => v.path.join("."));
    expect(paths).toContain("price");
    expect(paths).toContain("quantity");
    expect(paths).toContain("tax");
    expect(paths).toContain("discount");
  });

  test("handles division and modulo operators", () => {
    const tpl = `{{ total / count }} remainder {{ total % divisor }}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl);
    const paths = vars.map((v) => v.path.join("."));
    expect(paths).toContain("total");
    expect(paths).toContain("count");
    expect(paths).toContain("divisor");
  });

  test("handles comparison operators in conditionals", () => {
    const tpl = `{% if age >= minAge and score < maxScore %}Pass{% endif %}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl);
    const paths = vars.map((v) => v.path.join("."));
    expect(paths).toContain("age");
    expect(paths).toContain("minAge");
    expect(paths).toContain("score");
    expect(paths).toContain("maxScore");
  });

  test("handles variables in both branches of ternary", () => {
    const tpl = `{{ primary.value if usePrimary else fallback.value }}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl);
    const paths = vars.map((v) => v.path.join("."));
    expect(paths).toContain("primary.value");
    expect(paths).toContain("usePrimary");
    expect(paths).toContain("fallback.value");
  });

  test("does not track filter names as variables", () => {
    const tpl = `{{ items | length }} {{ text | upper | trim }} {{ value | default(0) }}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl);
    const paths = vars.map((v) => v.path.join("."));

    // Should track the variables
    expect(paths).toContain("items");
    expect(paths).toContain("text");
    expect(paths).toContain("value");

    // Should NOT track filter names
    expect(paths).not.toContain("length");
    expect(paths).not.toContain("upper");
    expect(paths).not.toContain("trim");
    expect(paths).not.toContain("default");
  });

  test("does not track Nunjucks test names as variables", () => {
    const tpl = `{% if value is defined %}{{ value }}{% endif %}
    {% if num is odd %}{{ num }}{% endif %}
    {% if item is none %}Empty{% endif %}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl);
    const paths = vars.map((v) => v.path.join("."));

    // Should track the values being tested
    expect(paths).toContain("value");
    expect(paths).toContain("num");
    expect(paths).toContain("item");

    // Should NOT track test names
    expect(paths).not.toContain("defined");
    expect(paths).not.toContain("odd");
    expect(paths).not.toContain("none");
  });

  test("recognizes variables defined in set blocks", () => {
    const tpl = `{% set greeting %}Hello {{ name }}{% endset %}Message: {{ greeting }}`;

    // 'greeting' is defined by set block, so should not be required from context
    expect(() => lintTemplate(tpl, { name: "World" })).not.toThrow();

    const vars = analyzeNunjucksTemplateWithLocations(tpl);
    const paths = vars.map((v) => v.path.join("."));

    // Should track 'name' (used in set block)
    expect(paths).toContain("name");
    // Should NOT track 'greeting' (defined by set block)
    expect(paths).not.toContain("greeting");
  });

  test("handles multiple set variables in same template", () => {
    const tpl = `{% set x = value1 %}{% set y = value2 %}{{ x }} + {{ y }}`;

    expect(() => lintTemplate(tpl, { value1: 1, value2: 2 })).not.toThrow();

    const vars = analyzeNunjucksTemplateWithLocations(tpl);
    const paths = vars.map((v) => v.path.join("."));
    expect(paths).toContain("value1");
    expect(paths).toContain("value2");
    expect(paths).not.toContain("x");
    expect(paths).not.toContain("y");
  });

  test("complex real-world template with all features", () => {
    const complexTpl = `{# Report Header #}
Report: {{ report.title }}
Generated: {% set timestamp %}{{ now | default("N/A") }}{% endset %}{{ timestamp }}

{# Summary stats #}
{% if stats %}
Total: {{ stats.total }}
Success: {{ stats.success }} ({{ (stats.success / stats.total * 100) | round }}%)
{% endif %}

{# Macro for rendering status #}
{% macro status_badge(isActive, label="Status") %}
  {{ label }}: {% if isActive %}✓ Active{% else %}✗ Inactive{% endif %}
{% endmacro %}

{# Main data loop #}
{% for record in data %}
Record #{{ loop.index }}:
  {{ status_badge(record.active, "Account Status") }}

  {% if record.user and record.user.profile %}
  User: {{ record.user.profile.firstName }} {{ record.user.profile.lastName }}
  Email: {{ record.user.email | lower }}
  {% endif %}

  {% if record.items and record.items | length > 0 %}
  Items:
  {% for item in record.items %}
    - {{ item.name }}: \${{ item.price | round(2) }}
      {% if item.tags %}Tags: {{ item.tags | join(", ") }}{% endif %}
  {% endfor %}
  {% endif %}

  {% if record.metadata and record.metadata.notes %}
    Notes: {{ record.metadata.notes }}
  {% endif %}
{% endfor %}

{% if debug and debug.mode is defined %}
Debug: {{ debug.mode }}
{% endif %}`;

    const vars = analyzeNunjucksTemplateWithLocations(complexTpl);
    const paths = vars.map((v) => v.path.join("."));

    // Should track actual variables
    expect(paths).toContain("report.title");
    expect(paths).toContain("now");
    expect(paths).toContain("stats");
    expect(paths).toContain("stats.total");
    expect(paths).toContain("data.0"); // For loops track with [0]

    // Should NOT track filter names
    expect(paths).not.toContain("default");
    expect(paths).not.toContain("round");
    expect(paths).not.toContain("lower");
    expect(paths).not.toContain("join");

    // Should NOT track test names
    expect(paths).not.toContain("defined");

    // Should NOT track macro names or set variables
    expect(paths).not.toContain("status_badge");
    expect(paths).not.toContain("timestamp");

    // Validate the template works with proper context
    expect(() =>
      lintTemplate(complexTpl, {
        report: { title: "Monthly Report" },
        now: "2024-01-01",
        stats: { total: 100, success: 95 },
        data: [
          {
            active: true,
            user: {
              profile: { firstName: "John", lastName: "Doe" },
              email: "JOHN@EXAMPLE.COM",
            },
            items: [
              { name: "Widget", price: 19.99, tags: ["new", "featured"] },
            ],
            metadata: { notes: "VIP customer" },
          },
        ],
        debug: { mode: "verbose" },
      }),
    ).not.toThrow();
  });

  test("resolves nested dataset fields under loop alias", () => {
    const tpl = `{% for row in dataset %}{{ row.user.name }}{% endfor %}`;
    expect(() =>
      lintTemplate(tpl, { dataset: [{ user: { name: "Ada" } }] }),
    ).not.toThrow();
    expect(() => lintTemplate(tpl, { dataset: [{ user: {} }] })).toThrow(
      "Variable 'dataset[0].user.name' does not exist.",
    );
  });

  test("resolves nested dataset fields under nested loop aliases", () => {
    const tpl = `{% for row in dataset %}{% for order in row.orders %}{{ order.id }}{% endfor %}{% endfor %}`;
    expect(() =>
      lintTemplate(tpl, {
        dataset: [{ orders: [{ id: 1 }] }],
      }),
    ).not.toThrow();
    expect(() =>
      lintTemplate(tpl, {
        dataset: [{ orders: [{}] }],
      }),
    ).toThrow("Variable 'dataset[0].orders[0].id' does not exist.");
  });

  test("analyzer with locations points at missing iterable", () => {
    const tpl = `{% if metadata.foods %}{% for item in metadata.food %}{{ item }}{% endfor %}{% endif %}`;
    const expectedIndex = tpl.indexOf("metadata.food", tpl.indexOf("for item"));
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });
    // For loops track the iterable with [0] to verify it's an array
    const bad = vars.find((v) => v.path.join(".") === "metadata.food.0");
    expect(bad).toBeDefined();
    if (!bad) return;
    // But the location should still point to "food" (the last part of the path)
    expect(tpl.slice(bad.from, bad.to)).toBe("food");
    // The position should be close to where "metadata.food" appears
    expect(Math.abs(bad.from - expectedIndex)).toBeLessThan(15);
  });

  test("analyzer with locations points at leaf under loop alias for nested path", () => {
    const tpl = `{% if metadata.foods %}{% for item in metadata.foods %}Category: {{item.cate}}, Name: {{item.name}}{% endfor %}{% endif %}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });
    const catePath = vars.find(
      (v) => v.path.join(".") === "metadata.foods.0.cate",
    );
    expect(catePath).toBeDefined();
    if (!catePath) return;
    expect(tpl.slice(catePath.from, catePath.to)).toBe("cate");
  });

  test("analyzer with locations records nested dataset path under loop alias", () => {
    const tpl = `{% for row in dataset %}{{ row.user.name }}{% endfor %}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });
    const paths = vars.map((v) => v.path.join("."));
    expect(paths).toContain("dataset.0.user.name");
  });

  test("analyzer with locations records nested dataset path under nested loop aliases", () => {
    const tpl = `{% for row in dataset %}{% for order in row.orders %}{{ order.id }}{% endfor %}{% endfor %}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });
    const paths = vars.map((v) => v.path.join("."));
    expect(paths).toContain("dataset.0.orders.0.id");
  });
});

function getLineColumn(
  template: string,
  position: number,
): { line: number; column: number } {
  const lines = template.substring(0, position).split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

describe("nunjucks lintTemplate with line/column tracking", () => {
  test("reports error location for missing variable in multi-line template", () => {
    const tpl = `Hello {{ user.name }},
This is line 2 with {{ missing.var }},
And line 3 with {{ another.missing.field }}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });

    const missingVar = vars.find((v) => v.path.join(".") === "missing.var");
    expect(missingVar).toBeDefined();
    if (!missingVar) return;

    const actualText = tpl.slice(missingVar.from, missingVar.to);
    expect(actualText).toBe("var");
    const { line, column } = getLineColumn(tpl, missingVar.from);
    expect(line).toBe(2);
    const lineText = tpl.split("\n")[line - 1];
    expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
      "var",
    );

    const anotherMissing = vars.find(
      (v) => v.path.join(".") === "another.missing.field",
    );
    expect(anotherMissing).toBeDefined();
    if (anotherMissing) {
      const actualText2 = tpl.slice(anotherMissing.from, anotherMissing.to);
      expect(actualText2).toBe("field");
      const { line: line2, column: col2 } = getLineColumn(
        tpl,
        anotherMissing.from,
      );
      expect(line2).toBe(3);
      const lineText2 = tpl.split("\n")[line2 - 1];
      expect(lineText2.slice(col2 - 1, col2 - 1 + actualText2.length)).toBe(
        "field",
      );
    }
  });

  test("tracks locations in nested loops with multiple errors", () => {
    const tpl = `{% for user in users %}
  User: {{ user.name }}
  {% for order in user.orders %}
    Order ID: {{ order.id }}
    Product: {{ order.product.name }}
    Price: {{ order.price.amount }}
  {% endfor %}
{% endfor %}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });

    const orderId = vars.find(
      (v) => v.path.join(".") === "users.0.orders.0.id",
    );
    expect(orderId).toBeDefined();
    if (orderId) {
      const actualText = tpl.slice(orderId.from, orderId.to);
      expect(actualText).toBe("id");
      const { line, column } = getLineColumn(tpl, orderId.from);
      expect(line).toBe(4);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "id",
      );
    }

    const productName = vars.find(
      (v) => v.path.join(".") === "users.0.orders.0.product.name",
    );
    expect(productName).toBeDefined();
    if (productName) {
      const actualText = tpl.slice(productName.from, productName.to);
      expect(actualText).toBe("name");
      const { line, column } = getLineColumn(tpl, productName.from);
      expect(line).toBe(5);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "name",
      );
    }

    const priceAmount = vars.find(
      (v) => v.path.join(".") === "users.0.orders.0.price.amount",
    );
    expect(priceAmount).toBeDefined();
    if (priceAmount) {
      const actualText = tpl.slice(priceAmount.from, priceAmount.to);
      expect(actualText).toBe("amount");
      const { line, column } = getLineColumn(tpl, priceAmount.from);
      expect(line).toBe(6);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "amount",
      );
    }
  });

  test("tracks locations in conditional blocks", () => {
    const tpl = `{% if user.isActive %}
  Active user: {{ user.profile.displayName }}
  Email: {{ user.contact.email }}
{% else %}
  Inactive user: {{ user.profile.displayName }}
  Last seen: {{ user.activity.lastSeen }}
{% endif %}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });

    const displayName = vars.find(
      (v) => v.path.join(".") === "user.profile.displayName",
    );
    expect(displayName).toBeDefined();
    if (displayName) {
      const firstOccurrence = tpl.indexOf("displayName");
      expect(displayName.from).toBeLessThanOrEqual(firstOccurrence);
      expect(displayName.to).toBeGreaterThan(firstOccurrence);
    }

    const email = vars.find((v) => v.path.join(".") === "user.contact.email");
    expect(email).toBeDefined();
    if (email) {
      const { line } = getLineColumn(tpl, email.from);
      expect(line).toBe(3);
    }

    const lastSeen = vars.find(
      (v) => v.path.join(".") === "user.activity.lastSeen",
    );
    expect(lastSeen).toBeDefined();
    if (lastSeen) {
      const { line } = getLineColumn(tpl, lastSeen.from);
      expect(line).toBe(6);
    }
  });

  test("tracks locations in macro definitions and calls", () => {
    const tpl = `{% macro renderUser(user, showEmail) %}
  Name: {{ user.profile.name }}
  {% if showEmail %}
    Email: {{ user.contact.email }}
  {% endif %}
{% endmacro %}

{{ renderUser(currentUser, true) }}
Missing: {{ undefined.var }}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });

    const currentUser = vars.find((v) => v.path.join(".") === "currentUser");
    expect(currentUser).toBeDefined();
    if (currentUser) {
      const actualText = tpl.slice(currentUser.from, currentUser.to);
      expect(actualText).toBe("currentUser");
      const { line, column } = getLineColumn(tpl, currentUser.from);
      expect(line).toBe(8);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "currentUser",
      );
    }

    const undefinedVar = vars.find((v) => v.path.join(".") === "undefined.var");
    expect(undefinedVar).toBeDefined();
    if (undefinedVar) {
      const actualText = tpl.slice(undefinedVar.from, undefinedVar.to);
      expect(actualText).toBe("var");
      const { line, column } = getLineColumn(tpl, undefinedVar.from);
      expect(line).toBe(9);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "var",
      );
    }

    const userName = vars.find((v) => v.path.join(".") === "user.profile.name");
    expect(userName).toBeUndefined();

    const userEmail = vars.find(
      (v) => v.path.join(".") === "user.contact.email",
    );
    expect(userEmail).toBeUndefined();
  });

  test("tracks locations with array indices in complex paths", () => {
    const tpl = `Users:
{% for user in users %}
  {{ user.addresses[0].street }}
  {{ user.addresses[1].city }}
  {{ user.contacts[0].phone.number }}
  {{ user.contacts[1].email.address }}
{% endfor %}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });

    const street = vars.find(
      (v) => v.path.join(".") === "users.0.addresses.0.street",
    );
    expect(street).toBeDefined();
    if (street) {
      const actualText = tpl.slice(street.from, street.to);
      expect(actualText).toBe("street");
      const { line, column } = getLineColumn(tpl, street.from);
      expect(line).toBe(3);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "street",
      );
    }

    const city = vars.find(
      (v) => v.path.join(".") === "users.0.addresses.1.city",
    );
    expect(city).toBeDefined();
    if (city) {
      const actualText = tpl.slice(city.from, city.to);
      expect(actualText).toBe("city");
      const { line, column } = getLineColumn(tpl, city.from);
      expect(line).toBe(4);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "city",
      );
    }

    const phone = vars.find(
      (v) => v.path.join(".") === "users.0.contacts.0.phone.number",
    );
    expect(phone).toBeDefined();
    if (phone) {
      const actualText = tpl.slice(phone.from, phone.to);
      expect(actualText).toBe("number");
      const { line, column } = getLineColumn(tpl, phone.from);
      expect(line).toBe(5);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "number",
      );
    }

    const email = vars.find(
      (v) => v.path.join(".") === "users.0.contacts.1.email.address",
    );
    expect(email).toBeDefined();
    if (email) {
      const actualText = tpl.slice(email.from, email.to);
      expect(actualText).toBe("address");
      const { line, column } = getLineColumn(tpl, email.from);
      expect(line).toBe(6);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "address",
      );
    }
  });

  test("tracks locations in deeply nested structures", () => {
    const tpl = `{% for company in companies %}
  Company: {{ company.name }}
  {% for department in company.departments %}
    Department: {{ department.name }}
    {% for employee in department.employees %}
      Employee: {{ employee.profile.fullName }}
      Role: {{ employee.role.title }}
      Manager: {{ employee.manager.profile.name }}
    {% endfor %}
  {% endfor %}
{% endfor %}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });

    const fullName = vars.find(
      (v) =>
        v.path.join(".") ===
        "companies.0.departments.0.employees.0.profile.fullName",
    );
    expect(fullName).toBeDefined();
    if (fullName) {
      const actualText = tpl.slice(fullName.from, fullName.to);
      expect(actualText).toBe("fullName");
      const { line, column } = getLineColumn(tpl, fullName.from);
      expect(line).toBe(6);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "fullName",
      );
    }

    const roleTitle = vars.find(
      (v) =>
        v.path.join(".") === "companies.0.departments.0.employees.0.role.title",
    );
    expect(roleTitle).toBeDefined();
    if (roleTitle) {
      const actualText = tpl.slice(roleTitle.from, roleTitle.to);
      expect(actualText).toBe("title");
      const { line, column } = getLineColumn(tpl, roleTitle.from);
      expect(line).toBe(7);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "title",
      );
    }

    const managerName = vars.find(
      (v) =>
        v.path.join(".") ===
        "companies.0.departments.0.employees.0.manager.profile.name",
    );
    expect(managerName).toBeDefined();
    if (managerName) {
      const actualText = tpl.slice(managerName.from, managerName.to);
      expect(actualText).toBe("name");
      const { line, column } = getLineColumn(tpl, managerName.from);
      expect(line).toBe(8);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "name",
      );
    }
  });

  test("tracks locations with set blocks and variable reuse", () => {
    const tpl = `{% set fullName = user.firstName ~ " " ~ user.lastName %}
Full name: {{ fullName }}

{% set address = user.addresses[0] %}
Street: {{ address.street }}
City: {{ address.city }}
Zip: {{ address.zipCode }}

Missing: {{ user.missing.field }}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });

    const firstName = vars.find((v) => v.path.join(".") === "user.firstName");
    expect(firstName).toBeDefined();
    if (firstName) {
      const actualText = tpl.slice(firstName.from, firstName.to);
      expect(actualText).toBe("firstName");
      const { line, column } = getLineColumn(tpl, firstName.from);
      expect(line).toBe(1);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "firstName",
      );
    }

    const lastName = vars.find((v) => v.path.join(".") === "user.lastName");
    expect(lastName).toBeDefined();
    if (lastName) {
      const actualText = tpl.slice(lastName.from, lastName.to);
      expect(actualText).toBe("lastName");
      const { line, column } = getLineColumn(tpl, lastName.from);
      expect(line).toBe(1);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "lastName",
      );
    }

    const addresses = vars.find((v) => v.path.join(".") === "user.addresses.0");
    expect(addresses).toBeDefined();

    const missing = vars.find((v) => v.path.join(".") === "user.missing.field");
    expect(missing).toBeDefined();
    if (missing) {
      const actualText = tpl.slice(missing.from, missing.to);
      expect(actualText).toBe("field");
      const { line, column } = getLineColumn(tpl, missing.from);
      expect(line).toBe(9);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "field",
      );
    }
  });

  test("tracks locations with filters and complex expressions", () => {
    const tpl = `Price: {{ product.price.amount | default(0) }}
Discount: {{ product.discount.percentage }}
Total: {{ order.items[0].price * order.items[0].quantity }}
Tax: {{ order.tax.rate * order.subtotal.amount }}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });

    const priceAmount = vars.find(
      (v) => v.path.join(".") === "product.price.amount",
    );
    expect(priceAmount).toBeDefined();
    if (priceAmount) {
      const actualText = tpl.slice(priceAmount.from, priceAmount.to);
      expect(actualText).toBe("amount");
      const { line, column } = getLineColumn(tpl, priceAmount.from);
      expect(line).toBe(1);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "amount",
      );
    }

    const discount = vars.find(
      (v) => v.path.join(".") === "product.discount.percentage",
    );
    expect(discount).toBeDefined();
    if (discount) {
      const actualText = tpl.slice(discount.from, discount.to);
      expect(actualText).toBe("percentage");
      const { line, column } = getLineColumn(tpl, discount.from);
      expect(line).toBe(2);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "percentage",
      );
    }

    const itemPrice = vars.find(
      (v) => v.path.join(".") === "order.items.0.price",
    );
    expect(itemPrice).toBeDefined();
    if (itemPrice) {
      const actualText = tpl.slice(itemPrice.from, itemPrice.to);
      expect(actualText).toBe("price");
      const { line, column } = getLineColumn(tpl, itemPrice.from);
      expect(line).toBe(3);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "price",
      );
    }

    const taxRate = vars.find((v) => v.path.join(".") === "order.tax.rate");
    expect(taxRate).toBeDefined();
    if (taxRate) {
      const actualText = tpl.slice(taxRate.from, taxRate.to);
      expect(actualText).toBe("rate");
      const { line, column } = getLineColumn(tpl, taxRate.from);
      expect(line).toBe(4);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "rate",
      );
    }
  });

  test("tracks locations with multiple variables on same line", () => {
    const tpl = `{{ user.name }} and {{ user.email }} and {{ user.phone }}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });

    const name = vars.find((v) => v.path.join(".") === "user.name");
    expect(name).toBeDefined();
    if (name) {
      const actualText = tpl.slice(name.from, name.to);
      expect(actualText).toBe("name");
      const { line, column } = getLineColumn(tpl, name.from);
      expect(line).toBe(1);
      expect(column).toBeGreaterThan(0);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "name",
      );
    }

    const email = vars.find((v) => v.path.join(".") === "user.email");
    expect(email).toBeDefined();
    if (email) {
      const actualText = tpl.slice(email.from, email.to);
      expect(actualText).toBe("email");
      const { line, column } = getLineColumn(tpl, email.from);
      expect(line).toBe(1);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "email",
      );
      const emailPos = tpl.indexOf("email");
      expect(email.from).toBeLessThanOrEqual(emailPos + 5);
      expect(email.to).toBeGreaterThanOrEqual(emailPos);
    }

    const phone = vars.find((v) => v.path.join(".") === "user.phone");
    expect(phone).toBeDefined();
    if (phone) {
      const actualText = tpl.slice(phone.from, phone.to);
      expect(actualText).toBe("phone");
      const { line, column } = getLineColumn(tpl, phone.from);
      expect(line).toBe(1);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "phone",
      );
    }
  });

  test("tracks locations with comments and whitespace", () => {
    const tpl = `{# This is a comment #}
{{ user.name }}
{# Another comment with {{ fake.var }} #}
{{ user.email }}
    {# Indented comment #}
{{ user.phone }}`;
    const vars = analyzeNunjucksTemplateWithLocations(tpl, {
      throwOnParseError: true,
    });

    const name = vars.find((v) => v.path.join(".") === "user.name");
    expect(name).toBeDefined();
    if (name) {
      const actualText = tpl.slice(name.from, name.to);
      expect(actualText).toBe("name");
      const { line, column } = getLineColumn(tpl, name.from);
      expect(line).toBe(2);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "name",
      );
    }

    const email = vars.find((v) => v.path.join(".") === "user.email");
    expect(email).toBeDefined();
    if (email) {
      const actualText = tpl.slice(email.from, email.to);
      expect(actualText).toBe("email");
      const { line, column } = getLineColumn(tpl, email.from);
      expect(line).toBe(4);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "email",
      );
    }

    const phone = vars.find((v) => v.path.join(".") === "user.phone");
    expect(phone).toBeDefined();
    if (phone) {
      const actualText = tpl.slice(phone.from, phone.to);
      expect(actualText).toBe("phone");
      const { line, column } = getLineColumn(tpl, phone.from);
      expect(line).toBe(6);
      const lineText = tpl.split("\n")[line - 1];
      expect(lineText.slice(column - 1, column - 1 + actualText.length)).toBe(
        "phone",
      );
    }

    const fakeVar = vars.find((v) => v.path.join(".") === "fake.var");
    expect(fakeVar).toBeUndefined();
  });
});
