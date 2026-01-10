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

  test("renders objects as JSON and allows property access in nunjucks", () => {
    const varsWithObject = {
      user: { name: "Bob", age: 25 },
      items: [1, 2, 3],
    };
    // Nunjucks allows property access on objects
    const resultWithAccess = renderTemplateContent(
      "User: {{ user.name }}, Age: {{ user.age }}, Items: {{ items }}",
      varsWithObject,
      escape,
      { templateFormat: "nunjucks" },
    );
    // Arrays output as comma-separated (Nunjucks default behavior)
    expect(resultWithAccess).toBe("User: Bob, Age: 25, Items: 1,2,3");

    // Objects auto-stringify to JSON to avoid [object Object]
    const resultWithObject = renderTemplateContent(
      "User: {{ user }}, Items: {{ items }}",
      varsWithObject,
      escape,
      { templateFormat: "nunjucks" },
    );
    expect(resultWithObject).toBe(
      'User: {"name":"Bob","age":25}, Items: 1,2,3',
    );
    expect(resultWithObject).not.toContain("[object Object]");
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

  test("renders nested property access in nunjucks", () => {
    const varsWithNested = {
      config: {
        settings: {
          enabled: true,
          count: 5,
        },
      },
    };
    const result = renderTemplateContent(
      "Enabled: {{ config.settings.enabled }}, Count: {{ config.settings.count }}",
      varsWithNested,
      escape,
      { templateFormat: "nunjucks" },
    );
    expect(result).toBe("Enabled: true, Count: 5");
  });

  test("does not render [object Object] in nunjucks", () => {
    const varsWithObject = {
      metadata: { userId: 123, role: "admin" },
    };
    const result = renderTemplateContent(
      "Metadata: {{ metadata }}",
      varsWithObject,
      escape,
      { templateFormat: "nunjucks" },
    );
    expect(result).not.toContain("[object Object]");
    expect(result).toBe('Metadata: {"userId":123,"role":"admin"}');
  });

  test("does not render [object Object] for nested objects in nunjucks", () => {
    const varsWithNested = {
      data: {
        outer: {
          inner: { value: 42 },
        },
      },
    };
    const result = renderTemplateContent(
      "Nested: {{ data.outer.inner }}",
      varsWithNested,
      escape,
      { templateFormat: "nunjucks" },
    );
    expect(result).not.toContain("[object Object]");
    expect(result).toBe('Nested: {"value":42}');
  });

  test("handles deeply nested objects in nunjucks", () => {
    const deeplyNested = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: { final: "value" },
            },
          },
        },
      },
    };
    const result = renderTemplateContent(
      "Deep: {{ level1.level2.level3.level4.level5 }}",
      deeplyNested,
      escape,
      { templateFormat: "nunjucks" },
    );
    expect(result).not.toContain("[object Object]");
    expect(result).toBe('Deep: {"final":"value"}');
  });

  test("handles objects inside arrays with for loops in nunjucks", () => {
    const varsWithArray = {
      attachments: [
        { url: "http://example.com/1.jpg", type: "image" },
        { url: "http://example.com/2.pdf", type: "pdf" },
      ],
    };
    const result = renderTemplateContent(
      "{% for image in attachments %}{{ image }}{% if not loop.last %}, {% endif %}{% endfor %}",
      varsWithArray,
      escape,
      { templateFormat: "nunjucks" },
    );
    expect(result).not.toContain("[object Object]");
    expect(result).toBe(
      '{"url":"http://example.com/1.jpg","type":"image"}, {"url":"http://example.com/2.pdf","type":"pdf"}',
    );
  });

  test("handles nested loops with objects in nunjucks", () => {
    const varsWithNestedArrays = {
      users: [
        {
          name: "Alice",
          posts: [
            { id: 1, title: "First post" },
            { id: 2, title: "Second post" },
          ],
        },
        {
          name: "Bob",
          posts: [{ id: 3, title: "Bob's post" }],
        },
      ],
    };
    const result = renderTemplateContent(
      "{% for user in users %}User: {{ user.name }}, Posts: {% for post in user.posts %}{{ post }}{% if not loop.last %}, {% endif %}{% endfor %}; {% endfor %}",
      varsWithNestedArrays,
      escape,
      { templateFormat: "nunjucks" },
    );
    expect(result).not.toContain("[object Object]");
    expect(result).toContain('"id":1');
    expect(result).toContain('"title":"First post"');
    expect(result).toContain('"id":3');
  });
});
