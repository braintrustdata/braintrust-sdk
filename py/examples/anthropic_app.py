#!/usr/bin/env uv run --script
# /// script
# dependencies = [
#   "anthropic",
# ]
# ///


import os

import anthropic

# Initialize Anthropic client (needs ANTHROPIC_API_KEY) (needs
client = anthropic.Anthropic()

# List of questions to ask
questions = [
    "What is the capital of France?",
    "How does photosynthesis work?",
    "What are three interesting facts about octopuses?",
]

# Ask each question and display the response
for i, question in enumerate(questions):
    print(f"\nQuestion {i+1}: {question}")

    message = client.messages.create(
        model="claude-3-haiku-20240307", max_tokens=300, messages=[{"role": "user", "content": question}]
    )

    print(f"Answer: {message.content[0].text}")
