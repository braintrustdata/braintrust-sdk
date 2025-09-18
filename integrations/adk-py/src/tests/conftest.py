import os

import pytest


@pytest.fixture(autouse=True)
def setup_braintrust():
    os.environ["BRAINTRUST_SYNC_FLUSH"] = "1"
    os.environ.setdefault("BRAINTRUST_API_URL", "http://localhost:8000")
    os.environ.setdefault("BRAINTRUST_APP_URL", "http://localhost:3000")
    os.environ.setdefault("BRAINTRUST_API_KEY", "your_api_key_here")
    os.environ.setdefault("GOOGLE_API_KEY", "your_google_api_key_here")
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "FALSE")
