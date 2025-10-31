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
