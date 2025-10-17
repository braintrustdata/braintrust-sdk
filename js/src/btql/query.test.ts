import { describe, expect, test } from "vitest";
import { Query } from "./btql-query";
import { ZodError } from "zod";

describe("fromString", () => {
  test("creates query from simple string", () => {
    const query = Query.fromString("from: project_logs('test')");
    expect(query).toBeDefined();
  });

  test("creates query from complex string", () => {
    const rawQuery = `from: project_logs('test')
select: id, input, output
filter: is_root = true
limit: 10`;
    const query = Query.fromString(rawQuery);
    expect(query).toBeDefined();
  });

  test("cannot convert string query to internal BTQL", () => {
    const query = Query.fromString("from: project_logs('test')");
    expect(() => query.toInternalBtql()).toThrow(
      "Cannot convert raw BTQL string queries to internal BTQL structure",
    );
  });
});

describe("fromObject", () => {
  test("creates query from simple object", () => {
    const queryObj = {
      select: [{ expr: { btql: "id" }, alias: "id" }],
      limit: 100,
    };
    const query = Query.fromObject(queryObj);
    expect(query).toBeDefined();
  });

  test("creates query with from clause", () => {
    const queryObj = {
      from: {
        op: "function" as const,
        name: { op: "ident" as const, name: ["project_logs"] },
        args: [{ op: "literal" as const, value: "project-123" }],
      },
      select: [{ expr: { btql: "id" }, alias: "id" }],
    };
    const query = Query.fromObject(queryObj);
    expect(query).toBeDefined();
  });

  test("creates query with filter", () => {
    const queryObj = {
      filter: { btql: "is_root = true" },
      limit: 10,
    };
    const query = Query.fromObject(queryObj);
    expect(query).toBeDefined();
  });

  test("creates query with dimensions and measures", () => {
    const queryObj = {
      dimensions: [{ expr: { btql: "metadata.model" }, alias: "model" }],
      measures: [{ expr: { btql: "count(1)" }, alias: "total" }],
    };
    const query = Query.fromObject(queryObj);
    expect(query).toBeDefined();
  });

  test("creates query with all optional fields", () => {
    const queryObj = {
      select: [{ expr: { btql: "id" }, alias: "id" }],
      filter: { btql: "is_root = true" },
      sort: [{ expr: { btql: "created" }, dir: "desc" as const }],
      limit: 50,
      cursor: "test-cursor",
      sample: {
        method: { type: "rate" as const, value: 0.25 },
        seed: 42,
      },
      preview_length: 1024,
    };
    const query = Query.fromObject(queryObj);
    expect(query).toBeDefined();
  });

  test("toInternalBtql returns object", () => {
    const queryObj = {
      select: [{ expr: { btql: "id" }, alias: "id" }],
      limit: 100,
    };
    const query = Query.fromObject(queryObj);
    const result = query.toInternalBtql();
    expect(result).toEqual(queryObj);
  });

  test("validates invalid select type", () => {
    expect(() => {
      Query.fromObject({
        select: "not an array" as unknown as never,
      });
    }).toThrow(ZodError);
  });

  test("validates invalid limit type", () => {
    expect(() => {
      Query.fromObject({
        limit: "not a number" as unknown as never,
      });
    }).toThrow(ZodError);
  });

  test("allows empty object", () => {
    const query = Query.fromObject({});
    expect(query).toBeDefined();
  });
});
