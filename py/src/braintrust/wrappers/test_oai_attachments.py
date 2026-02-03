"""Tests for OpenAI wrapper attachment processing."""
import time

import openai
import pytest
from braintrust import Attachment, logger, wrap_openai
from braintrust.test_helpers import init_test_logger
from braintrust.wrappers.test_utils import assert_metrics_are_valid

PROJECT_NAME = "test-project-openai-attachment-processing"
TEST_MODEL = "gpt-4o-mini"


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


def _is_wrapped(client):
    return hasattr(client, "_NamedWrapper__wrapped")


@pytest.mark.vcr
def test_openai_image_data_url_converts_to_attachment(memory_logger):
    """Test that image data URLs in chat completions are converted to Attachment objects."""
    assert not memory_logger.pop()

    # Create a simple 1x1 red pixel PNG
    base64_image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    data_url = f"data:image/png;base64,{base64_image}"

    client = wrap_openai(openai.OpenAI())

    start = time.time()
    response = client.chat.completions.create(
        model=TEST_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What color is this image?"},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    )
    end = time.time()

    # Verify we got a successful response
    assert response
    assert response.choices
    assert response.choices[0].message.content
    # The model should be able to see the image
    content = response.choices[0].message.content.lower()
    assert "red" in content or "pink" in content or "color" in content

    # Verify spans were created
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span

    # Verify metrics
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert TEST_MODEL in span["metadata"]["model"]
    assert span["metadata"]["provider"] == "openai"

    # Verify input contains the attachment
    assert span["input"]
    assert len(span["input"]) == 1
    message_content = span["input"][0]["content"]
    assert len(message_content) == 2

    # First item should be text
    assert message_content[0]["type"] == "text"
    assert message_content[0]["text"] == "What color is this image?"

    # Second item should have the image URL converted to Attachment
    assert message_content[1]["type"] == "image_url"
    image_url_value = message_content[1]["image_url"]["url"]
    assert isinstance(image_url_value, Attachment)
    assert image_url_value.reference["type"] == "braintrust_attachment"
    assert image_url_value.reference["content_type"] == "image/png"
    assert image_url_value.reference["filename"] == "image.png"
    assert image_url_value.reference["key"]


@pytest.mark.vcr
def test_openai_pdf_data_url_converts_to_attachment(memory_logger):
    """Test that PDF data URLs in chat completions are converted to Attachment objects."""
    assert not memory_logger.pop()

    # Create a minimal PDF
    base64_pdf = "JVBERi0xLjAKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PmVuZG9iagoyIDAgb2JqCjw8L1R5cGUvUGFnZXMvS2lkc1szIDAgUl0vQ291bnQgMT4+ZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA2MTIgNzkyXT4+ZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZg0KMDAwMDAwMDAxMCAwMDAwMCBuDQowMDAwMDAwMDUzIDAwMDAwIG4NCjAwMDAwMDAxMDIgMDAwMDAgbg0KdHJhaWxlcgo8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoxNDkKJUVPRg=="
    data_url = f"data:application/pdf;base64,{base64_pdf}"

    client = wrap_openai(openai.OpenAI())

    start = time.time()
    response = client.chat.completions.create(
        model=TEST_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What type of document is this?"},
                    {
                        "type": "file",
                        "file": {
                            "file_data": data_url,
                            "filename": "test.pdf",
                        },
                    },
                ],
            }
        ],
    )
    end = time.time()

    # Verify we got a successful response
    assert response
    assert response.choices
    assert response.choices[0].message.content

    # Verify spans were created
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span

    # Verify metrics
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert TEST_MODEL in span["metadata"]["model"]
    assert span["metadata"]["provider"] == "openai"

    # Verify input contains the attachment
    assert span["input"]
    assert len(span["input"]) == 1
    message_content = span["input"][0]["content"]
    assert len(message_content) == 2

    # First item should be text
    assert message_content[0]["type"] == "text"
    assert message_content[0]["text"] == "What type of document is this?"

    # Second item should have the file_data converted to Attachment
    assert message_content[1]["type"] == "file"
    file_data_value = message_content[1]["file"]["file_data"]
    assert isinstance(file_data_value, Attachment)
    assert file_data_value.reference["type"] == "braintrust_attachment"
    assert file_data_value.reference["content_type"] == "application/pdf"
    # Should use the provided filename, not a generic one
    assert file_data_value.reference["filename"] == "test.pdf"
    assert file_data_value.reference["key"]


@pytest.mark.vcr
def test_openai_pdf_data_url_without_filename_uses_fallback(memory_logger):
    """Test that PDF data URLs without a filename use the generated fallback."""
    assert not memory_logger.pop()

    # Create a minimal PDF
    base64_pdf = "JVBERi0xLjAKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PmVuZG9iagoyIDAgb2JqCjw8L1R5cGUvUGFnZXMvS2lkc1szIDAgUl0vQ291bnQgMT4+ZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA2MTIgNzkyXT4+ZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZg0KMDAwMDAwMDAxMCAwMDAwMCBuDQowMDAwMDAwMDUzIDAwMDAwIG4NCjAwMDAwMDAxMDIgMDAwMDAgbg0KdHJhaWxlcgo8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoxNDkKJUVPRg=="
    data_url = f"data:application/pdf;base64,{base64_pdf}"

    client = wrap_openai(openai.OpenAI())

    start = time.time()
    response = client.chat.completions.create(
        model=TEST_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What type of document is this?"},
                    {
                        "type": "file",
                        "file": {
                            "file_data": data_url,
                            # No filename provided - should use fallback
                        },
                    },
                ],
            }
        ],
    )
    end = time.time()

    # Verify we got a successful response
    assert response
    assert response.choices
    assert response.choices[0].message.content

    # Verify spans were created
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span

    # Verify metrics
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert TEST_MODEL in span["metadata"]["model"]
    assert span["metadata"]["provider"] == "openai"

    # Verify input contains the attachment
    assert span["input"]
    assert len(span["input"]) == 1
    message_content = span["input"][0]["content"]
    assert len(message_content) == 2

    # First item should be text
    assert message_content[0]["type"] == "text"
    assert message_content[0]["text"] == "What type of document is this?"

    # Second item should have the file_data converted to Attachment
    assert message_content[1]["type"] == "file"
    file_data_value = message_content[1]["file"]["file_data"]
    assert isinstance(file_data_value, Attachment)
    assert file_data_value.reference["type"] == "braintrust_attachment"
    assert file_data_value.reference["content_type"] == "application/pdf"
    # Should use the fallback filename since none was provided
    assert file_data_value.reference["filename"] == "document.pdf"
    assert file_data_value.reference["key"]


@pytest.mark.vcr
def test_openai_regular_url_preserved(memory_logger):
    """Test that regular URLs (non-data URLs) are preserved unchanged."""
    assert not memory_logger.pop()

    # Use a regular URL (not a data URL)
    regular_url = "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg"

    client = wrap_openai(openai.OpenAI())

    start = time.time()
    response = client.chat.completions.create(
        model=TEST_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What's in this image?"},
                    {"type": "image_url", "image_url": {"url": regular_url}},
                ],
            }
        ],
    )
    end = time.time()

    # Verify we got a successful response
    assert response
    assert response.choices
    assert response.choices[0].message.content

    # Verify spans were created
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span

    # Verify metrics
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)

    # Verify input has the URL unchanged (not converted to Attachment)
    assert span["input"]
    message_content = span["input"][0]["content"]
    assert message_content[1]["type"] == "image_url"
    image_url_value = message_content[1]["image_url"]["url"]
    # Regular URLs should NOT be converted to Attachment
    assert isinstance(image_url_value, str)
    assert image_url_value == regular_url


@pytest.mark.vcr
def test_openai_unwrapped_client_no_conversion(memory_logger):
    """Test that unwrapped clients don't process attachments and don't generate spans."""
    assert not memory_logger.pop()

    # Create a simple image data URL
    base64_image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    data_url = f"data:image/png;base64,{base64_image}"

    # Use unwrapped client
    client = openai.OpenAI()

    response = client.chat.completions.create(
        model=TEST_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What color is this image?"},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    )

    # Verify we got a successful response
    assert response
    assert response.choices
    assert response.choices[0].message.content

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()
