#!/usr/bin/env python


# ASDF !/usr/bin/env uv run --script
# ASDF  /// script
# ASDF  dependencies = [
# ASDF    "anthropic",
# ASDF    "braintrust",
# ASDF  ]
# ASDF  ///


import os
import random
import time

import anthropic
import braintrust

print("BRAINTRUST CLIENT", braintrust.__file__)

# Initialize Anthropic client (needs ANTHROPIC_API_KEY) (needs
client = anthropic.Anthropic()

braintrust.init_logger(project="test-anthropic-app")


# List of questions to ask
questions = [
    "What is the capital of France?",
    "How does photosynthesis work?",
    "What are three interesting facts about octopuses?",
]


@braintrust.traced
def _ask_anthropic(question):
    time.sleep(random.random())
    return "TODO"

    msg = client.messages.create(
        model="claude-3-haiku-20240307", max_tokens=300, messages=[{"role": "user", "content": question}]
    )
    return msg.content[0].text


@braintrust.traced
def ask():
    # Ask each question and display the response
    for i, question in enumerate(questions):
        _ask_anthropic(question)


def main():
    while True:
        ask()
        time.sleep(3)


if __name__ == "__main__":
    main()
