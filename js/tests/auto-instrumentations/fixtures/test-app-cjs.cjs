async function main() {
  const { Completions } = await import("openai/resources/chat/completions.mjs");
  const completions = new Completions({
    post: async (path, params) => ({ choices: [], model: "gpt-4" }),
  });
  await completions.create({ model: "gpt-4", messages: [] });
}

main();
