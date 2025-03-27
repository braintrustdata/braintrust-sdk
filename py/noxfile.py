"""
Define our tests to run against different combinations of
Python & library versions.
"""

import nox

LATEST = "__latest__"
SRC = "src/braintrust"


ERROR_CODES = tuple(range(1, 256))

# List your package here if it's not guaranteed to be installed. We'll (try to)
# validate things work with or without them.
VENDOR_PACKAGES = ("anthropic", "openai")


ANTHROPIC_VERSIONS = ("0.48.0", "0.49.0", LATEST)


@nox.session()
def test_no_deps(session):
    """Ensure that with no dependencies, we can still import and use the
    library.
    """
    _install_test_deps(session)

    # verify we haven't installed our 3p deps.
    for p in VENDOR_PACKAGES:
        session.run("python", "-c", f"import {p}", success_codes=ERROR_CODES)

    session.run("python", "-c", "import braintrust")
    session.run("pytest", SRC, f"--ignore={SRC}/wrappers")


@nox.session()
@nox.parametrize("version", ANTHROPIC_VERSIONS)
def test_anthropic(session, version):
    _install_test_deps(session)
    _install(session, "anthropic", version)
    session.run("pytest", f"{SRC}/wrappers/test_anthropic.py")


def _install_test_deps(session):
    session.install("pytest")
    session.install("pytest-asyncio")
    session.install("-e", ".[test]")


def _install(session, package, version=LATEST):
    cmd = f"{package}=={version}"
    if version == LATEST or not version:
        cmd = package
    session.run("pip", "install", cmd)
