from typing import Any, Sequence, Set


def format_validation_errors(errors: Sequence[Any]) -> str:
    """Convert Pydantic validation errors into simple, clear messages."""
    messages: Set[str] = set()

    for error in errors:
        loc = error.get("loc", [])
        msg = error.get("msg", "")
        error_type = error.get("type", "")

        # Get the field name - only use string fields, skip numbers and 'body'
        field_candidates = [str(x) for x in loc if isinstance(x, str) and str(x) != "body"]
        field = field_candidates[0] if field_candidates else None

        if error_type == "missing":
            messages.add(f'"{field}" is required' if field else "Missing required field")
        elif error_type == "extra_forbidden":
            messages.add(f'"{field}" is unexpected' if field else "Unexpected field")
        elif "dictionary" in msg or "dict" in msg:
            messages.add(f'"{field}" is not a valid object' if field else "Invalid object format")
        else:
            messages.add(f'"{field}" is invalid' if field else "Invalid request format")

    return "; ".join(sorted(messages))


class DatasetNotFoundError(Exception):
    pass
