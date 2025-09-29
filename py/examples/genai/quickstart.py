from braintrust.wrappers.genai import setup_genai
from google import genai
from google.genai import types

setup_genai(project_name="example-genai-py")

client = genai.Client()

for chunk in client.models.generate_content_stream(
    model="gemini-2.5-flash",
    contents="Explain how AI works in a few words",
    config=types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(thinking_budget=0)  # Disables thinking,
    ),
):
    print(chunk.text)
