#!/usr/bin/env python
"""
An app demonstrating how to wrap the Anthropic python client.
"""

import os
import random
import time

import anthropic
import braintrust
from braintrust.wrappers.anthropic import wrap_anthropic_client

# Initialize Anthropic client (needs ANTHROPIC_API_KEY)
client = wrap_anthropic_client(anthropic.Anthropic())

braintrust.init_logger(project="example-anthropic-app")


# List of questions to ask
questions = [
    "What is the capital of France?",
    "How does photosynthesis work?",
    "What are three interesting facts about octopuses?",
]


@braintrust.traced
def _ask_anthropic(question):
    msg = client.messages.create(
        model="claude-3-haiku-20240307", max_tokens=300, messages=[{"role": "user", "content": question}]
    )

    return msg.content[0].text


@braintrust.traced
def ask():
    print("asking questions")
    # Ask each question and display the response
    for i, question in enumerate(questions):
        _ask_anthropic(question)


def main():
    while True:
        ask()
        time.sleep(3)


if __name__ == "__main__":
    main()
