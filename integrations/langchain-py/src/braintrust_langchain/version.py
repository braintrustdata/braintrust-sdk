try:
    from importlib.metadata import PackageNotFoundError, version
except ImportError:
    # Python < 3.8 compatibility
    from importlib_metadata import PackageNotFoundError, version  # type: ignore

try:
    __version__ = version("braintrust-langchain")
except PackageNotFoundError:
    # Package is not installed (e.g., during development)
    # Fallback to a dev version
    __version__ = "0.0.0.dev0"

version = __version__

# This will be templated during the build if needed
GIT_COMMIT = "__GIT_COMMIT__"
