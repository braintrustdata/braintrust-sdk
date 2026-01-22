import "@braintrust/templates-nunjucks";
import { Prompt } from "braintrust";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    );
  }
}

const prompt = new Prompt(
  {
    name: "nunjucks-addon-test",
    slug: "nunjucks-addon-test",
    prompt_data: {
      prompt: {
        type: "chat",
        messages: [
          {
            role: "user",
            content:
              "Items: {% for item in items %}{{ item.name }}{% if not loop.last %}, {% endif %}{% endfor %}",
          },
        ],
      },
      options: { model: "gpt-4" },
    },
  },
  {},
  false,
);

const result = prompt.build(
  { items: [{ name: "apple" }, { name: "banana" }, { name: "cherry" }] },
  { templateFormat: "nunjucks" },
);

assertEqual(
  result.messages[0]?.content,
  "Items: apple, banana, cherry",
  "Nunjucks addon should render loop correctly",
);

console.log("✓ Nunjucks addon integration test passed");
