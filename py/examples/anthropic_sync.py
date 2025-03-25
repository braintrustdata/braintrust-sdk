#!/usr/bin/env python
"""
An app demonstrating how to wrap the sync Anthropic Client.
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
def _ask_anthropic_stream(question):
    args = {
        "max_tokens": 1024,
        "model": "claude-3-haiku-20240307",
        "messages": [{"role": "user", "content": question}],
    }
    with client.messages.stream(**args) as stream:
        for msg in stream:
            pass
        message = stream.get_final_message()
        print(message)
    print("done")


@braintrust.traced
def ask():
    print("asking questions")
    # Ask each question and display the response
    for i, question in enumerate(questions):
        _ask_anthropic(question)
        _ask_anthropic_stream(question)


def main():
    while True:
        ask()
        time.sleep(3)


if __name__ == "__main__":
    main()
