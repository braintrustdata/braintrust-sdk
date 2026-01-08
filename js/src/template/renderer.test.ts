import { expect, test, describe } from "vitest";
import {
  parseTemplateFormat,
  isTemplateFormat,
  renderTemplateContent,
} from "./renderer";

describe("template format parsing", () => {
  test("isTemplateFormat validates correct formats", () => {
    expect(isTemplateFormat("mustache")).toBe(true);
    expect(isTemplateFormat("nunjucks")).toBe(true);
    expect(isTemplateFormat("none")).toBe(true);
    expect(isTemplateFormat("invalid")).toBe(false);
    expect(isTemplateFormat(null)).toBe(false);
    expect(isTemplateFormat(undefined)).toBe(false);
    expect(isTemplateFormat(123)).toBe(false);
    expect(isTemplateFormat({})).toBe(false);
  });

  test("parseTemplateFormat defaults to mustache", () => {
    expect(parseTemplateFormat(undefined)).toBe("mustache");
    expect(parseTemplateFormat(null)).toBe("mustache");
    expect(parseTemplateFormat("invalid")).toBe("mustache");
    expect(parseTemplateFormat(123)).toBe("mustache");
    expect(parseTemplateFormat({})).toBe("mustache");
  });

  test("parseTemplateFormat returns valid formats", () => {
    expect(parseTemplateFormat("mustache")).toBe("mustache");
    expect(parseTemplateFormat("nunjucks")).toBe("nunjucks");
    expect(parseTemplateFormat("none")).toBe("none");
  });

  test("parseTemplateFormat respects custom default", () => {
    expect(parseTemplateFormat(undefined, "nunjucks")).toBe("nunjucks");
    expect(parseTemplateFormat(null, "none")).toBe("none");
    expect(parseTemplateFormat("invalid", "nunjucks")).toBe("nunjucks");
  });

  test("parseTemplateFormat valid value overrides default", () => {
    expect(parseTemplateFormat("mustache", "nunjucks")).toBe("mustache");
    expect(parseTemplateFormat("none", "mustache")).toBe("none");
  });
});

describe("renderTemplateContent", () => {
  const variables = { name: "World", value: 42 };
  const escape = (v: unknown) => {
    if (typeof v === "string") {
      return v;
    }
    return JSON.stringify(v);
  };

  test("renders mustache templates", () => {
    const result = renderTemplateContent("Hello {{name}}!", variables, escape, {
      templateFormat: "mustache",
    });
    expect(result).toBe("Hello World!");
  });

  test("renders with none format (no templating)", () => {
    const result = renderTemplateContent("Hello {{name}}!", variables, escape, {
      templateFormat: "none",
    });
    expect(result).toBe("Hello {{name}}!");
  });

  test("defaults to mustache when no format provided", () => {
    const result = renderTemplateContent(
      "Value: {{value}}",
      variables,
      escape,
      {},
    );
    expect(result).toBe("Value: 42");
  });

  test("escapes non-string values in mustache", () => {
    const result = renderTemplateContent("Data: {{value}}", variables, escape, {
      templateFormat: "mustache",
    });
    expect(result).toBe("Data: 42");
  });

  test("renders objects as JSON strings in mustache (not [object Object])", () => {
    const varsWithObject = {
      user: { name: "Alice", age: 30 },
      items: ["a", "b", "c"],
    };
    const result = renderTemplateContent(
      "User: {{user}}, Items: {{items}}",
      varsWithObject,
      escape,
      { templateFormat: "mustache" },
    );
    expect(result).toBe(
      'User: {"name":"Alice","age":30}, Items: ["a","b","c"]',
    );
    expect(result).not.toContain("[object Object]");
  });

  test("renders objects as JSON strings in nunjucks (not [object Object])", () => {
    const varsWithObject = {
      user: { name: "Bob", age: 25 },
      items: [1, 2, 3],
    };
    const result = renderTemplateContent(
      "User: {{ user }}, Items: {{ items }}",
      varsWithObject,
      escape,
      { templateFormat: "nunjucks" },
    );
    expect(result).toBe('User: {"name":"Bob","age":25}, Items: [1,2,3]');
    expect(result).not.toContain("[object Object]");
  });

  test("renders nested objects as JSON strings in mustache", () => {
    const varsWithNested = {
      data: {
        nested: {
          value: 123,
          items: ["x", "y"],
        },
      },
    };
    const result = renderTemplateContent(
      "Data: {{data}}",
      varsWithNested,
      escape,
      { templateFormat: "mustache" },
    );
    expect(result).toBe('Data: {"nested":{"value":123,"items":["x","y"]}}');
    expect(result).not.toContain("[object Object]");
  });

  test("renders nested objects as JSON strings in nunjucks", () => {
    const varsWithNested = {
      config: {
        settings: {
          enabled: true,
          count: 5,
        },
      },
    };
    const result = renderTemplateContent(
      "Config: {{ config }}",
      varsWithNested,
      escape,
      { templateFormat: "nunjucks" },
    );
    expect(result).toBe('Config: {"settings":{"enabled":true,"count":5}}');
    expect(result).not.toContain("[object Object]");
  });
});
