import dataclasses
import inspect
import json
import os.path
import urllib.parse

from requests import HTTPError


class SerializableDataClass:
    def as_dict(self):
        """Serialize the object to a dictionary."""
        return dataclasses.asdict(self)

    def as_json(self, **kwargs):
        """Serialize the object to JSON."""
        return json.dumps(self.as_dict(), **kwargs)


def encode_uri_component(name):
    """Encode a single component of a URI. Slashes are encoded as well, so this
    should not be used for multiple slash-separated URI components."""

    return urllib.parse.quote(name, safe="")


class AugmentedHTTPError(Exception):
    pass


def response_raise_for_status(resp):
    try:
        resp.raise_for_status()
    except HTTPError as e:
        raise AugmentedHTTPError(f"{resp.text}") from e


def get_caller_location():
    # Modified from
    # https://stackoverflow.com/questions/24438976/debugging-get-filename-and-line-number-from-which-a-function-is-called
    # to fetch the first stack frame not contained inside the same directory as
    # this file.
    this_dir = None
    call_stack = inspect.stack()
    for frame in call_stack:
        caller = inspect.getframeinfo(frame.frame)
        if this_dir is None:
            this_dir = os.path.dirname(caller.filename)
        if os.path.dirname(caller.filename) != this_dir:
            return dict(
                caller_function_name=caller.function,
                caller_file_name=caller.filename,
                caller_line_num=caller.lineno,
            )
    return None
