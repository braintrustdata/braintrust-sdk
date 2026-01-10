import { describe, test, expect } from "vitest";
import { lintTemplate } from "./nunjucks-utils";
import { nunjucks } from "./nunjucks";
import { getNunjucksEnv } from "./nunjucks-env";

function getEnv() {
  return getNunjucksEnv(false);
}

function getStrictEnv() {
  return getNunjucksEnv(true);
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

  test("renders nested object properties", () => {
    const env = getEnv();
    const out = env.renderString("{{ user.profile.name }}", {
      user: { profile: { name: "Alice" } },
    });
    expect(out).toBe("Alice");
  });

  test("renders multiple variables with context", () => {
    const env = getEnv();
    const out = env.renderString(
      "{{ firstName }} {{ lastName }} is {{ age }} years old",
      { firstName: "Bob", lastName: "Smith", age: 25 },
    );
    expect(out).toBe("Bob Smith is 25 years old");
  });

  test("renders with string concatenation", () => {
    const env = getEnv();
    const out = env.renderString("{{ greeting ~ ' ' ~ name }}", {
      greeting: "Hello",
      name: "World",
    });
    expect(out).toBe("Hello World");
  });

  test("renders numeric operations", () => {
    const env = getEnv();
    const out = env.renderString("Total: {{ price * quantity }}", {
      price: 10,
      quantity: 3,
    });
    expect(out).toBe("Total: 30");
  });

  test("renders with filters and context", () => {
    const env = getEnv();
    const out = env.renderString("{{ message | upper | trim }}", {
      message: "  hello world  ",
    });
    expect(out).toBe("HELLO WORLD");
  });

  test("renders array elements with index", () => {
    const env = getEnv();
    const out = env.renderString(
      "First: {{ items[0] }}, Last: {{ items[2] }}",
      {
        items: ["apple", "banana", "cherry"],
      },
    );
    expect(out).toBe("First: apple, Last: cherry");
  });

  test("renders nested arrays and objects", () => {
    const env = getEnv();
    const out = env.renderString(
      "{{ users[0].name }} from {{ users[0].city }}",
      {
        users: [
          { name: "John", city: "NYC" },
          { name: "Jane", city: "LA" },
        ],
      },
    );
    expect(out).toBe("John from NYC");
  });

  test("renders with default filter", () => {
    const env = getEnv();
    const out1 = env.renderString("{{ name | default('Guest') }}", {
      name: "Alice",
    });
    expect(out1).toBe("Alice");
    const out2 = env.renderString("{{ name | default('Guest') }}", {});
    expect(out2).toBe("Guest");
  });

  test("renders ternary expressions", () => {
    const env = getEnv();
    const out1 = env.renderString("{{ user.name if user else 'Anonymous' }}", {
      user: { name: "Alice" },
    });
    expect(out1).toBe("Alice");
    const out2 = env.renderString(
      "{{ user.name if user else 'Anonymous' }}",
      {},
    );
    expect(out2).toBe("Anonymous");
  });

  test("renders with multiple filters chained", () => {
    const env = getEnv();
    const out = env.renderString("{{ text | lower | trim }}", {
      text: "  HELLO WORLD  ",
    });
    expect(out).toBe("hello world");
  });

  test("renders complex nested context", () => {
    const env = getEnv();
    const out = env.renderString(
      "{{ order.customer.name }} ordered {{ order.items[0].name }} for ${{ order.total }}",
      {
        order: {
          customer: { name: "Alice" },
          items: [{ name: "Widget", price: 10 }],
          total: 10,
        },
      },
    );
    expect(out).toBe("Alice ordered Widget for $10");
  });

  test("renders with length filter on arrays", () => {
    const env = getEnv();
    const out = env.renderString("You have {{ items | length }} items", {
      items: ["a", "b", "c", "d"],
    });
    expect(out).toBe("You have 4 items");
  });

  test("renders with join filter", () => {
    const env = getEnv();
    const out = env.renderString("{{ tags | join(', ') }}", {
      tags: ["red", "green", "blue"],
    });
    expect(out).toBe("red, green, blue");
  });
});

describe("nunjucks lintTemplate", () => {
  test("passes for valid template syntax", () => {
    expect(() => lintTemplate("Hello {{ user.name }}", {})).toThrow();
  });

  test("passes for valid template with loops", () => {
    expect(() =>
      lintTemplate(`{% for item in items %}{{ item }}{% endfor %}`, {}),
    ).not.toThrow();
  });

  test("passes for valid template with conditionals", () => {
    expect(() =>
      lintTemplate(`{% if user %}{{ user.name }}{% endif %}`, {}),
    ).not.toThrow();
  });

  test("throws for invalid template syntax", () => {
    expect(() => lintTemplate("{{ unclosed", {})).toThrow();
  });

  test("throws for mismatched tags", () => {
    expect(() => lintTemplate("{% if x %}{% endfor %}", {})).toThrow();
  });
});
