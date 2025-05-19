#!/usr/bin/env python
"""
An app demonstrating how to wrap the sync Anthropic Client.
"""

import os
import random
import time

import anthropic
import braintrust

# Initialize Anthropic client (needs ANTHROPIC_API_KEY)
client = braintrust.wrap_anthropic(anthropic.Anthropic())
braintrust.init_logger(project="example-anthropic-app")


@braintrust.traced
def ask_anthropic_sync(question, system=None):
    args = {
        "model": "claude-3-haiku-20240307",
        "max_tokens": 300,
        "temperature": 0.5,
        "messages": [{"role": "user", "content": question}],
    }
    if system:
        args["system"] = system
    msg = client.messages.create(**args)
    print(msg)


@braintrust.traced
def ask_anthropic_stream(question, system=None):
    args = {
        "max_tokens": 1024,
        "model": "claude-3-haiku-20240307",
        "messages": [{"role": "user", "content": question}],
    }
    if system:
        args["system"] = system
    with client.messages.stream(**args) as stream:
        for msg in stream:
            pass
    message = stream.get_final_message()
    print(message)


@braintrust.traced
def ask_anthropic():
    print("asking questions")
    # Ask each question and display the response
    ask_anthropic_sync("What is the capital of Canada?")
    ask_anthropic_stream("What is the date tomrrow?", "today is 2025-03-26")


def main():
    ask_anthropic()


if __name__ == "__main__":
    main()
