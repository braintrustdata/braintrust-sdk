import { Completions } from "openai/resources/chat/completions.mjs";

async function main() {
  const completions = new Completions({
    post: async (path, params) => ({ choices: [], model: "gpt-4" }),
  });
  await completions.create({ model: "gpt-4", messages: [] });
}

main();
