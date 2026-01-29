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

  describe("mustache", () => {
    test("renders basic template", () => {
      const result = renderTemplateContent(
        "Hello {{name}}!",
        variables,
        escape,
        {
          templateFormat: "mustache",
        },
      );
      expect(result).toBe("Hello World!");
    });

    test("escapes non-string values", () => {
      const result = renderTemplateContent(
        "Data: {{value}}",
        variables,
        escape,
        {
          templateFormat: "mustache",
        },
      );
      expect(result).toBe("Data: 42");
    });

    test("renders objects as JSON strings (not [object Object])", () => {
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

    test("renders nested objects as JSON strings", () => {
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

    test("renders array of strings", () => {
      const varsWithStrings = {
        tags: ["javascript", "typescript", "nodejs"],
      };
      const result = renderTemplateContent(
        "Tags: {{tags}}",
        varsWithStrings,
        escape,
        { templateFormat: "mustache" },
      );
      expect(result).toBe('Tags: ["javascript","typescript","nodejs"]');
    });

    test("renders array of numbers", () => {
      const varsWithNumbers = {
        scores: [95, 87, 92, 100],
      };
      const result = renderTemplateContent(
        "Scores: {{scores}}",
        varsWithNumbers,
        escape,
        { templateFormat: "mustache" },
      );
      expect(result).toBe("Scores: [95,87,92,100]");
    });

    test("renders array of objects", () => {
      const varsWithObjects = {
        users: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
          { id: 3, name: "Charlie" },
        ],
      };
      const result = renderTemplateContent(
        "Users: {{users}}",
        varsWithObjects,
        escape,
        { templateFormat: "mustache" },
      );
      expect(result).toBe(
        'Users: [{"id":1,"name":"Alice"},{"id":2,"name":"Bob"},{"id":3,"name":"Charlie"}]',
      );
    });

    test("renders mixed array with strings, numbers, and objects", () => {
      const varsWithMixed = {
        data: ["hello", 42, { type: "object", value: true }, null, "world"],
      };
      const result = renderTemplateContent(
        "Mixed: {{data}}",
        varsWithMixed,
        escape,
        { templateFormat: "mustache" },
      );
      expect(result).toBe(
        'Mixed: ["hello",42,{"type":"object","value":true},null,"world"]',
      );
    });

    test("renders comma-separated image URLs as string", () => {
      const varsWithUrls = {
        images:
          "https://example.com/image1.jpg, https://example.com/image2.jpg",
      };
      const result = renderTemplateContent("{{images}}", varsWithUrls, escape, {
        templateFormat: "mustache",
      });
      expect(result).toBe(
        "https://example.com/image1.jpg, https://example.com/image2.jpg",
      );
    });

    test("renders braintrust_attachment object", () => {
      const varsWithAttachment = {
        images: {
          type: "braintrust_attachment",
          filename: "deep.txt",
          content_type: "text/plain",
          key: "attachments/deep/deep.txt",
        },
      };
      const result = renderTemplateContent(
        "{{images}}",
        varsWithAttachment,
        escape,
        { templateFormat: "mustache" },
      );
      expect(result).toBe(
        '{"type":"braintrust_attachment","filename":"deep.txt","content_type":"text/plain","key":"attachments/deep/deep.txt"}',
      );
    });

    test("renders array of braintrust_attachment objects", () => {
      const varsWithAttachments = {
        images: [
          {
            type: "braintrust_attachment",
            filename: "image1.jpg",
            content_type: "image/jpeg",
            key: "attachments/image1.jpg",
          },
          {
            type: "braintrust_attachment",
            filename: "image2.jpg",
            content_type: "image/jpeg",
            key: "attachments/image2.jpg",
          },
        ],
      };
      const result = renderTemplateContent(
        "{{images}}",
        varsWithAttachments,
        escape,
        { templateFormat: "mustache" },
      );
      expect(result).toBe(
        '[{"type":"braintrust_attachment","filename":"image1.jpg","content_type":"image/jpeg","key":"attachments/image1.jpg"},{"type":"braintrust_attachment","filename":"image2.jpg","content_type":"image/jpeg","key":"attachments/image2.jpg"}]',
      );
    });

    test("renders comma-separated braintrust_attachment objects as string", () => {
      const varsWithAttachments = {
        images:
          '{"type":"braintrust_attachment","filename":"image1.jpg","key":"attachments/image1.jpg"}, {"type":"braintrust_attachment","filename":"image2.jpg","key":"attachments/image2.jpg"}',
      };
      const result = renderTemplateContent(
        "{{images}}",
        varsWithAttachments,
        escape,
        { templateFormat: "mustache" },
      );
      expect(result).toBe(
        '{"type":"braintrust_attachment","filename":"image1.jpg","key":"attachments/image1.jpg"}, {"type":"braintrust_attachment","filename":"image2.jpg","key":"attachments/image2.jpg"}',
      );
    });
  });

  describe("nunjucks", () => {
    test("renders basic template", () => {
      const result = renderTemplateContent(
        "Hello {{ name }}!",
        variables,
        escape,
        {
          templateFormat: "nunjucks",
        },
      );
      expect(result).toBe("Hello World!");
    });

    test("escapes non-string values", () => {
      const result = renderTemplateContent(
        "Data: {{ value }}",
        variables,
        escape,
        {
          templateFormat: "nunjucks",
        },
      );
      expect(result).toBe("Data: 42");
    });

    test("renders objects as [object Object] by default", () => {
      const varsWithObject = {
        user: { name: "Alice", age: 30 },
        items: ["a", "b", "c"],
      };
      const result = renderTemplateContent(
        "User: {{ user }}, Items: {{ items }}",
        varsWithObject,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe("User: [object Object], Items: a,b,c");
    });

    test("renders objects as JSON with dump filter", () => {
      const varsWithObject = {
        user: { name: "Alice", age: 30 },
      };
      const result = renderTemplateContent(
        "User: {{ user | dump }}",
        varsWithObject,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe('User: {"name":"Alice","age":30}');
    });

    test("renders objects as JSON with tojson filter", () => {
      const varsWithObject = {
        user: { name: "Alice", age: 30 },
      };
      const result = renderTemplateContent(
        "User: {{ user | tojson }}",
        varsWithObject,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe('User: {"name":"Alice","age":30}');
    });

    test("allows property access on objects", () => {
      const varsWithObject = {
        user: { name: "Alice", age: 30 },
        items: ["a", "b", "c"],
      };
      const result = renderTemplateContent(
        "User: {{ user.name }}, Age: {{ user.age }}, Items: {{ items }}",
        varsWithObject,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe("User: Alice, Age: 30, Items: a,b,c");
    });

    test("renders nested objects as [object Object] by default", () => {
      const varsWithNested = {
        data: {
          nested: {
            value: 123,
            items: ["x", "y"],
          },
        },
      };
      const result = renderTemplateContent(
        "Data: {{ data }}",
        varsWithNested,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe("Data: [object Object]");
    });

    test("renders nested objects as JSON with dump filter", () => {
      const varsWithNested = {
        data: {
          nested: {
            value: 123,
            items: ["x", "y"],
          },
        },
      };
      const result = renderTemplateContent(
        "Data: {{ data | dump }}",
        varsWithNested,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe('Data: {"nested":{"value":123,"items":["x","y"]}}');
    });

    test("renders nested objects as JSON with tojson filter", () => {
      const varsWithNested = {
        data: {
          nested: {
            value: 123,
            items: ["x", "y"],
          },
        },
      };
      const result = renderTemplateContent(
        "Data: {{ data | tojson }}",
        varsWithNested,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe('Data: {"nested":{"value":123,"items":["x","y"]}}');
    });

    test("renders nested property access", () => {
      const varsWithNested = {
        data: {
          nested: {
            value: 123,
            items: ["x", "y"],
          },
        },
      };
      const result = renderTemplateContent(
        "Value: {{ data.nested.value }}, Items: {{ data.nested.items }}",
        varsWithNested,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe("Value: 123, Items: x,y");
    });

    test("renders nested property-accessed objects as [object Object]", () => {
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
      expect(result).toBe("Nested: [object Object]");
    });

    test("renders nested property-accessed objects as JSON with dump", () => {
      const varsWithNested = {
        data: {
          outer: {
            inner: { value: 42 },
          },
        },
      };
      const result = renderTemplateContent(
        "Nested: {{ data.outer.inner | dump }}",
        varsWithNested,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe('Nested: {"value":42}');
    });

    test("handles deeply nested objects with tojson", () => {
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
        "Deep: {{ level1.level2.level3.level4.level5 | tojson }}",
        deeplyNested,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe('Deep: {"final":"value"}');
    });

    test("renders array of strings", () => {
      const varsWithStrings = {
        tags: ["javascript", "typescript", "nodejs"],
      };
      const result = renderTemplateContent(
        "Tags: {{ tags }}",
        varsWithStrings,
        escape,
        { templateFormat: "nunjucks" },
      );
      // Nunjucks renders arrays as comma-separated (without brackets)
      expect(result).toBe("Tags: javascript,typescript,nodejs");
    });

    test("renders array of numbers", () => {
      const varsWithNumbers = {
        scores: [95, 87, 92, 100],
      };
      const result = renderTemplateContent(
        "Scores: {{ scores }}",
        varsWithNumbers,
        escape,
        { templateFormat: "nunjucks" },
      );
      // Nunjucks renders arrays as comma-separated (without brackets)
      expect(result).toBe("Scores: 95,87,92,100");
    });

    test("renders array of objects as comma-separated [object Object]", () => {
      const varsWithObjects = {
        users: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
          { id: 3, name: "Charlie" },
        ],
      };
      const result = renderTemplateContent(
        "Users: {{ users }}",
        varsWithObjects,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        "Users: [object Object],[object Object],[object Object]",
      );
    });

    test("renders array of objects as JSON with dump", () => {
      const varsWithObjects = {
        users: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
          { id: 3, name: "Charlie" },
        ],
      };
      const result = renderTemplateContent(
        "Users: {{ users | dump }}",
        varsWithObjects,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        'Users: [{"id":1,"name":"Alice"},{"id":2,"name":"Bob"},{"id":3,"name":"Charlie"}]',
      );
    });

    test("renders array of objects as JSON with tojson", () => {
      const varsWithObjects = {
        users: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
          { id: 3, name: "Charlie" },
        ],
      };
      const result = renderTemplateContent(
        "Users: {{ users | tojson }}",
        varsWithObjects,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        'Users: [{"id":1,"name":"Alice"},{"id":2,"name":"Bob"},{"id":3,"name":"Charlie"}]',
      );
    });

    test("renders mixed array with strings, numbers, and objects", () => {
      const varsWithMixed = {
        data: ["hello", 42, { type: "object", value: true }, null, "world"],
      };
      const result = renderTemplateContent(
        "Mixed: {{ data }}",
        varsWithMixed,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe("Mixed: hello,42,[object Object],,world");
    });

    test("renders mixed array as JSON with dump", () => {
      const varsWithMixed = {
        data: ["hello", 42, { type: "object", value: true }, null, "world"],
      };
      const result = renderTemplateContent(
        "Mixed: {{ data | dump }}",
        varsWithMixed,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        'Mixed: ["hello",42,{"type":"object","value":true},null,"world"]',
      );
    });

    test("handles objects inside arrays with for loops - renders [object Object]", () => {
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
      expect(result).toBe("[object Object], [object Object]");
    });

    test("handles objects inside arrays with for loops using dump", () => {
      const varsWithArray = {
        attachments: [
          { url: "http://example.com/1.jpg", type: "image" },
          { url: "http://example.com/2.pdf", type: "pdf" },
        ],
      };
      const result = renderTemplateContent(
        "{% for image in attachments %}{{ image | dump }}{% if not loop.last %}, {% endif %}{% endfor %}",
        varsWithArray,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        '{"url":"http://example.com/1.jpg","type":"image"}, {"url":"http://example.com/2.pdf","type":"pdf"}',
      );
    });

    test("handles objects inside arrays with for loops using tojson", () => {
      const varsWithArray = {
        attachments: [
          { url: "http://example.com/1.jpg", type: "image" },
          { url: "http://example.com/2.pdf", type: "pdf" },
        ],
      };
      const result = renderTemplateContent(
        "{% for image in attachments %}{{ image | tojson }}{% if not loop.last %}, {% endif %}{% endfor %}",
        varsWithArray,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        '{"url":"http://example.com/1.jpg","type":"image"}, {"url":"http://example.com/2.pdf","type":"pdf"}',
      );
    });

    test("handles nested loops with objects using dump", () => {
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
        "{% for user in users %}User: {{ user.name }}, Posts: {% for post in user.posts %}{{ post | dump }}{% if not loop.last %}, {% endif %}{% endfor %}; {% endfor %}",
        varsWithNestedArrays,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toContain('"id":1');
      expect(result).toContain('"title":"First post"');
      expect(result).toContain('"id":3');
    });

    test("renders comma-separated image URLs as string", () => {
      const varsWithUrls = {
        images:
          "https://example.com/image1.jpg, https://example.com/image2.jpg",
      };
      const result = renderTemplateContent(
        "{{ images }}",
        varsWithUrls,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        "https://example.com/image1.jpg, https://example.com/image2.jpg",
      );
    });

    test("renders mixed content with images", () => {
      const varsWithMixed = {
        text: "Check out these images:",
        images: [
          {
            type: "image_url",
            image_url: { url: "https://example.com/image1.jpg" },
          },
          {
            type: "image_url",
            image_url: { url: "https://example.com/image2.jpg" },
          },
        ],
      };
      const result = renderTemplateContent(
        "{{ text }} {% for img in images %}{{ img.image_url.url }}{% if not loop.last %}, {% endif %}{% endfor %}",
        varsWithMixed,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        "Check out these images: https://example.com/image1.jpg, https://example.com/image2.jpg",
      );
    });

    test("renders braintrust_attachment object as [object Object]", () => {
      const varsWithAttachment = {
        images: {
          type: "braintrust_attachment",
          filename: "deep.txt",
          content_type: "text/plain",
          key: "attachments/deep/deep.txt",
        },
      };
      const result = renderTemplateContent(
        "{{ images }}",
        varsWithAttachment,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe("[object Object]");
    });

    test("renders braintrust_attachment object as JSON with dump", () => {
      const varsWithAttachment = {
        images: {
          type: "braintrust_attachment",
          filename: "deep.txt",
          content_type: "text/plain",
          key: "attachments/deep/deep.txt",
        },
      };
      const result = renderTemplateContent(
        "{{ images | dump }}",
        varsWithAttachment,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        '{"type":"braintrust_attachment","filename":"deep.txt","content_type":"text/plain","key":"attachments/deep/deep.txt"}',
      );
    });

    test("renders braintrust_attachment object as JSON with tojson", () => {
      const varsWithAttachment = {
        images: {
          type: "braintrust_attachment",
          filename: "deep.txt",
          content_type: "text/plain",
          key: "attachments/deep/deep.txt",
        },
      };
      const result = renderTemplateContent(
        "{{ images | tojson }}",
        varsWithAttachment,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        '{"type":"braintrust_attachment","filename":"deep.txt","content_type":"text/plain","key":"attachments/deep/deep.txt"}',
      );
    });

    test("renders array of braintrust_attachment objects", () => {
      const varsWithAttachments = {
        images: [
          {
            type: "braintrust_attachment",
            filename: "image1.jpg",
            content_type: "image/jpeg",
            key: "attachments/image1.jpg",
          },
          {
            type: "braintrust_attachment",
            filename: "image2.jpg",
            content_type: "image/jpeg",
            key: "attachments/image2.jpg",
          },
        ],
      };
      const result = renderTemplateContent(
        "{{ images }}",
        varsWithAttachments,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe("[object Object],[object Object]");
    });

    test("renders array of braintrust_attachment objects as JSON with dump", () => {
      const varsWithAttachments = {
        images: [
          {
            type: "braintrust_attachment",
            filename: "image1.jpg",
            content_type: "image/jpeg",
            key: "attachments/image1.jpg",
          },
          {
            type: "braintrust_attachment",
            filename: "image2.jpg",
            content_type: "image/jpeg",
            key: "attachments/image2.jpg",
          },
        ],
      };
      const result = renderTemplateContent(
        "{{ images | dump }}",
        varsWithAttachments,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        '[{"type":"braintrust_attachment","filename":"image1.jpg","content_type":"image/jpeg","key":"attachments/image1.jpg"},{"type":"braintrust_attachment","filename":"image2.jpg","content_type":"image/jpeg","key":"attachments/image2.jpg"}]',
      );
    });

    test("renders braintrust_attachment with loop and tojson", () => {
      const varsWithAttachments = {
        images: [
          {
            type: "braintrust_attachment",
            filename: "image1.jpg",
            content_type: "image/jpeg",
            key: "attachments/image1.jpg",
          },
          {
            type: "braintrust_attachment",
            filename: "image2.jpg",
            content_type: "image/jpeg",
            key: "attachments/image2.jpg",
          },
        ],
      };
      const result = renderTemplateContent(
        "{% for img in images %}{{ img | tojson }}{% if not loop.last %}, {% endif %}{% endfor %}",
        varsWithAttachments,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        '{"type":"braintrust_attachment","filename":"image1.jpg","content_type":"image/jpeg","key":"attachments/image1.jpg"}, {"type":"braintrust_attachment","filename":"image2.jpg","content_type":"image/jpeg","key":"attachments/image2.jpg"}',
      );
    });

    test("renders comma-separated braintrust_attachment objects as string", () => {
      const varsWithAttachments = {
        images:
          '{"type":"braintrust_attachment","filename":"image1.jpg","key":"attachments/image1.jpg"}, {"type":"braintrust_attachment","filename":"image2.jpg","key":"attachments/image2.jpg"}',
      };
      const result = renderTemplateContent(
        "{{ images }}",
        varsWithAttachments,
        escape,
        { templateFormat: "nunjucks" },
      );
      expect(result).toBe(
        '{"type":"braintrust_attachment","filename":"image1.jpg","key":"attachments/image1.jpg"}, {"type":"braintrust_attachment","filename":"image2.jpg","key":"attachments/image2.jpg"}',
      );
    });
  });
});
