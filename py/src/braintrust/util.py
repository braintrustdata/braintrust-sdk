import inspect
import os.path
import urllib.parse
from pathlib import Path

from requests import HTTPError

GLOBAL_PROJECT = "Global"


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


# Taken from
# https://stackoverflow.com/questions/3812849/how-to-check-whether-a-directory-is-a-sub-directory-of-another-directory.
def is_subpath(test_path, directory):
    test_path = Path(test_path)
    directory = Path(directory)
    return test_path == directory or directory in test_path.parents


def get_caller_location():
    # Modified from
    # https://stackoverflow.com/questions/24438976/debugging-get-filename-and-line-number-from-which-a-function-is-called
    # to fetch the first stack frame not contained inside the same directory as
    # this file (or any of its subdirectories).
    this_dir = None
    call_stack = inspect.stack()
    for frame in call_stack:
        caller = inspect.getframeinfo(frame.frame)
        if this_dir is None:
            this_dir = os.path.dirname(caller.filename)
        if not is_subpath(caller.filename, this_dir):
            return dict(
                caller_functionname=caller.function,
                caller_filename=caller.filename,
                caller_lineno=caller.lineno,
            )
    return None
