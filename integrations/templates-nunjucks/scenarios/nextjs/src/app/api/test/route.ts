import { NextResponse } from "next/server";
import { Prompt } from "braintrust";

export async function GET() {
  try {
    const prompt = new Prompt(
      {
        name: "nunjucks-nextjs-test",
        slug: "nunjucks-nextjs-test",
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

    return NextResponse.json({
      success: result.messages[0]?.content === "Items: apple, banana, cherry",
      content: result.messages[0]?.content,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 },
    );
  }
}
