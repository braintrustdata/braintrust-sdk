import { test, expect } from "@playwright/test";

test("Nunjucks template rendering in Next.js API route", async ({
  request,
}) => {
  const response = await request.get("/api/test");
  const data = await response.json();

  expect(response.ok()).toBeTruthy();
  expect(data.success).toBe(true);
  expect(data.content).toBe("Items: apple, banana, cherry");
});
