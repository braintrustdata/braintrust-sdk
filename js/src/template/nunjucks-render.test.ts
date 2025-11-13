import { describe, test, expect } from "vitest";
import { lintTemplate } from "./nunjucks-utils";
import * as nunjucks from "nunjucks";

function getEnv() {
  const N = nunjucks.default || nunjucks;
  return new N.Environment(null, {
    autoescape: false,
    throwOnUndefined: false,
  });
}

function getStrictEnv() {
  const N = nunjucks.default || nunjucks;
  return new N.Environment(null, { autoescape: false, throwOnUndefined: true });
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
      "Variable 'missing' does not exist.",
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
    ).toThrow("Variable 'users[2].profile.city' does not exist.");
  });

  test("reports missing leaf when ancestors exist", () => {
    expect(() =>
      lintTemplate("{{ users[1].profile.zip }}", {
        users: [{ profile: { zip: "10001" } }, { profile: { city: "NYC" } }],
      }),
    ).toThrow("Variable 'users[1].profile.zip' does not exist.");
  });

  test("allows for-loops over missing arrays", () => {
    expect(() =>
      lintTemplate(`{% for item in items %}{{ item }}{% endfor %}`, {}),
    ).not.toThrow();
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
    expect(() => lintTemplate(tpl, {})).not.toThrow();
  });
});
