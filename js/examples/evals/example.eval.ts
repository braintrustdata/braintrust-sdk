import { Eval } from "braintrust";
import { Levenshtein } from "autoevals";

const NUM_EXAMPLES = 10000;

Eval("queue-test", {
  data: () => {
    const data: { input: string; expected: string }[] = [];
    for (let i = 0; i < NUM_EXAMPLES; i++) {
      const names = [
        "Foo",
        "Bar",
        "Alice",
        "Bob",
        "Charlie",
        "Diana",
        "Eve",
        "Frank",
      ];
      const greetings = ["Hi", "Hello", "Hey", "Greetings"];

      const name = names[i % names.length];
      const greeting = greetings[i % greetings.length];

      data.push({
        input: name,
        expected: `${greeting} ${name}`,
      });
    }
    return data;
  },
  task: async (input) => {
    return "Hi " + input; // Replace with your LLM call
  },
  scores: [Levenshtein],
});
